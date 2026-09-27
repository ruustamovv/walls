/**
 * Social login (Google + GitHub) via standard OAuth2 code flow.
 * Providers appear in the UI only when their env keys exist.
 *
 * Security: per-attempt `state` tokens (10 min TTL) bind the callback to
 * the login attempt (CSRF protection). Access tokens are used once for
 * userinfo and never stored. OAuth accounts get an unusable random
 * password — local password login stays separate until the user sets one.
 */
import { randomBytes } from 'node:crypto';
import { getAuthService } from './service.js';
import { hashPassword } from './hashing.js';
import { logger } from '../../common/logging/logger.js';

export const OAUTH_PROVIDERS = ['google', 'github'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

interface PendingState {
  next: string;
  createdAt: number;
}

const pending = new Map<string, PendingState>();

function configured(provider: OAuthProvider): { id: string; secret: string } | null {
  const prefix = provider === 'google' ? 'GOOGLE' : 'GITHUB';
  const id = process.env[`${prefix}_CLIENT_ID`] ?? '';
  const secret = process.env[`${prefix}_CLIENT_SECRET`] ?? '';
  if (id === '' || id.includes('PASTE_YOUR') || secret === '' || secret.includes('PASTE_YOUR')) return null;
  return { id, secret };
}

export function oauthStatus(): Record<OAuthProvider, boolean> {
  return {
    google: configured('google') !== null,
    github: configured('github') !== null,
  };
}

function backendBase(): string {
  return (process.env['BACKEND_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
}

function frontendBase(): string {
  return (process.env['FRONTEND_URL'] ?? 'http://localhost:5173').replace(/\/$/, '');
}

function sweepPending(): void {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (now - v.createdAt > 10 * 60 * 1000) pending.delete(k);
  }
}

/** Build the provider authorize URL and remember the state token. */
export function authorizeUrl(provider: OAuthProvider, next: string): string {
  const creds = configured(provider);
  if (creds === null) throw new Error(`${provider} OAuth is not configured`);
  sweepPending();
  const state = randomBytes(16).toString('hex');
  pending.set(state, { next: next.startsWith('/') ? next : '/play', createdAt: Date.now() });
  const redirect = `${backendBase()}/api/v1/auth/oauth/${provider}/callback`;
  if (provider === 'google') {
    const q = new URLSearchParams({
      client_id: creds.id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
  }
  const q = new URLSearchParams({
    client_id: creds.id,
    redirect_uri: redirect,
    scope: 'user:email',
    state,
  });
  return `https://github.com/login/oauth/authorize?${q.toString()}`;
}

export function consumeState(state: string): string | null {
  const found = pending.get(state);
  if (found === undefined) return null;
  pending.delete(state);
  if (Date.now() - found.createdAt > 10 * 60 * 1000) return null;
  return found.next;
}

interface RemoteProfile {
  email: string;
  name: string;
}

async function exchangeGoogle(code: string): Promise<RemoteProfile> {
  const creds = configured('google');
  if (creds === null) throw new Error('google OAuth is not configured');
  const redirect = `${backendBase()}/api/v1/auth/oauth/google/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.id,
      client_secret: creds.secret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`google token exchange failed (${tokenRes.status})`);
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (typeof tokens.access_token !== 'string') throw new Error('google returned no access token');
  const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) throw new Error(`google userinfo failed (${meRes.status})`);
  const me = (await meRes.json()) as { email?: string; name?: string };
  if (typeof me.email !== 'string' || me.email === '') throw new Error('google returned no email');
  return { email: me.email, name: typeof me.name === 'string' && me.name !== '' ? me.name : me.email.split('@')[0] ?? 'player' };
}

async function exchangeGithub(code: string): Promise<RemoteProfile> {
  const creds = configured('github');
  if (creds === null) throw new Error('github OAuth is not configured');
  const redirect = `${backendBase()}/api/v1/auth/oauth/github/callback`;
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: creds.id, client_secret: creds.secret, code, redirect_uri: redirect }),
  });
  if (!tokenRes.ok) throw new Error(`github token exchange failed (${tokenRes.status})`);
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (typeof tokens.access_token !== 'string') throw new Error('github returned no access token');
  const headers = { Authorization: `Bearer ${tokens.access_token}`, 'User-Agent': 'project-nexus' };
  const meRes = await fetch('https://api.github.com/user', { headers });
  if (!meRes.ok) throw new Error(`github user failed (${meRes.status})`);
  const me = (await meRes.json()) as { login?: string; email?: string | null };
  let email = typeof me.email === 'string' ? me.email : '';
  if (email === '') {
    const emRes = await fetch('https://api.github.com/user/emails', { headers });
    if (emRes.ok) {
      const list = (await emRes.json()) as { email?: string; primary?: boolean; verified?: boolean }[];
      email = list.find((e) => e.primary === true && e.verified === true)?.email
        ?? list.find((e) => e.verified === true)?.email
        ?? '';
    }
  }
  if (email === '') throw new Error('github returned no verified email');
  return { email, name: typeof me.login === 'string' && me.login !== '' ? me.login : email.split('@')[0] ?? 'player' };
}

function sanitizeUsername(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 20);
  return clean.length >= 3 ? clean : `player_${clean}`;
}

/**
 * Complete login: exchange code, find-or-create the account, open a
 * session. Returns the session id + redirect target for the route layer.
 */
export async function completeOAuth(provider: OAuthProvider, code: string, state: string): Promise<{ sessionId: string; next: string }> {
  const next = consumeState(state);
  if (next === null) throw new Error('unknown or expired login attempt');
  const profile = provider === 'google' ? await exchangeGoogle(code) : await exchangeGithub(code);
  const svc = await getAuthService();
  try {
    const res = await svc.loginOAuth({
      email: profile.email,
      username: sanitizeUsername(profile.name),
      // Unusable random password — OAuth users sign in via providers
      // until they explicitly set a local password.
      passwordHash: await hashPassword(randomBytes(32).toString('hex')),
    });
    return { sessionId: res.session.id, next };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), provider }, 'OAuth completion failed');
    throw new Error('could not sign you in with this provider');
  }
}

export function oauthCallbackTarget(next: string, ok: boolean): string {
  return ok ? `${frontendBase()}${next}` : `${frontendBase()}/login?oauth=failed`;
}
