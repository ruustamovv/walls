/** Pino logger with requestId / userId correlation. */
import pino, { type Logger as PinoLogger } from 'pino';

const level = process.env['LOG_LEVEL'] ?? 'info';

export const logger: PinoLogger = pino({
  level: level === 'debug' || level === 'info' || level === 'warn' || level === 'error' ? level : 'info',
  base: { service: 'quoridor-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export interface LogContext {
  requestId?: string;
  userId?: string;
}

/** Child logger carrying correlation ids. */
export function childLogger(ctx: LogContext): PinoLogger {
  const bindings: Record<string, string> = {};
  if (ctx.requestId !== undefined) bindings['requestId'] = ctx.requestId;
  if (ctx.userId !== undefined) bindings['userId'] = ctx.userId;
  return logger.child(bindings);
}
