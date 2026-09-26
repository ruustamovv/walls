/**
 * AppError hierarchy + consistent wire shape.
 * Wire shape: { code, message, details?, requestId }
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'MAINTENANCE'
  | 'INTERNAL_ERROR';

export interface ErrorShape {
  code: ErrorCode;
  message: string;
  details?: Record<string, string[] | string> | undefined;
  requestId: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[] | string> | undefined;

  constructor(code: ErrorCode, status: number, message: string, details?: Record<string, string[] | string>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }

  toShape(requestId: string): ErrorShape {
    const shape: ErrorShape = { code: this.code, message: this.message, requestId };
    if (this.details !== undefined) shape.details = this.details;
    return shape;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: Record<string, string[] | string>) {
    super('VALIDATION_ERROR', 400, message, details);
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super('CONFLICT', 409, message);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super('RATE_LIMITED', 429, message);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super('INTERNAL_ERROR', 500, message);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toErrorShape(err: unknown, requestId: string): { status: number; body: ErrorShape } {
  if (isAppError(err)) return { status: err.status, body: err.toShape(requestId) };
  const message = err instanceof Error ? err.message : 'Internal server error';
  return {
    status: 500,
    body: { code: 'INTERNAL_ERROR', message, requestId },
  };
}
