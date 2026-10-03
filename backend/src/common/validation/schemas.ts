/**
 * Zod schemas at trust boundaries (HTTP + sockets).
 * Never trust client clocks / ratings — server recomputes authority.
 */
import { z } from 'zod';

// ── Auth ─────────────────────────────────────────────
export const RegisterSchema = z.object({
  email: z.string().email().max(254),
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers, underscore only'),
  password: z.string().min(8).max(128),
});

export const LoginSchema = z.object({
  login: z.string().min(1).max(254), // email or username
  password: z.string().min(1).max(128),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

// ── Games ────────────────────────────────────────────
export const BoardSizeSchema = z.number().int().min(5).max(19);

export const PosSchema = z.object({
  r: z.number().int().min(0).max(18),
  c: z.number().int().min(0).max(18),
});

export const WallSchema = z.object({
  r: z.number().int().min(0).max(17),
  c: z.number().int().min(0).max(17),
  orientation: z.enum(['h', 'v']),
});

export const MoveActionSchema = z.object({
  type: z.literal('move'),
  to: PosSchema,
});

export const WallActionSchema = z.object({
  type: z.literal('wall'),
  wall: WallSchema,
});

export const GameActionSchema = z.discriminatedUnion('type', [MoveActionSchema, WallActionSchema]);
export type GameActionInput = z.infer<typeof GameActionSchema>;

/**
 * Idempotent intent envelope (RTG-003): the engine action plus transport
 * metadata. Raw actions (older clients/tests) are wrapped automatically.
 */
export const IntentEnvelopeSchema = z.object({
  action: GameActionSchema,
  actionId: z.string().min(1).max(64).optional(),
  baseMoveNumber: z.number().int().min(0).optional(),
});
export type IntentEnvelopeInput = z.infer<typeof IntentEnvelopeSchema>;

/** Accept a raw action or an envelope; always returns the envelope shape. */
export function normalizeIntent(body: unknown): ReturnType<typeof IntentEnvelopeSchema.safeParse> {
  const raw = body as Record<string, unknown> | null;
  const wrapped = raw !== null && typeof raw === 'object' && 'action' in raw ? raw : { action: raw };
  return IntentEnvelopeSchema.safeParse(wrapped);
}

export const GameVisibilitySchema = z.enum(['public', 'friends', 'unlisted', 'private']);

export const CreateGameSchema = z.object({
  boardSize: BoardSizeSchema.default(9),
  wallsPerPlayer: z.number().int().min(0).max(20).default(10),
  timeControl: z.enum(['1+0', '1+1', '2+1', '3+0', '3+1', '3+2', '5+0', '5+1', '10+0', '10+5', '15+10']).default('3+0'),
  opponentId: z.string().min(1).max(64).optional(), // domain ID = hex string (see database/mongodb/ids.ts), never a raw ObjectId
  visibility: GameVisibilitySchema.optional(),
  // NOTE: rating / clock fields from client are ignored server-side.
});

export type CreateGameInput = z.infer<typeof CreateGameSchema>;

// ── Matchmaking ──────────────────────────────────────
export const MatchmakingJoinSchema = z.object({
  mode: z.enum(['blitz', 'rapid', 'casual', 'ranked']).default('ranked'),
  timeControl: z.enum(['1+0', '1+1', '2+1', '3+0', '3+1', '3+2', '5+0', '5+1', '10+0', '10+5', '15+10']).default('3+0'),
  // Coarse client-declared locality (e.g. IANA timezone); same-region
  // preference only, never a hard gate. Max 64 chars, free-form.
  region: z.string().min(1).max(64).optional(),
  // Client MAY suggest rating for display, but server uses stored rating.
});

export type MatchmakingJoinInput = z.infer<typeof MatchmakingJoinSchema>;

// ── Chat ─────────────────────────────────────────────
export const ChatMessageSchema = z.object({
  channelId: z.string().min(1).max(64),
  body: z.string().min(1).max(500),
});

export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;
