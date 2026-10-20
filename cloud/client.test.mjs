import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../cloud.js', import.meta.url), 'utf8');

function browser(responses, initial = {}) {
  const ids = ['cloudUserIdInput', 'cloudPasswordInput', 'cloudPasswordConfirmInput', 'cloudStatus',
    'cloudRegisterBtn', 'cloudLoginBtn', 'cloudLogoutBtn', 'cloudUploadBtn'];
  const elements = Object.fromEntries(ids.map((id) => [id, {
    value: '', disabled: false, style: {}, textContent: '', listeners: {},
    classList: { toggle() {} },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  }]));
  elements.cloudPasswordInput.value = 'strong-password-123';
  elements.cloudPasswordConfirmInput.value = 'strong-password-123';
  const storage = () => {
    const map = new Map();
    return { getItem: (key) => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
  };
  const localStorage = storage();
  const sessionStorage = storage();
  const calls = [];
  const windowListeners = {};
  const intervals = [];
  let data = { personal: { playerName: 'Alice', matchHistory: initial.records || [], historyTombstones: initial.deleted || {} } };
  const context = {
    window: { PTCG_CLOUD_API_URL: 'https://bridge.example', addEventListener(name, callback) { windowListeners[name] = callback; } },
    document: { hidden: false, getElementById: (id) => elements[id], addEventListener() {} },
    localStorage, sessionStorage, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
    setInterval: (callback, ms) => { intervals.push(ms); return 0; }, TextEncoder, crypto, btoa, atob,
    PtcgStore: {
      KEY: 'ptcg-tracker-data', read: () => structuredClone(data),
      cloudProfile: () => ({ version: 1, playerName: data.personal.playerName, playerNameAt: 0,
        currentDeckId: null, currentDeckAt: 0, watchlist: [], watchlistStamps: {},
        watchlistTombstones: {}, decks: {}, deckTombstones: {}, deckList: [], deckListTombstones: {} }),
      mergeCloud(records, deleted, playerName) {
        const next = structuredClone(data);
        if (!next.personal.playerName) next.personal.playerName = playerName;
        for (const item of deleted) {
          next.personal.historyTombstones[item.id] = item.deletedAt;
          next.personal.matchHistory = next.personal.matchHistory.filter((entry) => entry.id !== item.id);
        }
        for (const entry of records) {
          if (next.personal.historyTombstones[entry.id]) continue;
          const old = next.personal.matchHistory.find((item) => item.id === entry.id);
          if (!old) next.personal.matchHistory.push(entry);
          else if (entry.updatedAt > old.updatedAt) Object.assign(old, entry);
        }
        data = next;
        return structuredClone(data);
      },
    },
    loadData() {}, render() {}, renderPersonalSection() {},
    fetch: async (url, options = {}) => {
      calls.push({ path: new URL(url).pathname, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
      const next = responses.shift();
      if (!next) throw new Error('Unexpected request');
      if (next instanceof Error) throw next;
      return { ok: next.status < 400, status: next.status, json: async () => next.body };
    },
  };
  vm.runInNewContext(source, context);
  elements.cloudUserIdInput.value = 'ALICE';
  const setSession = () => {
    localStorage.setItem('ptcg-cloud-user-id', 'alice');
    sessionStorage.setItem('ptcg-cloud-session', JSON.stringify({ userId: 'alice', token: 'session' }));
  };
  return {
    elements, calls, localStorage, sessionStorage, windowListeners, intervals, setSession,
    read: () => structuredClone(data),
    clickRegister: () => elements.cloudRegisterBtn.listeners.click(),
    clickSync: () => elements.cloudUploadBtn.listeners.click(),
  };
}

const emptyCloud = { userId: 'alice', playerName: '', records: [], deleted: [] };
const savedProfile = { version: 1, playerName: 'Alice', playerNameAt: 0,
  currentDeckId: null, currentDeckAt: 0, watchlist: [], watchlistStamps: {},
  watchlistTombstones: {}, decks: {}, deckTombstones: {}, deckList: [], deckListTombstones: {} };

test('registration retries a lost network request, then starts automatic sync', async () => {
  const page = browser([
    new TypeError('Failed to fetch'),
    { status: 201, body: { userId: 'alice', token: 'session' } },
    { status: 200, body: emptyCloud },
    { status: 200, body: { profile: savedProfile } },
  ]);
  await page.clickRegister();
  assert.deepEqual(page.calls.map((call) => call.path), ['/api/auth/register', '/api/auth/register', '/api/records', '/api/profile']);
  assert.equal(JSON.parse(page.sessionStorage.getItem('ptcg-cloud-session')).userId, 'alice');
  assert.equal(page.elements.cloudPasswordInput.value, '');
});

test('registration recovers by logging in when first request created the account', async () => {
  const page = browser([
    new TypeError('Failed to fetch'),
    { status: 409, body: { error: '这个用户 ID 已被使用' } },
    { status: 200, body: { userId: 'alice', token: 'recovered' } },
    { status: 200, body: emptyCloud },
    { status: 200, body: { profile: savedProfile } },
  ]);
  await page.clickRegister();
  assert.deepEqual(page.calls.map((call) => call.path), ['/api/auth/register', '/api/auth/register', '/api/auth/login', '/api/records', '/api/profile']);
  assert.equal(JSON.parse(page.sessionStorage.getItem('ptcg-cloud-session')).token, 'recovered');
});

test('persistent network failure gives a useful message and keeps password for retry', async () => {
  const page = browser([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
  await page.clickRegister();
  assert.match(page.elements.cloudStatus.textContent, /无法连接云端服务/);
  assert.equal(page.elements.cloudPasswordInput.value, 'strong-password-123');
  assert.equal(page.sessionStorage.getItem('ptcg-cloud-session'), null);
});

test('automatic sync uploads local history and merges remote updates', async () => {
  const old = { id: 'local', updatedAt: 10, result: 'win' };
  const remote = { id: 'remote', updatedAt: 20, result: 'loss' };
  const page = browser([
    { status: 200, body: { ...emptyCloud, records: [remote] } },
    { status: 200, body: { created: 1, updated: 0, skipped: 0 } },
    { status: 200, body: { profile: savedProfile } },
  ], { records: [old] });
  page.setSession();
  await page.clickSync();
  assert.deepEqual(page.read().personal.matchHistory.map((entry) => entry.id).sort(), ['local', 'remote']);
  assert.deepEqual(page.calls.map((call) => call.path), ['/api/records', '/api/records/upload', '/api/profile']);
  assert.deepEqual(page.calls[1].body.records.map((entry) => entry.id), ['local']);
});

test('automatic sync sends deletions and does not resurrect deleted cloud records', async () => {
  const page = browser([
    { status: 200, body: { ...emptyCloud, records: [{ id: 'gone', updatedAt: 10 }] } },
    { status: 200, body: { created: 1, updated: 0, skipped: 0 } },
    { status: 200, body: { profile: savedProfile } },
  ], { deleted: { gone: 30 } });
  page.setSession();
  await page.clickSync();
  assert.equal(page.read().personal.matchHistory.length, 0);
  assert.deepEqual(page.calls[1].body.deleted.map((item) => item.id), ['gone']);
  assert.equal(page.calls[1].body.records.length, 0);
});

test('a local history event queues automatic sync', async () => {
  const page = browser([{ status: 200, body: emptyCloud }, { status: 200, body: { profile: savedProfile } }]);
  page.setSession();
  page.windowListeners['ptcg-history-changed']();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(page.calls.map((call) => call.path), ['/api/records', '/api/profile']);
  assert.deepEqual(page.intervals, [600000]);
});
