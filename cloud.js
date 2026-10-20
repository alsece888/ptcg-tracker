(function () {
  'use strict';
  const BOUND_KEY = 'ptcg-cloud-user-id';
  const SESSION_KEY = 'ptcg-cloud-session';
  const BATCH_SIZE = 10;
  const SYNC_INTERVAL_MS = 30000;
  const SYNC_DEBOUNCE_MS = 1200;
  const PBKDF2_ITERATIONS = 600000;
  const idInput = document.getElementById('cloudUserIdInput');
  const passwordInput = document.getElementById('cloudPasswordInput');
  const confirmInput = document.getElementById('cloudPasswordConfirmInput');
  const status = document.getElementById('cloudStatus');
  const registerBtn = document.getElementById('cloudRegisterBtn');
  const loginBtn = document.getElementById('cloudLoginBtn');
  const logoutBtn = document.getElementById('cloudLogoutBtn');
  const uploadBtn = document.getElementById('cloudUploadBtn');
  const restoreBtn = document.getElementById('cloudRestoreBtn');
  const buttons = [registerBtn, loginBtn, logoutBtn, uploadBtn, restoreBtn];
  const api = (window.PTCG_CLOUD_API_URL || '').replace(/\/$/, '');
  let syncTimer = null;
  let syncPromise = null;
  let syncAgain = false;
  let applyingRemote = false;
  if (buttons.some((item) => !item) || !idInput || !passwordInput || !confirmInput || !status) return;

  idInput.value = localStorage.getItem(BOUND_KEY) || '';

  function setStatus(message, error) {
    status.textContent = message;
    status.classList.toggle('cloud-error', !!error);
  }

  function savedSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function updateAuthUi() {
    const session = savedSession();
    const active = !!session?.token && session.userId === idInput.value.trim().toLowerCase();
    uploadBtn.disabled = !active || !api;
    restoreBtn.disabled = !active || !api;
    logoutBtn.style.display = active ? '' : 'none';
    registerBtn.style.display = active ? 'none' : '';
    loginBtn.style.display = active ? 'none' : '';
    if (active) setStatus(`已登录：${session.userId}。战绩将自动同步。`);
    else if (!api) setStatus('云端服务尚未配置，当前仍只保存在本机。');
    else setStatus('请注册或登录当前用户 ID。');
    updateAuthUiButtonsOnly();
  }

  function userId() {
    const id = idInput.value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(id)) {
      throw new Error('用户 ID 需为 3–32 位小写字母、数字、_ 或 -，且以字母或数字开头');
    }
    const bound = localStorage.getItem(BOUND_KEY);
    const localCount = (PtcgStore.read()?.personal?.matchHistory || []).length;
    if (bound && bound !== id && localCount) {
      throw new Error(`本机记录已关联 ID「${bound}」。请先导出备份并清空本机数据，再切换 ID。`);
    }
    return id;
  }

  function b64(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function unb64(value) {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
  }

  async function passwordProof(password, salt) {
    if (password.length < 10 || password.length > 128) throw new Error('密码需为 10–128 位');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: PBKDF2_ITERATIONS }, key, 256);
    return b64(new Uint8Array(bits));
  }

  async function request(path, options = {}, authenticated = false) {
    if (!api || !/^https:\/\//.test(api)) throw new Error('云端服务尚未配置');
    const headers = { ...(options.headers || {}) };
    if (authenticated) {
      const session = savedSession();
      if (!session?.token || session.userId !== idInput.value.trim().toLowerCase()) throw new Error('请先登录当前用户 ID');
      headers.Authorization = `Bearer ${session.token}`;
    }
    let res;
    try { res = await fetch(api + path, { ...options, headers }); }
    catch {
      const error = new Error('无法连接云端服务，请检查网络或浏览器拦截设置后重试。');
      error.code = 'NETWORK';
      throw error;
    }
    let body;
    try { body = await res.json(); } catch { throw new Error(`服务返回错误（HTTP ${res.status}）`); }
    if (!res.ok) {
      if (res.status === 401 && authenticated) { sessionStorage.removeItem(SESSION_KEY); updateAuthUi(); }
      const error = new Error(body.error || `服务返回错误（HTTP ${res.status}）`);
      error.status = res.status;
      throw error;
    }
    return body;
  }

  async function run(job) {
    buttons.forEach((button) => { button.disabled = true; });
    try { await job(); }
    catch (error) { setStatus(error.message || '操作失败', true); }
    finally { buttons.forEach((button) => { button.disabled = false; }); updateAuthUiButtonsOnly(); }
  }

  function updateAuthUiButtonsOnly() {
    const session = savedSession();
    const active = !!session?.token && session.userId === idInput.value.trim().toLowerCase();
    uploadBtn.disabled = !active || !api;
    restoreBtn.disabled = !active || !api;
    registerBtn.disabled = !api;
    loginBtn.disabled = !api;
  }

  registerBtn.addEventListener('click', () => run(async () => {
    const id = userId();
    const password = passwordInput.value;
    if (password !== confirmInput.value) throw new Error('两次输入的密码不一致');
    setStatus('正在处理密码并注册…');
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const proof = await passwordProof(password, salt);
    const registerOptions = {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: id, salt, proof }),
    };
    let body;
    try { body = await request('/api/auth/register', registerOptions); }
    catch (error) {
      if (error.code !== 'NETWORK') throw error;
      setStatus('连接中断，正在确认账号是否已创建…');
      await new Promise((resolve) => setTimeout(resolve, 800));
      try { body = await request('/api/auth/register', registerOptions); }
      catch (retryError) {
        if (retryError.status !== 409) throw retryError;
        body = await request('/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: id, proof }),
        });
      }
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: body.userId, token: body.token }));
    localStorage.setItem(BOUND_KEY, body.userId);
    passwordInput.value = '';
    confirmInput.value = '';
    updateAuthUi();
    await syncRecords();
  }));

  loginBtn.addEventListener('click', () => run(async () => {
    const id = userId();
    const password = passwordInput.value;
    setStatus('正在验证密码…');
    const { salt } = await request(`/api/auth/salt?userId=${encodeURIComponent(id)}`);
    const proof = await passwordProof(password, salt);
    const body = await request('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: id, proof }),
    });
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: body.userId, token: body.token }));
    localStorage.setItem(BOUND_KEY, body.userId);
    passwordInput.value = '';
    confirmInput.value = '';
    updateAuthUi();
    await syncRecords();
  }));

  logoutBtn.addEventListener('click', () => {
    clearTimeout(syncTimer);
    sessionStorage.removeItem(SESSION_KEY);
    updateAuthUi();
    setStatus('已退出登录。本机记录仍保留。');
  });
  idInput.addEventListener('input', updateAuthUi);

  function activeSession() {
    const session = savedSession();
    return !!api && !!session?.token && session.userId === idInput.value.trim().toLowerCase();
  }

  function queueSync(delay = SYNC_DEBOUNCE_MS) {
    if (!activeSession() || applyingRemote) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncRecords().catch((error) => setStatus(error.message || '同步失败', true)); }, delay);
  }

  async function syncRecords({ pullOnly = false } = {}) {
    if (!activeSession()) return;
    if (syncPromise) { syncAgain = true; return syncPromise; }
    syncPromise = (async () => {
    const id = userId();
    setStatus('正在同步云端战绩…');
    const body = await request('/api/records', {}, true);
    if (body.userId !== id || !Array.isArray(body.records) || !Array.isArray(body.deleted)) throw new Error('云端数据格式有误');
    const before = PtcgStore.read();
    applyingRemote = true;
    let merged;
    try {
      merged = PtcgStore.mergeCloud(body.records, body.deleted, body.playerName);
      if (JSON.stringify(before?.personal || {}) !== JSON.stringify(merged.personal)) {
        loadData();
        renderPersonalSection();
        if (typeof notifyPopupDataUpdated === 'function') notifyPopupDataUpdated();
      }
    } finally {
      applyingRemote = false;
    }
    let sentRecords = 0, sentDeleted = 0;
    if (!pullOnly) {
      const local = PtcgStore.read();
      const personal = local.personal;
      const cloudById = new Map(body.records.map((entry) => [entry.id, entry]));
      const cloudDeleted = new Set(body.deleted.map((item) => item.id));
      const tombstones = personal.historyTombstones || {};
      const pendingRecords = (personal.matchHistory || []).filter((entry) =>
        entry?.id && !tombstones[entry.id] && !cloudDeleted.has(entry.id) &&
        (!cloudById.has(entry.id) || Number(entry.updatedAt || 0) > Number(cloudById.get(entry.id).updatedAt || 0)));
      const pendingDeleted = Object.entries(tombstones)
        .filter(([entryId, stamp]) => entryId && Number(stamp) > 0 && !cloudDeleted.has(entryId))
        .map(([entryId, stamp]) => ({ id: entryId, deletedAt: Number(stamp) }));
      const pending = [
        ...pendingRecords.map((entry) => ({ record: entry })),
        ...pendingDeleted.map((item) => ({ deleted: item })),
      ];
      for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
        const batch = pending.slice(offset, offset + BATCH_SIZE);
        await request('/api/records/upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: id, playerName: personal.playerName || '',
            records: batch.filter((item) => item.record).map((item) => item.record),
            deleted: batch.filter((item) => item.deleted).map((item) => item.deleted) }),
        }, true);
        sentRecords += batch.filter((item) => item.record).length;
        sentDeleted += batch.filter((item) => item.deleted).length;
      }
    }
    const at = new Date();
    setStatus(`已登录：${id}。已自动同步至 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}；本次读取 ${body.records.length} 条${sentRecords || sentDeleted ? `，发送 ${sentRecords} 条记录、${sentDeleted} 条删除标记` : ''}。`);
    })();
    try { return await syncPromise; }
    finally {
      syncPromise = null;
      if (syncAgain) { syncAgain = false; queueSync(); }
    }
  }

  uploadBtn.addEventListener('click', () => run(() => syncRecords()));
  restoreBtn.addEventListener('click', () => run(() => syncRecords({ pullOnly: true })));

  window.addEventListener('ptcg-history-changed', () => queueSync());
  window.addEventListener('storage', (event) => {
    if (event.key === PtcgStore.KEY) queueSync();
  });
  window.addEventListener('focus', () => queueSync(0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) queueSync(0); });
  setInterval(() => { if (!document.hidden) queueSync(0); }, SYNC_INTERVAL_MS);

  updateAuthUi();
  if (activeSession()) queueSync(0);
})();
