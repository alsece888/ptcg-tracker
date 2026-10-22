import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from './worker.mjs';

function mockTeable() {
  const rows = new Map();
  let nextId = 0;
  const calls = [];
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    calls.push({ method, path: parsed.pathname });
    if (parsed.pathname.endsWith('/field')) {
      return Response.json([{ id: 'fldUserId', name: '用户ID' }, { id: 'fldRecordId', name: '记录ID' },
        { id: 'fldProfile', name: '同步资料', type: 'longText' }]);
    }
    if (parsed.pathname.endsWith('/record') && method === 'GET') {
      const filter = JSON.parse(parsed.searchParams.get('filter'));
      const { fieldId, value } = filter.filterSet[0];
      const fieldName = fieldId === 'fldRecordId' ? '记录ID' : '用户ID';
      const filtered = [...rows.values()].filter((row) => row.fields[fieldName] === value);
      const skip = Number(parsed.searchParams.get('skip')) || 0;
      const take = Number(parsed.searchParams.get('take')) || 100;
      return Response.json({ records: filtered.slice(skip, skip + take) });
    }
    if (parsed.pathname.endsWith('/record') && method === 'POST') {
      const body = JSON.parse(options.body);
      const created = [];
      for (const record of body.records) {
        if ([...rows.values()].some((row) => row.fields['记录ID'] === record.fields['记录ID'])) {
          return Response.json({ message: 'duplicate' }, { status: 409 });
        }
        const row = { id: `rec${++nextId}`, fields: record.fields };
        rows.set(row.id, row);
        created.push(row);
      }
      return Response.json({ records: created }, { status: 201 });
    }
    if (method === 'PATCH') {
      const id = parsed.pathname.split('/').pop();
      const row = rows.get(id);
      if (!row) return Response.json({}, { status: 404 });
      Object.assign(row.fields, JSON.parse(options.body).record.fields);
      return Response.json(row);
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  return { fetch, rows, calls };
}

const env = {
  SITE_ORIGINS: 'https://malo-ptcg.cn',
  TEABLE_TOKEN: 'test-only',
  TEABLE_TABLE_ID: 'tblvmcKar5T76mmII8D',
  AUTH_SECRET: 'test-only-secret-with-at-least-32-characters',
  AUTH_RATE: { limit: async () => ({ success: true }) },
  READ_RATE: { limit: async () => ({ success: true }) },
  WRITE_RATE: { limit: async () => ({ success: true }) },
};

async function api(method, path, body, token = '', origin = 'https://malo-ptcg.cn') {
  const request = new Request(`https://bridge.example${path}`, {
    method,
    headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await worker.fetch(request, env);
  return { status: result.status, body: await result.json() };
}

const proof = 'A'.repeat(43);
const badProof = 'C'.repeat(43);
const salt = 'B'.repeat(22);
async function register(userId) {
  const result = await api('POST', '/api/auth/register', { userId, proof, salt });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.token;
}

test('sessions last 48 hours, survive the next day, then expire', async () => {
  const mock = mockTeable();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const start = originalNow();
  globalThis.fetch = mock.fetch;
  Date.now = () => start;
  try {
    assert.equal((await api('GET', '/api/auth/config')).body.sessionTtlSeconds, 48 * 60 * 60);
    const token = await register('ttl-check');
    assert.equal(Number(token.split('.')[1]), Math.floor(start / 1000) + 48 * 60 * 60);
    Date.now = () => start + 47 * 60 * 60 * 1000;
    assert.equal((await api('GET', '/api/records', undefined, token)).status, 200);
    Date.now = () => start + 48 * 60 * 60 * 1000 + 1000;
    assert.equal((await api('GET', '/api/records', undefined, token)).status, 401);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

function record(id, extra = {}) {
  return {
    id, deckId: 'deck-1', deckName: '测试卡组',
    time: '2026-10-20T08:00:00.000Z', updatedAt: 1792483200000,
    deltaWins: 1, deltaLosses: 0, ...extra,
  };
}

test('upload is idempotent, keeps grouped/ambiguous records, and isolates IDs', async () => {
  const mock = mockTeable();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  try {
    const unknownSaltA = await api('GET', '/api/auth/salt?userId=unknown');
    const unknownSaltB = await api('GET', '/api/auth/salt?userId=unknown');
    assert.equal(unknownSaltA.body.salt, unknownSaltB.body.salt);
    assert.equal(unknownSaltA.body.salt.length, 22);
    const aliceToken = await register('Alice');
    const otherToken = await register('other');
    const account = [...mock.rows.values()].find((row) => row.fields['记录ID'] === 'alice:account');
    assert.ok(account);
    assert.equal(account.fields['密码盐'], salt);
    assert.ok(account.fields['密码校验值']);
    assert.equal(account.fields['密码'], undefined);
    assert.equal((await api('GET', '/api/auth/salt?userId=alice')).body.salt, salt);
    assert.equal((await api('POST', '/api/auth/login', { userId: 'alice', proof: badProof })).status, 401);
    assert.equal((await api('POST', '/api/auth/login', { userId: 'alice', proof })).status, 200);
    assert.equal((await api('GET', '/api/records')).status, 401);
    const sample = [record('one', { result: 'win' }), record('group', { deltaWins: 3, deltaLosses: 1 }), record('ambiguous', { deltaWins: 0, deltaLosses: 0 }), record('legacy-win')];
    const first = await api('POST', '/api/records/upload', { userId: 'Alice', playerName: '测试玩家', records: sample }, aliceToken);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { created: 4, updated: 0, skipped: 0 });
    const again = await api('POST', '/api/records/upload', { userId: 'alice', playerName: '测试玩家', records: sample }, aliceToken);
    assert.deepEqual(again.body, { created: 0, updated: 0, skipped: 4 });
    assert.equal(mock.rows.size, 6);
    assert.equal((await api('POST', '/api/records/upload', { userId: 'other', records: [record('hack')] }, aliceToken)).status, 403);
    const other = await api('POST', '/api/records/upload', { userId: 'other', records: [record('one', { result: 'loss', deltaWins: 0, deltaLosses: 1 })] }, otherToken);
    assert.equal(other.body.created, 1);
    const alice = await api('GET', '/api/records', undefined, aliceToken);
    assert.equal(alice.body.records.length, 4);
    assert.equal(alice.body.records.find((entry) => entry.id === 'group').deltaWins, 3);
    assert.equal(alice.body.records.find((entry) => entry.id === 'ambiguous').result, undefined);
    assert.equal(alice.body.records.find((entry) => entry.id === 'one').result, 'win');
    assert.equal(alice.body.records.find((entry) => entry.id === 'legacy-win').result, 'win');
    const otherRead = await api('GET', '/api/records', undefined, otherToken);
    assert.equal(otherRead.body.records.length, 1);
    assert.equal(otherRead.body.records[0].result, 'loss');
    const changed = record('one', { result: 'loss', deltaWins: 0, deltaLosses: 1, updatedAt: 1792483201000 });
    const update = await api('POST', '/api/records/upload', { userId: 'alice', records: [changed] }, aliceToken);
    assert.equal(update.body.updated, 1);
    assert.equal((await api('GET', '/api/records', undefined, aliceToken)).body.records.find((entry) => entry.id === 'one').result, 'loss');
    const removal = await api('POST', '/api/records/upload', { userId: 'alice', records: [],
      deleted: [{ id: 'one', deletedAt: 1792483202000 }] }, aliceToken);
    assert.deepEqual(removal.body, { created: 1, updated: 0, skipped: 0 });
    const afterDelete = await api('GET', '/api/records', undefined, aliceToken);
    assert.equal(afterDelete.body.records.some((entry) => entry.id === 'one'), false);
    assert.deepEqual(afterDelete.body.deleted, [{ id: 'one', deletedAt: 1792483202000 }]);
    const stale = await api('POST', '/api/records/upload', { userId: 'alice', records: [changed] }, aliceToken);
    assert.equal(stale.body.skipped, 1);
    const repeated = await api('POST', '/api/records/upload', { userId: 'alice', records: [],
      deleted: [{ id: 'one', deletedAt: 1792483202000 }] }, aliceToken);
    assert.equal(repeated.body.skipped, 1);
    assert.equal((await api('GET', '/api/records', undefined, aliceToken + 'tampered')).status, 401);
    assert.ok(mock.calls.some((call) => call.method === 'PATCH'));
  } finally { globalThis.fetch = originalFetch; }
});

test('rejects invalid inputs and unauthorized browser origins', async () => {
  const mock = mockTeable();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  try {
    const preflight = await worker.fetch(new Request('https://bridge.example/api/records/upload', {
      method: 'OPTIONS', headers: { Origin: 'https://malo-ptcg.cn', 'Access-Control-Request-Method': 'POST' },
    }), env);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://malo-ptcg.cn');
    assert.equal((await api('GET', '/api/auth/salt?userId=x')).status, 400);
    const token = await register('alice');
    assert.equal((await api('POST', '/api/auth/register', { userId: 'alice', proof, salt })).status, 409);
    assert.equal((await api('POST', '/api/records/upload', { userId: 'alice', records: [record('bad:id')] }, token)).status, 400);
    assert.equal((await api('POST', '/api/records/upload', { userId: 'alice', records: [record('account')] }, token)).status, 400);
    assert.equal((await api('POST', '/api/records/upload', { userId: 'alice', records: [record('one')] }, token, 'https://evil.example')).status, 403);
    assert.equal(mock.rows.size, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('profile sync keeps decks, watchlist, atlas and propagates removals', async () => {
  const mock = mockTeable();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  try {
    const token = await register('alice');
    const profile = { version: 1, playerName: 'Alice', playerNameAt: 10,
      currentDeckId: 'deck1', currentDeckAt: 10,
      watchlist: ['rival'], watchlistStamps: { rival: 10 }, watchlistTombstones: {},
      decks: { deck1: { name: '我的卡组', updatedAt: 10 } }, deckTombstones: {},
      deckList: [{ id: 'atlas1', name: '对手卡组', icons: ['pikachu'], updatedAt: 10 },
        { id: 'atlas-copy', name: '对手卡组', icons: [], updatedAt: 5 }],
      deckListTombstones: {} };
    const first = await api('POST', '/api/profile', { profile }, token);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const read = await api('GET', '/api/records', undefined, token);
    assert.deepEqual(read.body.profile.watchlist, ['rival']);
    assert.equal(read.body.profile.decks.deck1.name, '我的卡组');
    assert.equal(read.body.profile.deckList[0].name, '对手卡组');
    assert.equal(read.body.profile.deckList.length, 1);
    assert.equal(read.body.records.length, 0);
    const removal = { ...profile, playerName: '', playerNameAt: 30,
      watchlist: [], watchlistTombstones: { rival: 20 },
      deckList: [], deckListTombstones: { atlas1: 20 } };
    const second = await api('POST', '/api/profile', { profile: removal }, token);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.profile.watchlist, []);
    assert.deepEqual(second.body.profile.deckList, []);
    assert.equal(second.body.profile.playerName, '');
    const stale = await api('POST', '/api/profile', { profile }, token);
    assert.deepEqual(stale.body.profile.watchlist, []);
    assert.deepEqual(stale.body.profile.deckList, []);
    assert.equal(stale.body.profile.playerName, '');
    assert.equal((await api('GET', '/api/records', undefined, token)).body.profile.decks.deck1.name, '我的卡组');
    assert.equal((await api('POST', '/api/profile', { profile }, '', 'https://evil.example')).status, 403);
  } finally { globalThis.fetch = originalFetch; }
});

test('representative local export migrates every match when supplied', async (context) => {
  if (!process.env.PTCG_SAMPLE_FILE) return context.skip('set PTCG_SAMPLE_FILE for local export verification');
  const data = JSON.parse(await readFile(process.env.PTCG_SAMPLE_FILE, 'utf8'));
  const records = data.personal?.matchHistory || [];
  const mock = mockTeable();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  try {
    const token = await register('migration-check');
    let accepted = 0;
    for (let offset = 0; offset < records.length; offset += 10) {
      const result = await api('POST', '/api/records/upload', {
        userId: 'migration-check', playerName: data.personal.playerName,
        records: records.slice(offset, offset + 10),
      }, token);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      accepted += result.body.created + result.body.updated + result.body.skipped;
    }
    const restored = await api('GET', '/api/records', undefined, token);
    assert.equal(accepted, records.length);
    assert.equal(restored.body.records.length, records.length);
    assert.equal(mock.rows.size, records.length + 1);
    assert.equal(new Set(restored.body.records.map((entry) => entry.id)).size, records.length);
    for (const original of records) {
      const copied = restored.body.records.find((entry) => entry.id === original.id);
      assert.ok(copied, `missing ${original.id}`);
      assert.equal(copied.deltaWins, original.deltaWins ?? 0);
      assert.equal(copied.deltaLosses, original.deltaLosses ?? 0);
    }
  } finally { globalThis.fetch = originalFetch; }
});
