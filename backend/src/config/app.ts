/**
 * Typed application-level config (game + product defaults).
 * Values are constants with env overrides only where it makes sense.
 * Server never trusts client clocks / client ratings.
 */

export const TIME_CONTROLS = [
  { id: '1+0', baseSec: 60, incSec: 0 },
  { id: '1+1', baseSec: 60, incSec: 1 },
  { id: '3+0', baseSec: 180, incSec: 0 },
  { id: '3+1', baseSec: 180, incSec: 1 },
  { id: '5+0', baseSec: 300, incSec: 0 },
  { id: '5+1', baseSec: 300, incSec: 1 },
] as const;

export type TimeControlId = (typeof TIME_CONTROLS)[number]['id'];

export interface AppConfig {
  siteName: string;
  siteNameProvisional: boolean;
  matchmaking: {
    initialWindow: number;
    windowExpandPerSec: number;
    maxWindow: number;
    queueTtlSec: number;
  };
  reconnect: { graceSec: number };
  walls: { defaultPerPlayer: number; defaultBoardSize: number };
  timeControls: readonly { id: string; baseSec: number; incSec: number }[];
  defaultTimeControl: TimeControlId;
  chat: { maxMessageLength: number; rateLimitPerMin: number; historyPageSize: number };
  ai: { monthlyBudgetUsd: number; maxSessionsPerDay: number; maxTokensPerRequest: number };
  maintenance: boolean;
}

function readMaintenanceFlag(): boolean {
  const v = process.env['MAINTENANCE_MODE'];
  return v === 'true' || v === '1';
}

function readBudget(): number {
  const v = Number(process.env['AI_MONTHLY_BUDGET_USD']);
  return Number.isFinite(v) && v > 0 ? v : 25;
}

export const appConfig: AppConfig = {
  // Provisional codename until real brand/domain lands.
  siteName: 'PROJECT_NEXUS',
  siteNameProvisional: true,
  matchmaking: {
    initialWindow: 100,
    windowExpandPerSec: 25,
    maxWindow: 600,
    queueTtlSec: 120,
  },
  reconnect: { graceSec: 60 },
  walls: { defaultPerPlayer: 10, defaultBoardSize: 9 },
  timeControls: TIME_CONTROLS,
  defaultTimeControl: '3+0',
  chat: { maxMessageLength: 500, rateLimitPerMin: 20, historyPageSize: 50 },
  ai: { monthlyBudgetUsd: readBudget(), maxSessionsPerDay: 20, maxTokensPerRequest: 4000 },
  maintenance: readMaintenanceFlag(),
};

export function getTimeControl(id: string): { id: string; baseSec: number; incSec: number } | null {
  return TIME_CONTROLS.find((t) => t.id === id) ?? null;
}
