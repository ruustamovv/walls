/**
 * Architect routes (AIC-008): natural language -> engine-validated board.
 * Registered by buildApp alongside registerV1 / registerMulti / registerAdmin.
 *
 * The response ALWAYS carries the engine verdict: either a playable position
 * plus its share code, or the precise engine reason the proposal was rejected.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../common/errors/errors.js';
import {
  designBoard,
  designFromTemplate,
  parsePrompt,
  proposeSpec,
} from '../modules/architect/service.js';
import { getAuthService } from '../modules/auth/service.js';
import { AuthError } from '../common/errors/errors.js';

const DesignSchema = z.object({
  prompt: z.string().min(3).max(500),
  /** 'auto' runs the deterministic tier, optionally consulting a provider. */
  mode: z.enum(['auto', 'template']).default('auto'),
});

async function optionalUserId(req: { cookies: Record<string, string | undefined>; headers: Record<string, string | string[] | undefined> }): Promise<string | null> {
  const fromCookie = req.cookies['nexus_session'];
  const sid = typeof fromCookie === 'string' && fromCookie.length > 0
    ? fromCookie
    : (() => {
        const h = req.headers['authorization'];
        return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null;
      })();
  if (sid === null) return null;
  const me = await (await getAuthService()).me(sid);
  return me === null ? null : me.id;
}

export async function registerArchitect(app: FastifyInstance): Promise<void> {
  /** @openapi POST /api/v1/architect/design — generate an engine-valid board from a prompt. */
  app.post('/api/v1/architect/design', async (req) => {
    const parsed = DesignSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Describe the board you want (3-500 chars)');
    const { prompt, mode } = parsed.data;

    // Deterministic tier first: it is always available and reproducible.
    if (mode === 'template') {
      const result = designFromTemplate(prompt);
      return respond(result);
    }

    const userId = await optionalUserId(req).catch(() => null);
    const spec = parsePrompt(prompt);
    let llmSpec: { size?: unknown; wallsPerPlayer?: unknown; theme?: unknown } | null = null;
    if (userId !== null) {
      // A provider failure must never break generation — the template stands.
      llmSpec = await proposeSpec(userId, prompt, spec).catch(() => null);
    }
    const result = await designBoard(userId ?? 'anonymous', prompt, llmSpec);
    return respond(result);
  });

  /** @openapi POST /api/v1/architect/parse — show how a prompt is parsed (no board). */
  app.post('/api/v1/architect/parse', async (req) => {
    const parsed = DesignSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Describe the board you want (3-500 chars)');
    return { spec: parsePrompt(parsed.data.prompt) };
  });
}

function respond(result: ReturnType<typeof designFromTemplate>): {
  ok: boolean;
  source: string | null;
  code: string | null;
  walls: { r: number; c: number; orientation: string }[];
  size: number;
  difficulty: string;
  theme: string;
  chokes: number;
  routeA: number;
  routeB: number;
  reason: string | null;
  stage: string | null;
  notes: string[];
  shareUrl: string | null;
} {
  const base = process.env['FRONTEND_URL'] ?? 'http://localhost:5173';
  return {
    ok: result.ok,
    source: result.source,
    code: result.code,
    walls: result.walls.map((w) => ({ r: w.r, c: w.c, orientation: w.orientation })),
    size: result.spec.size,
    difficulty: result.spec.difficulty,
    theme: result.spec.theme,
    chokes: result.spec.chokes,
    routeA: result.routeA,
    routeB: result.routeB,
    reason: result.reason,
    stage: result.stage,
    notes: result.notes,
    shareUrl: result.ok && result.code !== null ? `${base.replace(/\/$/, '')}/designer?from=${encodeURIComponent(result.code)}` : null,
  };
}

export { AuthError };