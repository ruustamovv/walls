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

describe('ai coach', () => {
  it('returns the model explanation grounded in engine facts', async () => {
    stubFetch('That wall gained one step; the reference gains four by sealing the left corridor.');
    const res = await coachExplanation('u-coach-1', 'groq', FACTS);
    assert.equal(res.ok, true);
    assert.ok((res.explanation ?? '').includes('reference gains four'));
    assert.equal(res.provider, 'groq');
  });

  it('rejects malformed provider responses instead of rendering them', async () => {
    globalThis.fetch = (async () => new Response('not json', { status: 200 })) as typeof fetch;
    const res = await coachExplanation('u-coach-2', 'groq', FACTS);
    assert.equal(res.ok, false);
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
