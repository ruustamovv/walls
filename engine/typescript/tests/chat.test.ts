/** Ranked quick-chat presets: exact match only, no strategy smuggling. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_CHAT, isQuickChat } from '../index.js';

describe('chat: quick-chat presets', () => {
  it('defines exactly five short sportsmanlike presets', () => {
    assert.deepEqual([...QUICK_CHAT], ['Good luck', 'Nice move', 'Well played', 'Good game', 'Rematch?']);
    for (const q of QUICK_CHAT) {
      assert.ok(q.length <= 12, `preset stays short: ${q}`);
    }
  });

  it('matches exactly (trimmed) and rejects everything else', () => {
    assert.equal(isQuickChat('Good luck'), true);
    assert.equal(isQuickChat('  Nice move  '), true);
    assert.equal(isQuickChat('good luck'), false);
    assert.equal(isQuickChat('Good luck!'), false);
    assert.equal(isQuickChat('wall h 2,2'), false);
    assert.equal(isQuickChat(''), false);
    assert.equal(isQuickChat(' resign now, trust me '), false);
  });
});
