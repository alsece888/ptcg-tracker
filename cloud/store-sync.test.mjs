import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const store = require('../store.js');

test('cloud merge preserves remote timestamps and applies deletions permanently', () => {
  const values = new Map();
  const writes = [];
  const previousStorage = globalThis.localStorage;
  const previousDispatch = globalThis.dispatchEvent;
  const previousEvent = globalThis.Event;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem(key, value) { values.set(key, value); writes.push(key); },
    removeItem: (key) => values.delete(key),
  };
  const events = [];
  globalThis.dispatchEvent = (event) => events.push(event.type);
  globalThis.Event = class { constructor(type) { this.type = type; } };
  try {
    const local = { id: 'same', deckId: 'deck', deckName: '卡组', updatedAt: 100, deltaWins: 1 };
    values.set(store.KEY, JSON.stringify({ personal: { matchHistory: [local], decks: {} } }));
    const newer = { ...local, updatedAt: 200, deltaWins: 2 };
    const merged = store.mergeCloud([newer], [], '');
    assert.equal(merged.personal.matchHistory[0].updatedAt, 200);
    assert.equal(merged.personal.matchHistory[0].deltaWins, 2);
    const firstWrites = writes.filter((key) => key === store.KEY).length;
    store.mergeCloud([newer], [], '');
    assert.equal(writes.filter((key) => key === store.KEY).length, firstWrites);
    const deleted = store.mergeCloud([], [{ id: 'same', deletedAt: 50 }], '');
    assert.equal(deleted.personal.matchHistory.length, 0);
    assert.ok(deleted.personal.historyTombstones.same > 200);
    const deletedWrites = writes.filter((key) => key === store.KEY).length;
    store.mergeCloud([], [{ id: 'same', deletedAt: 50 }], '');
    assert.equal(writes.filter((key) => key === store.KEY).length, deletedWrites);
    assert.ok(events.includes('ptcg-history-changed'));
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.dispatchEvent = previousDispatch;
    globalThis.Event = previousEvent;
  }
});
