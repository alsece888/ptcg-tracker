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

test('cloud profile restores collections and keeps newer local edits', () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  try {
    values.set(store.KEY, JSON.stringify({ watchlist: ['local'], personal: {
      playerName: 'Alice', playerNameAt: 10, decks: { own: { name: '本机卡组', updatedAt: 20 } },
      deckList: [{ id: 'atlas', name: '旧图鉴', updatedAt: 5 },
        { id: 'legacy-copy', name: '新图鉴', updatedAt: 4 }],
      watchlistStamps: { local: 20 }, matchHistory: [],
    } }));
    const remote = { version: 1, playerName: 'Alice', playerNameAt: 10,
      currentDeckId: 'own', currentDeckAt: 15,
      watchlist: ['remote'], watchlistStamps: { remote: 15 }, watchlistTombstones: { local: 30 },
      decks: { own: { name: '云端旧卡组', updatedAt: 10 }, other: { name: '云端卡组', updatedAt: 25 } },
      deckTombstones: {}, deckList: [{ id: 'atlas', name: '新图鉴', updatedAt: 40 }],
      deckListTombstones: {} };
    const merged = store.mergeCloud([], [], '', remote);
    assert.deepEqual(merged.watchlist, ['remote']);
    assert.equal(merged.personal.decks.own.name, '本机卡组');
    assert.equal(merged.personal.decks.other.name, '云端卡组');
    assert.equal(merged.personal.deckList[0].name, '新图鉴');
    assert.equal(merged.personal.deckList.filter((item) => item.name === '新图鉴').length, 1);
    assert.equal(merged.personal.currentDeckId, 'own');
    assert.deepEqual(store.cloudProfile(merged).watchlist, ['remote']);
  } finally { globalThis.localStorage = previousStorage; }
});

test('editing synced collections emits a sync event and stamps watchlist removal', () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  const previousDispatch = globalThis.dispatchEvent;
  const previousEvent = globalThis.Event;
  const events = [];
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.dispatchEvent = (event) => events.push(event.type);
  globalThis.Event = class { constructor(type) { this.type = type; } };
  try {
    const original = { watchlist: ['rival'], personal: {
      playerName: 'Alice', decks: {}, deckList: [], matchHistory: [],
    } };
    values.set(store.KEY, JSON.stringify(original));
    const next = structuredClone(original);
    next.watchlist = [];
    next.personal.decks.own = { name: '新卡组' };
    next.personal.deckList.push({ id: 'atlas', name: '图鉴卡组', icons: [] });
    const saved = store.applyState(next, original);
    assert.deepEqual(saved.watchlist, []);
    assert.ok(saved.personal.watchlistTombstones.rival > 0);
    assert.ok(saved.personal.decks.own.updatedAt > 0);
    assert.ok(saved.personal.deckList[0].updatedAt > 0);
    assert.ok(events.includes('ptcg-history-changed'));
    const remoteOld = { ...store.cloudProfile(original), watchlist: ['rival'] };
    assert.deepEqual(store.mergeCloud([], [], '', remoteOld).watchlist, []);
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.dispatchEvent = previousDispatch;
    globalThis.Event = previousEvent;
  }
});
