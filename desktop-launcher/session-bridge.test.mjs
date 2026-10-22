import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./bridge.js', import.meta.url), 'utf8');
function launch(initialSession = null) {
  const messages = [];
  const observers = [];
  const values = new Map();
  if (initialSession !== null) values.set('ptcg-cloud-session', initialSession);
  const cloudStatus = { after(element) { this.hint = element; } };
  let loaded;
  let nativeMessage;
  const element = () => ({ style: {}, addEventListener() {} });
  const document = {
    documentElement: { dataset: { theme: 'light' } },
    head: { append() {} }, body: { append() {} },
    createElement: element,
    getElementById: id => id === 'cloudStatus' ? cloudStatus : null,
    addEventListener(name, fn) { if (name === 'DOMContentLoaded') loaded = fn; },
  };
  const chrome = { webview: {
    postMessage(value) { messages.push(JSON.parse(JSON.stringify(value))); },
    addEventListener(name, fn) { if (name === 'message') nativeMessage = fn; },
  } };
  const window = { chrome }; window.top = window;
  const context = { window, chrome, document, location: { pathname: '/' }, localStorage: { getItem: () => null },
    sessionStorage: { getItem: key => values.get(key) ?? null },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe(target) { observers.push({ target, fn: this.fn }); } },
  };
  vm.runInNewContext(source, context);
  loaded();
  return { messages, cloudStatus, values,
    changed() { observers.find(o => o.target === cloudStatus).fn(); },
    nativeMessage(data) { nativeMessage({ data }); },
    sessions() { return messages.filter(m => m.command === 'session'); },
  };
}

test('captures an already restored session when the online page initializes', () => {
  const app = launch(JSON.stringify({ userId: 'test-user', token: 'test-token' }));
  assert.deepEqual(app.sessions(), [{ command: 'session', session: { userId: 'test-user', token: 'test-token' } }]);
});
test('login notifies the native cache and never forwards a password field', () => {
  const app = launch();
  app.values.set('ptcg-cloud-session', JSON.stringify({ userId: 'test-user', token: 'test-token', password: 'do-not-save' }));
  app.changed();
  assert.deepEqual(app.sessions().at(-1).session, { userId: 'test-user', token: 'test-token' });
});
test('logout or a 401 session removal clears the native cache', () => {
  const app = launch(JSON.stringify({ userId: 'test-user', token: 'test-token' }));
  app.values.delete('ptcg-cloud-session'); app.changed();
  assert.equal(app.sessions().at(-1).session, null);
});
test('ordinary sync status changes do not repeatedly save the same token', () => {
  const app = launch(JSON.stringify({ userId: 'test-user', token: 'test-token' }));
  app.changed(); app.changed();
  assert.equal(app.sessions().length, 1);
});
test('malformed browser session cannot be persisted', () => {
  const app = launch('{broken-json');
  assert.equal(app.sessions()[0].session, null);
});
test('native persistence failure is visible to the user', () => {
  const app = launch();
  app.nativeMessage({ type: 'remember-status', saved: false });
  assert.match(app.cloudStatus.hint.textContent, /未能保存登录状态/);
});
