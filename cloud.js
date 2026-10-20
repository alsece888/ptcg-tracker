(function () {
  'use strict';
  const BOUND_KEY = 'ptcg-cloud-user-id';
  const SESSION_KEY = 'ptcg-cloud-session';
  const BATCH_SIZE = 10;
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
    if (active) setStatus(`已登录：${session.userId}。可上传本机记录或读取云端记录。`);
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
    const res = await fetch(api + path, { ...options, headers });
    let body;
    try { body = await res.json(); } catch { throw new Error(`服务返回错误（HTTP ${res.status}）`); }
    if (!res.ok) {
      if (res.status === 401 && authenticated) { sessionStorage.removeItem(SESSION_KEY); updateAuthUi(); }
      throw new Error(body.error || `服务返回错误（HTTP ${res.status}）`);
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
    const body = await request('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: id, salt, proof }),
    });
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: body.userId, token: body.token }));
    localStorage.setItem(BOUND_KEY, body.userId);
    passwordInput.value = '';
    confirmInput.value = '';
    updateAuthUi();
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
  }));

  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    updateAuthUi();
    setStatus('已退出登录。本机记录仍保留。');
  });
  idInput.addEventListener('input', updateAuthUi);

  uploadBtn.addEventListener('click', () => run(async () => {
    const id = userId();
    const data = PtcgStore.read();
    const records = data?.personal?.matchHistory || [];
    if (!records.length) throw new Error('这台浏览器还没有对局记录');
    let created = 0, updated = 0, skipped = 0;
    for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
      setStatus(`上传中：${offset}/${records.length} 条…`);
      const body = await request('/api/records/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id, playerName: data.personal.playerName || '', records: records.slice(offset, offset + BATCH_SIZE) }),
      }, true);
      created += body.created;
      updated += body.updated;
      skipped += body.skipped;
    }
    setStatus(`上传完成：新增 ${created}、更新 ${updated}、已存在 ${skipped}，共 ${records.length} 条。`);
  }));

  restoreBtn.addEventListener('click', () => run(async () => {
    const id = userId();
    const local = PtcgStore.read();
    if (!localStorage.getItem(BOUND_KEY) && (local?.personal?.matchHistory || []).length) {
      if (!confirm('本机已有对局记录。读取云端后会按记录 ID 合并，不会清空本机记录。确认继续吗？')) return;
    }
    setStatus('正在读取云端记录…');
    const body = await request('/api/records', {}, true);
    if (body.userId !== id || !Array.isArray(body.records)) throw new Error('云端数据格式有误');
    let added = 0, refreshed = 0;
    PtcgStore.mutate((draft) => {
      const p = draft.personal;
      if (!p.playerName && body.playerName) p.playerName = body.playerName;
      const byId = new Map((p.matchHistory || []).map((entry) => [entry.id, entry]));
      for (const entry of body.records) {
        if (!entry || !entry.id) continue;
        if (p.historyTombstones?.[entry.id]) continue;
        const existing = byId.get(entry.id);
        if (existing && Number(existing.updatedAt || 0) >= Number(entry.updatedAt || 0)) continue;
        if (existing) { Object.assign(existing, entry); refreshed++; }
        else { p.matchHistory.push(entry); byId.set(entry.id, entry); added++; }
        if (entry.deckId && !p.decks[entry.deckId]) {
          p.decks[entry.deckId] = { name: entry.deckName || '未命名卡组', accumulatedWins: 0, accumulatedLosses: 0 };
        }
      }
      if (!p.currentDeckId && Object.keys(p.decks).length) p.currentDeckId = Object.keys(p.decks)[0];
      return draft;
    });
    loadData();
    renderPersonalSection();
    if (typeof notifyPopupDataUpdated === 'function') notifyPopupDataUpdated();
    setStatus(`云端读取 ${body.records.length} 条；本机新增 ${added}、更新 ${refreshed} 条。`);
  }));

  updateAuthUi();
})();
