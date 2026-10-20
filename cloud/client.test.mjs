import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../cloud.js', import.meta.url), 'utf8');

function browser(responses) {
  const ids = ['cloudUserIdInput', 'cloudPasswordInput', 'cloudPasswordConfirmInput', 'cloudStatus',
    'cloudRegisterBtn', 'cloudLoginBtn', 'cloudLogoutBtn', 'cloudUploadBtn', 'cloudRestoreBtn'];
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
  const context = {
    window: { PTCG_CLOUD_API_URL: 'https://bridge.example' },
    document: { getElementById: (id) => elements[id] },
    localStorage, sessionStorage, setTimeout, TextEncoder, crypto, btoa, atob,
    PtcgStore: { read: () => ({ personal: { matchHistory: [] } }) },
    fetch: async (url) => {
      calls.push(url);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return { ok: next.status < 400, status: next.status, json: async () => next.body };
    },
  };
  vm.runInNewContext(source, context);
  elements.cloudUserIdInput.value = 'ALICE';
  return { elements, calls, localStorage, sessionStorage, clickRegister: () => elements.cloudRegisterBtn.listeners.click() };
}

test('registration retries a lost network request without losing the session', async () => {
  const page = browser([
    new TypeError('Failed to fetch'),
    { status: 201, body: { userId: 'alice', token: 'session' } },
  ]);
  await page.clickRegister();
  assert.deepEqual(page.calls.map((url) => new URL(url).pathname), ['/api/auth/register', '/api/auth/register']);
  assert.equal(JSON.parse(page.sessionStorage.getItem('ptcg-cloud-session')).userId, 'alice');
  assert.equal(page.elements.cloudPasswordInput.value, '');
});

test('registration recovers by logging in when first request created the account', async () => {
  const page = browser([
    new TypeError('Failed to fetch'),
    { status: 409, body: { error: '这个用户 ID 已被使用' } },
    { status: 200, body: { userId: 'alice', token: 'recovered' } },
  ]);
  await page.clickRegister();
  assert.deepEqual(page.calls.map((url) => new URL(url).pathname), ['/api/auth/register', '/api/auth/register', '/api/auth/login']);
  assert.equal(JSON.parse(page.sessionStorage.getItem('ptcg-cloud-session')).token, 'recovered');
});

test('persistent network failure gives a useful message and keeps password for retry', async () => {
  const page = browser([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
  await page.clickRegister();
  assert.match(page.elements.cloudStatus.textContent, /无法连接云端服务/);
  assert.equal(page.elements.cloudPasswordInput.value, 'strong-password-123');
  assert.equal(page.sessionStorage.getItem('ptcg-cloud-session'), null);
});
