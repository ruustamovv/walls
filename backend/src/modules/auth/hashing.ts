/**
 * Password hashing (argon2id).
 *
 * Uses native `argon2` when installed; falls back to Node `scrypt`
 * (still memory-hard-ish, dev/test only) so unit tests stay offline-friendly.
 * Format: `alg$param-b64$salt-b64$hash-b64` — self-describing for verify().
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type BinaryLike } from 'node:crypto';

function scryptAsync(password: BinaryLike, salt: BinaryLike, keylen: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, keylen, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err !== null) {
        reject(err);
        return;
      }
      resolve(key as Buffer);
    });
  });
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

interface Argon2Module {
  hash: (plain: string) => Promise<string>;
  verify: (hash: string, plain: string) => Promise<boolean>;
}

let argon2Cache: Argon2Module | null | undefined;

async function loadArgon2(): Promise<Argon2Module | null> {
  if (argon2Cache !== undefined) return argon2Cache;
  try {
    // Lazy + optional: backend works without the native module (dev/test).
    const mod = (await import('argon2')) as unknown as {
      hash: (s: string, o?: unknown) => Promise<string>;
      verify: (h: string, s: string) => Promise<boolean>;
      argon2id?: unknown;
    };
    argon2Cache = {
      hash: (plain: string): Promise<string> => mod.hash(plain, { type: mod.argon2id }),
      verify: (hash: string, plain: string): Promise<boolean> => mod.verify(hash, plain),
    };
  } catch {
    argon2Cache = null;
  }
  return argon2Cache;
}

function encodeB64(buf: Buffer): string {
  return buf.toString('base64url');
}

function decodeB64(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

/** Hash a password. Returns self-describing PHC-ish string. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8 || password.length > 128) {
    throw new Error('Password must be 8..128 chars');
  }
  const a2 = await loadArgon2();
  if (a2 !== null) return a2.hash(password);
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$n=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${encodeB64(salt)}$${encodeB64(key)}`;
}

/** Verify a password against a hash from hashPassword() or native argon2. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (hash.startsWith('$argon2')) {
    const a2 = await loadArgon2();
    if (a2 === null) return false;
    try {
      return await a2.verify(hash, password);
    } catch {
      return false;
    }
  }
  if (hash.startsWith('scrypt$')) {
    try {
      const parts = hash.split('$');
      if (parts.length !== 4) return false;
      const salt = decodeB64(parts[2] ?? '');
      const expected = decodeB64(parts[3] ?? '');
      const key = await scryptAsync(password, salt, expected.length);
      if (key.length !== expected.length) return false;
      return timingSafeEqual(key, expected);
    } catch {
      return false;
    }
  }
  return false;
}
