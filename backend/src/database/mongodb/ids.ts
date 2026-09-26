/**
 * ID boundary utility — the ONLY place that converts between MongoDB
 * native `ObjectId` and application string IDs.
 *
 * Rule: `ObjectId` never crosses `backend/src/database/mongodb/`.
 * Repositories return documents with `_id: string` (hex); services, API
 * schemas, WebSocket payloads, and frontend types only ever see strings.
 */
import { ObjectId } from 'mongodb';

export class InvalidIdError extends Error {
  constructor(value: unknown) {
    super(`invalid id: ${typeof value === 'string' ? value : typeof value}`);
  }
}

/** Mongo `_id` (ObjectId or string) → domain string ID. */
export function toDomainId(value: unknown): string {
  if (value instanceof ObjectId) return value.toHexString();
  if (typeof value === 'string' && value.length > 0) return value;
  throw new InvalidIdError(value);
}

/**
 * Domain string ID → Mongo `ObjectId` for query filters.
 * Throws `InvalidIdError` on malformed input instead of silently
 * constructing a query that can never match.
 */
export function toObjectId(value: string): ObjectId {
  if (typeof value !== 'string' || !ObjectId.isValid(value)) {
    throw new InvalidIdError(value);
  }
  return new ObjectId(value);
}

/** Like `toObjectId`, but returns null (no match) instead of throwing. */
export function tryToObjectId(value: string): ObjectId | null {
  if (typeof value !== 'string' || !ObjectId.isValid(value)) return null;
  return new ObjectId(value);
}

/**
 * Map a raw Mongo document to a domain object with a string `_id`.
 * Use for every repository return value (single docs AND list items).
 */
export function withDomainId<T>(raw: Record<string, unknown>): T {
  return { ...raw, _id: toDomainId(raw['_id']) } as T;
}
