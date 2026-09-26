#!/usr/bin/env node
/**
 * owner-create — guided owner bootstrap STUB (no DB yet).
 * Reads OWNER_EMAIL / OWNER_USERNAME / OWNER_INITIAL_PASSWORD from env,
 * validates shape, explains server-side hashing, refuses production
 * without --allow-production. Real insert lands in Phase 03.
 */
const { OWNER_EMAIL, OWNER_USERNAME, OWNER_INITIAL_PASSWORD, NODE_ENV } = process.env;
const allowProd = process.argv.includes("--allow-production");

function fail(msg) { console.error(`[owner:create] ERROR: ${msg}`); process.exit(1); }

if (NODE_ENV === "production" && !allowProd)
  fail("refusing production bootstrap without --allow-production. Re-run with the flag AND a one-time password.");

if (!OWNER_EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(OWNER_EMAIL))
  fail("OWNER_EMAIL missing/invalid (e.g. owner@example.com).");
if (!OWNER_USERNAME || !/^[a-zA-Z0-9_.]{3,32}$/.test(OWNER_USERNAME))
  fail("OWNER_USERNAME missing/invalid (3-32 chars: letters/digits/._).");
if (!OWNER_INITIAL_PASSWORD || OWNER_INITIAL_PASSWORD.length < 12)
  fail("OWNER_INITIAL_PASSWORD missing/too short (min 12 chars, single-use).");
if (/PASTE_YOUR/i.test(OWNER_INITIAL_PASSWORD))
  fail("OWNER_INITIAL_PASSWORD is still the placeholder — set a real one-time value.");

console.log(`[owner:create] validated owner candidate: ${OWNER_USERNAME} <${OWNER_EMAIL}>`);
console.log("[owner:create] password policy: OK (length + non-placeholder).");
console.log("[owner:create] NOTE: hashing (argon2id) and DB insert happen server-side in Phase 03.");
console.log("[owner:create] STUB complete — no user was created. Rotate the bootstrap password after first login.");
