/**
 * AI coach: live-call shape with stubbed fetch (no network), quota
 * enforcement, honest unimplemented-provider + unconfigured states.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { coachExplanation } from '../modules/ai/complete.js';

const FACTS = {
  moveNumber: 12,
  playedAction: 'wall h 3,3',
  bestAction: 'wall h 2,4',
  ownPathBefore: 9,
  ownPathAfter: 9,
  oppPathBefore: 10,
  oppPathAfter: 11,
};

const realFetch = globalThis.fetch;
const realKey = process.env['GROQ_API_KEY'];

function stubFetch(text: string, usage = { prompt_tokens: 50, completion_tokens: 40 }): void {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: text } }],
    usage,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
}

before(() => {
  process.env['GROQ_API_KEY'] = 'test-key-1234';
});

after(async () => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env['GROQ_API_KEY'];
  else process.env['GROQ_API_KEY'] = realKey;
  const { closeRedis, __resetRedisForTests } = await import('../database/redis/client.js');
  await closeRedis().catch(() => undefined);
  __resetRedisForTests();
});

describe('ai commentary + fallback chain', () => {
  const FACTS2 = {
    moves: 24, turn: 0 as 0 | 1, status: 'active', lastActions: ['move 5,4', 'wall h 3,3'],
    ownPath: 7, oppPath: 9, clockSec: [95, 110] as [number, number], winnerSeat: null,
  };

  it('narrates verified facts', async () => {
    const { commentate } = await import('../modules/ai/complete.js');
    stubFetch('Seat 0 presses forward, routes 7 versus 9.');
    const res = await commentate('u-com-1', 'groq', FACTS2);
    assert.equal(res.ok, true);
    assert.ok((res.explanation ?? '').includes('routes 7 versus 9'));
  });

  it('falls back across providers, then to canned engine text', async () => {
    const { commentate } = await import('../modules/ai/complete.js');
    process.env['OPENAI_API_KEY'] = 'test-key-openai';
    try {
      globalThis.fetch = (async (url: unknown) => {
        const u = String(url);
        if (u.includes('groq')) return new Response('boom', { status: 500 });
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'OpenAI narrative.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch;
      const res = await commentate('u-com-2', 'groq', FACTS2);
      assert.equal(res.ok, true);
      assert.equal(res.provider, 'openai');
      assert.ok((res.explanation ?? '').includes('OpenAI narrative'));

      globalThis.fetch = (async () => new Response('down', { status: 500 })) as typeof fetch;
      const canned = await commentate('u-com-3', 'groq', FACTS2);
      assert.equal(canned.ok, true);
      assert.ok((canned.explanation ?? '').includes('Engine summary'));
    } finally {
      delete process.env['OPENAI_API_KEY'];
    }
  });
});

describe('ai coach', () => {
  it('returns the model explanation grounded in engine facts', async () => {
    stubFetch('That wall gained one step; the reference gains four by sealing the left corridor.');
    const res = await coachExplanation('u-coach-1', 'groq', FACTS);
    assert.equal(res.ok, true);
    assert.ok((res.explanation ?? '').includes('reference gains four'));
    assert.equal(res.provider, 'groq');
  });

  it('degrades malformed provider responses to canned engine text', async () => {
    globalThis.fetch = (async () => new Response('not json', { status: 200 })) as typeof fetch;
    const res = await coachExplanation('u-coach-2', 'groq', FACTS);
    assert.equal(res.ok, true);
    assert.ok((res.explanation ?? '').includes('Engine summary'));
  });

  it('is honest about unimplemented providers', async () => {
    const res = await coachExplanation('u-coach-3', 'anthropic', FACTS);
    assert.equal(res.ok, false);
    assert.ok((res.error ?? '').includes('not implemented'));
  });

  it('reports unconfigured keys without calling the network', async () => {
    delete process.env['GROQ_API_KEY'];
    let called = false;
    globalThis.fetch = ((async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown) as typeof fetch;
    const res = await coachExplanation('u-coach-4', 'groq', FACTS);
    assert.equal(res.ok, false);
    assert.equal(called, false);
    process.env['GROQ_API_KEY'] = 'test-key-1234';
  });
});
