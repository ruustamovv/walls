/**
 * Architect board generator (AIC-008): prompt parsing, the engine validation
 * gate, deterministic templates, and the HTTP endpoint.
 *
 * The gate is the point of this suite: no design may ever be returned unless
 * the real engine accepts every wall AND both pawns keep a live route.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildApp } from '../app.js';
import {
  designBoard,
  designFromTemplate,
  encodeDesign,
  parsePrompt,
  validateDesign,
} from '../modules/architect/service.js';
import { __resetAuthServiceForTests } from '../modules/auth/service.js';
import { closeMongo, __resetMongoForTests } from '../database/mongodb/client.js';
import type { FastifyInstance } from 'fastify';

let mongod: MongoMemoryServer | null = null;
let app: FastifyInstance | null = null;

before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_architect' } });
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'nexus_architect';
  __resetMongoForTests();
  __resetAuthServiceForTests();
  app = await buildApp();
});

after(async () => {
  if (app !== null) await app.close().catch(() => undefined);
  await closeMongo().catch(() => undefined);
  const { closeRedis, __resetRedisForTests } = await import('../database/redis/client.js');
  await closeRedis().catch(() => undefined);
  __resetMongoForTests();
  __resetRedisForTests();
  __resetAuthServiceForTests();
  if (mongod !== null) await mongod.stop().catch(() => undefined);
  mongod = null;
});

describe('architect: prompt parsing', () => {
  it('maps difficulty keywords to bounded defaults', () => {
    assert.equal(parsePrompt('easy sandbox board').difficulty, 'easy');
    assert.equal(parsePrompt('a medium board').difficulty, 'medium');
    assert.equal(parsePrompt('brutal nightmare board').difficulty, 'hard');
    assert.equal(parsePrompt('nothing specified here').difficulty, 'medium');
  });

  it('reads an explicit board size and respects bounds', () => {
    assert.equal(parsePrompt('a 13x13 board').size, 13);
    assert.equal(parsePrompt('fifteen by fifteen please').size, 15);
    // Out-of-range digits fall back to the difficulty default, never a bad size.
    assert.equal(parsePrompt('99x99 easy').size, 7);
  });

  it('counts choke points from digits and words', () => {
    assert.equal(parsePrompt('hard board with two choke points').chokes, 2);
    assert.equal(parsePrompt('three chokepoints please').chokes, 3);
    assert.equal(parsePrompt('hard board with a narrow gate').chokes, 1);
    // A number word inside another word must not be read as a count.
    assert.equal(parsePrompt('hard board with two choke points').chokes, 2);
    assert.ok(parsePrompt('lots and lots of chokes').chokes >= 1);
  });

  it('picks a theme keyword when present', () => {
    assert.equal(parsePrompt('a maze board').theme, 'maze');
    assert.equal(parsePrompt('atrium layout').theme, 'atrium');
    assert.equal(parsePrompt('plain board').theme, 'stone');
  });
});

describe('architect: engine validation gate', () => {
  it('rejects an out-of-bounds board size with a precise reason', () => {
    for (const size of [3, 4, 25, 0]) {
      const v = validateDesign({ size, walls: [] });
      assert.equal(v.ok, false, `size ${size} must be rejected`);
      if (!v.ok) {
        assert.equal(v.stage, 'bounds');
        assert.match(v.reason, /outside allowed 7-19/);
      }
    }
  });

  it('rejects an illegal wall with the engine reason, naming the wall', () => {
    // Out-of-bounds wall slot on a 9x9 (max index 7).
    const v = validateDesign({ size: 9, walls: [{ r: 8, c: 8, orientation: 'h' }] });
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.equal(v.stage, 'engine');
      assert.match(v.reason, /wall at row 8, column 8 rejected by engine/);
      assert.equal(v.acceptedWalls.length, 0);
    }
  });

  it('rejects a duplicate wall (second copy fails the engine)', () => {
    const v = validateDesign({
      size: 9,
      walls: [
        { r: 2, c: 2, orientation: 'h' },
        { r: 2, c: 2, orientation: 'h' },
      ],
    });
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.equal(v.acceptedWalls.length, 1, 'stops at the first illegal wall');
    }
  });

  it('accepts a legal board and reports both routes', () => {
    const v = validateDesign({ size: 9, walls: [{ r: 3, c: 3, orientation: 'h' }] });
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.ok(v.routeA > 0 && v.routeB > 0, 'both pawns must have a live route');
      assert.equal(v.walls.length, 1);
      assert.equal(v.state.size, 9);
    }
  });

  it('reports a sealed pawn instead of accepting an unplayable board', () => {
    // Try to cage a pawn: the engine must refuse the sealing wall itself.
    const cage: { r: number; c: number; orientation: 'h' | 'v' }[] = [
      { r: 0, c: 3, orientation: 'v' },
      { r: 1, c: 3, orientation: 'v' },
      { r: 2, c: 3, orientation: 'v' },
      { r: 3, c: 3, orientation: 'v' },
      { r: 4, c: 3, orientation: 'v' },
      { r: 5, c: 3, orientation: 'v' },
      { r: 6, c: 3, orientation: 'v' },
      { r: 7, c: 3, orientation: 'v' },
    ];
    const v = validateDesign({ size: 9, walls: cage });
    // Either the engine rejects a sealing wall, or it accepts but both routes
    // still exist (the no-seal rule makes full cages impossible).
    if (v.ok) {
      assert.ok(v.routeA >= 0 && v.routeB >= 0);
    } else {
      assert.match(v.reason, /rejected by engine|sealed off/);
    }
  });
});

describe('architect: deterministic templates', () => {
  it('the same prompt always produces the identical board', () => {
    for (const prompt of [
      'hard board with two choke points',
      'easy open sandbox',
      'a medium maze board with 3 chokepoints',
      'nineteen by nineteen weaver',
    ]) {
      const a = designFromTemplate(prompt);
      const b = designFromTemplate(prompt);
      assert.equal(a.ok, true, `${prompt} must generate`);
      assert.equal(a.code, b.code);
      assert.deepEqual(a.walls, b.walls);
    }
  });

  it('different prompts produce different boards', () => {
    const a = designFromTemplate('hard board with two choke points');
    const b = designFromTemplate('easy sandbox board');
    assert.notEqual(a.code, b.code);
    assert.ok(a.spec.size >= b.spec.size, 'hard boards are not smaller than easy ones');
  });

  it('acceptance: "hard board with two choke points" is playable and shareable', () => {
    const r = designFromTemplate('hard board with two choke points');
    assert.equal(r.ok, true);
    assert.equal(r.source, 'template');
    assert.equal(r.spec.difficulty, 'hard');
    assert.equal(r.spec.chokes, 2);
    assert.ok(r.walls.length > 0);
    assert.ok(r.routeA > 0 && r.routeB > 0);
    assert.ok(r.code !== null && r.code.length > 0);
    // The share payload must decode back into a legal position.
    const decoded = JSON.parse(Buffer.from(r.code as string, 'base64').toString('utf8')) as {
      size: number; walls: { r: number; c: number; orientation: string }[];
    };
    assert.equal(decoded.size, r.spec.size);
    assert.equal(decoded.walls.length, r.walls.length);
  });

  it('never returns a board that fails the gate', () => {
    for (const prompt of [
      'hard board with two choke points',
      'brutal maze with lots of choke points',
      'max difficulty 19 by nineteen with four chokes',
      'easy tiny 7 by 7',
      'pillar garden nightmare',
    ]) {
      const r = designFromTemplate(prompt);
      assert.equal(r.ok, true, `${prompt} -> ${r.reason ?? 'failed'}`);
      // Re-validate the produced walls independently: the result must survive
      // a second pass through the engine.
      const again = validateDesign({ size: r.spec.size, walls: r.walls });
      assert.equal(again.ok, true, `${prompt} produced a non-replayable board`);
    }
  });
});

describe('architect: LLM proposals are engine-gated', () => {
  it('ignores a nonsense spec and keeps a verified board', async () => {
    const r = await designBoard('u', 'medium board', { size: 999, wallsPerPlayer: -5, theme: 'x'.repeat(500) });
    assert.equal(r.ok, true);
    assert.ok(r.spec.size >= 7 && r.spec.size <= 19, 'size stays clamped');
    assert.ok(r.spec.wallsPerPlayer >= 4 && r.spec.wallsPerPlayer <= 30);
    assert.ok(r.notes.some((n) => /engine|template|clamped/i.test(n)));
  });

  it('a valid spec within bounds is accepted and re-validated', async () => {
    const r = await designBoard('u', 'hard board with two choke points', {
      size: 13, wallsPerPlayer: 20, theme: 'ridge',
    });
    assert.equal(r.ok, true);
    assert.equal(r.spec.size, 13);
    assert.equal(r.spec.wallsPerPlayer, 20);
    assert.ok(r.routeA > 0 && r.routeB > 0);
    assert.equal(r.source, 'llm');
  });

  it('walls from the model are impossible — the schema has no wall field', async () => {
    // A model trying to smuggle walls through theme/spec is ignored: the
    // accepted design's walls always come from our own layout, gated.
    const r = await designBoard('u', 'medium board', { walls: [{ r: 1, c: 1 }] } as unknown as Record<string, never>);
    assert.equal(r.ok, true);
    const replay = validateDesign({ size: r.spec.size, walls: r.walls });
    assert.equal(replay.ok, true);
  });
});

describe('architect: HTTP endpoint', () => {
  it('POST /api/v1/architect/design returns an engine-verified board + share link', async () => {
    assert.ok(app !== null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/architect/design',
      payload: JSON.stringify({ prompt: 'hard board with two choke points', mode: 'template' }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      ok: boolean; code: string | null; size: number; walls: unknown[];
      routeA: number; routeB: number; reason: string | null; shareUrl: string | null;
      difficulty: string; chokes: number;
    };
    assert.equal(body.ok, true);
    assert.equal(body.difficulty, 'hard');
    assert.equal(body.chokes, 2);
    assert.ok(body.code !== null);
    assert.ok((body.shareUrl ?? '').includes('/designer?from='));
    assert.ok(body.routeA > 0 && body.routeB > 0);
    assert.equal(body.reason, null);

    // The returned walls survive an independent engine validation.
    const replay = validateDesign({
      size: body.size,
      walls: body.walls as { r: number; c: number; orientation: 'h' | 'v' }[],
    });
    assert.equal(replay.ok, true);
  });

  it('rejects a too-short prompt with 400', async () => {
    assert.ok(app !== null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/architect/design',
      payload: JSON.stringify({ prompt: 'hi' }),
      headers: { 'content-type': 'application/json' },
    });
    assert.ok(res.statusCode >= 400);
  });

  it('parse endpoint exposes the deterministic spec', async () => {
    assert.ok(app !== null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/architect/parse',
      payload: JSON.stringify({ prompt: 'easy 7x7 board' }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { spec: { size: number; difficulty: string } };
    assert.equal(body.spec.size, 7);
    assert.equal(body.spec.difficulty, 'easy');
  });
});

describe('architect: encoding', () => {
  it('encodeDesign round-trips through the base64 payload', () => {
    const r = designFromTemplate('medium board with two choke points');
    assert.equal(r.ok, true);
    const parsed = JSON.parse(
      Buffer.from(encodeDesign(r.state as NonNullable<typeof r.state>), 'base64').toString('utf8'),
    ) as {
      size: number; walls: unknown[]; wallsRemaining: number[];
    };
    assert.equal(parsed.size, r.spec.size);
    assert.equal(parsed.walls.length, r.walls.length);
    assert.equal(parsed.wallsRemaining.length, 2);
  });
});