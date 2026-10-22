/* Runs only inside the native launcher, on the approved online origin. */
(() => {
  'use strict';
  if (window.top !== window || !window.chrome?.webview) return;
  if (!['/', '/index.html'].includes(location.pathname)) return;
  let mode = 'home';
  let surface = 0.90;
  let panel;
  const send = (command, extra = {}) => chrome.webview.postMessage({ command, ...extra });
  function stylePanel() {
    const doc = panel?.contentDocument;
    if (!doc?.body || !panel.contentWindow.applyPopupMode) return;
    let style = doc.getElementById('desktop-surface');
    if (!style) {
      style = doc.createElement('style');
      style.id = 'desktop-surface';
      doc.head.append(style);
    }
    style.textContent = `
      html, body { background: transparent !important; min-width: 0 !important; }
      .glass-panel { background: transparent !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; box-shadow: none !important; border: none !important; }
      :root, [data-theme="light"] { --popup-surface: rgba(255,255,255,${surface}); }
      [data-theme="dark"] { --popup-surface: rgba(23,32,41,${surface}); }
      .p-header { display: none !important; }
      .deck-row { padding-right: 30px; padding-left: 22px; }
      body[data-mode="mini"] .content-layer { min-height: 0; height: 100vh; padding: 6px; gap: 4px; }
      body[data-mode="mini"] .deck-row { padding: 0 24px 2px 18px; }
      body[data-mode="mini"] .quick-record { justify-content: center; gap: 6px; padding: 0; }
      body[data-mode="mini"] .hist-btn-turn { min-width: 26px; }
      body[data-mode="mini"] .qr-btn { min-height: 32px; }
      body[data-mode="mini"] .qr-row + .qr-row { margin-top: 0; }
    `;
    const theme = localStorage.getItem('ptcg-theme') || 'light';
    panel.contentWindow.applyTheme(theme);
    panel.contentWindow.applyPopupMode(mode === 'detail' ? 'detail' : 'mini', false);
    if (!panel.contentWindow.__desktopStatusBound) {
      const child = panel.contentWindow;
      child.__desktopStatusBound = true;
      // The native shell keeps the parent alive; don't reuse the browser popup's
      // five-second timeout between the parent's ten-second heartbeats.
      child.renderStatus = () => {
        child.document.getElementById('stText').textContent = '主页在后台运行';
        child.document.getElementById('stDot').className = 'p-status-dot';
        child.document.getElementById('stTime').textContent = '';
      };
      child.clearTimeout(child.hb);
      child.channel.addEventListener('message', event => {
        if (event.data?.type === 'heartbeat') {
          child.clearTimeout(child.hb);
          child.renderStatus();
        }
      });
      child.renderStatus();
    }
    // Never let a web button resize an unrelated desktop window.
    panel.contentWindow.resizeTo = () => {};
  }
  function setMode(next) {
    if (!['home', 'mini', 'detail'].includes(next)) return;
    mode = next;
    document.documentElement.dataset.desktopMode = mode;
    stylePanel();
  }
  window.PtcgDesktop = Object.freeze({
    setMode,
    setSurface(value) { surface = Math.min(1, Math.max(0.35, Number(value) || 0.90)); stylePanel(); },
    getMode: () => mode,
  });
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
      #ptcg-desktop-panel { display: none; position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; z-index: 2147483647; }
      html[data-desktop-mode="mini"], html[data-desktop-mode="detail"],
      html[data-desktop-mode="mini"] body, html[data-desktop-mode="detail"] body { background: transparent !important; overflow: hidden; min-width: 0; }
      html[data-desktop-mode="mini"] body > :not(#ptcg-desktop-panel),
      html[data-desktop-mode="detail"] body > :not(#ptcg-desktop-panel) { display: none !important; }
      html[data-desktop-mode="mini"] #ptcg-desktop-panel,
      html[data-desktop-mode="detail"] #ptcg-desktop-panel { display: block; }
    `;
    document.head.append(style);
    const notifyTheme = () => send('theme', { theme: document.documentElement.dataset.theme || localStorage.getItem('ptcg-theme') || 'light' });
    new MutationObserver(notifyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    notifyTheme();
    const cloudStatus = document.getElementById('cloudStatus');
    const hint = document.createElement('p');
    hint.style.cssText = 'font-size:12px;color:var(--text-dim);margin-top:6px';
    hint.textContent = '启动器会加密记住有效登录（最长 12 小时），不保存密码；退出登录会清除。';
    cloudStatus?.after(hint);
    let previousSession;
    const rememberSession = () => {
      let session = null;
      try {
        const saved = JSON.parse(sessionStorage.getItem('ptcg-cloud-session') || 'null');
        if (saved?.userId && saved?.token) session = { userId: saved.userId, token: saved.token };
      } catch {}
      const serialized = JSON.stringify(session);
      if (serialized !== previousSession) { previousSession = serialized; send('session', { session }); }
    };
    if (cloudStatus) new MutationObserver(rememberSession).observe(cloudStatus, { childList: true, characterData: true, subtree: true });
    rememberSession();
    chrome.webview.addEventListener('message', event => {
      if (event.data?.type === 'remember-status' && event.data.saved === false) hint.textContent = '本次登录有效，但未能保存登录状态；重开后可能需要重新登录。';
    });
    panel = document.createElement('iframe');
    panel.id = 'ptcg-desktop-panel';
    panel.title = '桌面悬浮记录面板';
    panel.addEventListener('load', stylePanel);
    panel.src = 'popup.html?desktop=1&v=' + Date.now();
    document.body.append(panel);
    document.getElementById('popupBtn')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      send('mode', { mode: 'mini' });
    }, true);
    setMode(mode);
    send('ready');
  }, { once: true });
})();
