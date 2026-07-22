// ============================================================
// PTCG 玩家追踪器 - 纯前端版
// 数据保存在 localStorage，API 通过 CORS 代理调用
// ============================================================

const PTCG_BASE = 'https://ptcg.mivm.cn';
// CORS 代理列表（按优先级尝试）
const CORS_PROXIES = [
  (url) => `https://proxy.cors.sh/${url}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

const STORAGE_KEY = 'ptcg-tracker-data';
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 分钟

// 宝可梦类型图标
const POKEMON_TYPES = [
  { emoji: '🔥', name: '火' }, { emoji: '💧', name: '水' }, { emoji: '🌿', name: '草' },
  { emoji: '⚡', name: '电' }, { emoji: '❄️', name: '冰' }, { emoji: '🥊', name: '格斗' },
  { emoji: '☠️', name: '毒' }, { emoji: '🌍', name: '地面' }, { emoji: '🕊️', name: '飞行' },
  { emoji: '🔮', name: '超能力' }, { emoji: '🐛', name: '虫' }, { emoji: '🪨', name: '岩石' },
  { emoji: '👻', name: '幽灵' }, { emoji: '🐉', name: '龙' }, { emoji: '🌑', name: '恶' },
  { emoji: '⚙️', name: '钢' }, { emoji: '✨', name: '妖精' }, { emoji: '⚪', name: '一般' },
];

// --- 工具函数 ---
function uuid() {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16));
}

// --- 状态 ---
let state = {
  watchlist: [], lastUpdate: null, players: {}, notes: {},
  personal: { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] }
};
let currentSort = 'exp';
let editingNote = null;
let editingHistoryId = null;
let selectedDeckListIcons = [];
let editingDeckListId = null;
let searchTerm = '';
let autoRefreshTimer = null;
let workingProxyIdx = 0; // 当前可用的代理索引

// --- DOM 元素 ---
const $ = (id) => document.getElementById(id);
const refreshBtn = $('refreshBtn');
const addBtn = $('addBtn');
const playerInput = $('playerInput');
const addResult = $('addResult');
const playerTableBody = $('playerTableBody');
const tableContainer = $('tableContainer');
const emptyState = $('emptyState');
const statsSection = $('statsSection');
const loadingOverlay = $('loadingOverlay');
const loadingText = $('loadingText');
const toast = $('toast');
const sortBy = $('sortBy');
const searchInput = $('searchInput');
const menuBtn = $('menuBtn');
const menuDropdown = $('menuDropdown');

// ============================================================
// 数据持久化 (localStorage)
// ============================================================

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state = {
        watchlist: data.watchlist || [],
        lastUpdate: data.lastUpdate || null,
        players: data.players || {},
        notes: data.notes || {},
        personal: data.personal || { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] },
      };
      // 初始化 deckList
      if (!state.personal.deckList) state.personal.deckList = [];
      // 迁移旧版卡组数据（wins/losses → accumulatedWins/accumulatedLosses + snapshot）
      if (state.personal && state.personal.decks) {
        let migrated = false;
        Object.values(state.personal.decks).forEach(d => {
          if (d.wins !== undefined && d.accumulatedWins === undefined) {
            d.accumulatedWins = d.wins;
            d.accumulatedLosses = d.losses || 0;
            d.snapshotWins = d.snapshotWins ?? 0;
            d.snapshotLosses = d.snapshotLosses ?? 0;
            delete d.wins;
            delete d.losses;
            migrated = true;
          }
        });
        // 迁移旧版历史记录格式
        if (state.personal.matchHistory) {
          state.personal.matchHistory = state.personal.matchHistory.filter(h => {
            if (h.result !== undefined && h.deltaWins === undefined) {
              // 旧版手动记录无法迁移为差分格式，丢弃
              return false;
            }
            return true;
          });
        }
        if (migrated) saveData();
      }
    }
  } catch (e) {
    console.error('加载数据失败:', e);
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      watchlist: state.watchlist,
      lastUpdate: state.lastUpdate,
      players: state.players,
      notes: state.notes,
      personal: state.personal,
    }));
  } catch (e) {
    console.error('保存数据失败:', e);
    showToast('数据保存失败，可能存储空间不足', 'error');
  }
}

// ============================================================
// PTCG API 调用 (通过 CORS 代理)
// ============================================================

async function fetchViaProxy(targetUrl) {
  // 尝试从上次成功的代理开始
  const tried = new Set();
  for (let attempt = 0; attempt < CORS_PROXIES.length; attempt++) {
    const idx = (workingProxyIdx + attempt) % CORS_PROXIES.length;
    if (tried.has(idx)) continue;
    tried.add(idx);
    const proxyUrl = CORS_PROXIES[idx](targetUrl);
    try {
      const resp = await fetch(proxyUrl, {
        headers: { 'Accept': 'application/json' },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      workingProxyIdx = idx; // 记住可用的代理
      return data;
    } catch (e) {
      // 继续尝试下一个代理
      continue;
    }
  }
  throw new Error('所有代理均不可用，请稍后重试');
}

async function fetchPlayer(screenName) {
  const url = `${PTCG_BASE}/api/rank/player/query?screen_name=${encodeURIComponent(screenName)}`;
  try {
    const data = await fetchViaProxy(url);
    return data;
  } catch (e) {
    // 检查是否 404（玩家不存在）
    return { notFound: true, name: screenName };
  }
}

async function fetchTops() {
  const url = `${PTCG_BASE}/api/rank/player/tops`;
  return await fetchViaProxy(url);
}

// 并发查询（限制并发数）
async function fetchAllPlayers(names, concurrency = 5, onProgress) {
  const results = [];
  for (let i = 0; i < names.length; i += concurrency) {
    const batch = names.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async name => {
        const data = await fetchPlayer(name);
        return { name, data };
      })
    );
    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({ name: batch[j], error: r.reason?.message || '查询失败' });
      }
    }
    if (onProgress) onProgress(results.length, names.length);
  }
  return results;
}

// ============================================================
// 核心操作
// ============================================================

async function refreshData() {
  if (state.watchlist.length === 0) {
    showToast('请先添加关注的玩家');
    return;
  }

  refreshBtn.disabled = true;
  showLoading(`正在更新 ${state.watchlist.length} 个玩家数据...`);

  try {
    // 同时获取排行榜和玩家详情
    let tops = [];
    try {
      tops = await fetchTops();
    } catch (e) {
      console.warn('获取排行榜失败:', e);
    }

    const playerResults = await fetchAllPlayers(state.watchlist, 5, (done, total) => {
      loadingText.textContent = `正在更新 ${done}/${total} 个玩家数据...`;
    });

    // 构建排名映射
    const rankMap = {};
    tops.forEach((p, i) => { rankMap[p.name] = i + 1; });

    // 更新玩家数据
    const players = {};
    for (const result of playerResults) {
      if (result.data && !result.data.notFound && !result.data.error) {
        const d = result.data;
        const total = d.win_total_count + d.lose_total_count;
        const winRate = total > 0 ? (d.win_total_count / total * 100) : 0;
        players[result.name] = {
          name: d.name,
          exp: d.exp,
          highestExp: d.highest_exp,
          winTotal: d.win_total_count,
          loseTotal: d.lose_total_count,
          winRate: parseFloat(winRate.toFixed(2)),
          winTemp: d.win_temp_count,
          winMax: d.win_max_count,
          loseTemp: d.lose_temp_count,
          loseMax: d.lose_max_count,
          rank: rankMap[d.name] || null,
          totalGames: total,
          updatedAt: d.updated_at,
        };
      } else if (result.data && result.data.notFound) {
        players[result.name] = { name: result.name, notFound: true };
      } else {
        players[result.name] = { name: result.name, error: result.error || '查询失败' };
      }
    }

    state.players = players;
    state.lastUpdate = new Date().toISOString();
    saveData();
    render();

    const valid = Object.values(players).filter(p => p.exp !== undefined);
    const notFound = Object.values(players).filter(p => p.notFound);
    const errors = Object.values(players).filter(p => p.error);

    let msg = `更新完成: ${valid.length} 个成功`;
    if (notFound.length > 0) msg += `, ${notFound.length} 个未找到`;
    if (errors.length > 0) msg += `, ${errors.length} 个失败`;
    showToast(msg, 'success');
  } catch (e) {
    showToast('更新失败: ' + e.message, 'error');
  } finally {
    hideLoading();
    refreshBtn.disabled = false;
  }
}

function addPlayers() {
  const text = playerInput.value.trim();
  if (!text) {
    addResult.textContent = '请输入至少一个玩家昵称';
    addResult.className = 'add-result error';
    return;
  }

  const names = text.split(/[,，\n\s]+/).map(s => s.trim()).filter(Boolean);
  if (names.length === 0) {
    addResult.textContent = '请输入有效的昵称';
    addResult.className = 'add-result error';
    return;
  }

  const added = [];
  for (const name of names) {
    if (name && !state.watchlist.some(n => n.toLowerCase() === name.toLowerCase())) {
      state.watchlist.push(name);
      added.push(name);
    }
  }
  saveData();

  if (added.length > 0) {
    addResult.textContent = `成功添加 ${added.length} 个玩家${added.length < names.length ? `（${names.length - added.length} 个已存在）` : ''}`;
    addResult.className = 'add-result success';
    playerInput.value = '';
  } else {
    addResult.textContent = '所有玩家已在关注列表中';
    addResult.className = 'add-result error';
  }
  render();
}

function removePlayer(name) {
  if (!confirm(`确定删除玩家 "${name}" 吗？`)) return;
  state.watchlist = state.watchlist.filter(n => n.toLowerCase() !== name.toLowerCase());
  delete state.players[name];
  delete state.notes[name];
  saveData();
  render();
  showToast('已删除 ' + name);
}

function saveNote(name) {
  const input = document.getElementById('noteInput');
  if (!input) { editingNote = null; return; }
  const note = input.value.trim();
  const oldNote = state.notes[name] || '';
  if (note === oldNote) {
    editingNote = null;
    render();
    return;
  }
  const trimmedNote = note.slice(0, 100);
  if (trimmedNote) {
    state.notes[name] = trimmedNote;
  } else {
    delete state.notes[name];
  }
  saveData();
  editingNote = null;
  render();
  showToast('备注已保存', 'success');
}

// ============================================================
// 导入/导出
// ============================================================

function exportData() {
  const data = {
    watchlist: state.watchlist,
    lastUpdate: state.lastUpdate,
    players: state.players,
    notes: state.notes,
    personal: state.personal,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ptcg-tracker-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('数据已导出', 'success');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.watchlist)) throw new Error('文件格式不正确');
      state.watchlist = data.watchlist || [];
      state.lastUpdate = data.lastUpdate || null;
      state.players = data.players || {};
      state.notes = data.notes || {};
      state.personal = data.personal || { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] };
      saveData();
      render();
      renderPersonalSection();
      showToast('数据导入成功', 'success');
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function clearAllData() {
  if (!confirm('确定清空所有数据吗？此操作不可恢复！')) return;
  if (!confirm('再次确认：将删除所有关注玩家、战绩和备注。')) return;
  state = { watchlist: [], lastUpdate: null, players: {}, notes: {},
    personal: { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] } };
  saveData();
  render();
  renderPersonalSection();
  showToast('所有数据已清空');
}

// ============================================================
// 自动刷新
// ============================================================

function toggleAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    $('autoRefreshStatus').textContent = '关';
    $('autoRefreshStatus').classList.remove('active');
    showToast('已关闭自动刷新');
  } else {
    autoRefreshTimer = setInterval(() => {
      if (state.watchlist.length > 0) refreshData();
    }, AUTO_REFRESH_INTERVAL);
    $('autoRefreshStatus').textContent = '开';
    $('autoRefreshStatus').classList.add('active');
    showToast(`已开启自动刷新（每 ${AUTO_REFRESH_INTERVAL / 60000} 分钟）`, 'success');
  }
}

// ============================================================
// 个人战绩板块
// ============================================================

function renderPersonalSection() {
  const p = state.personal || { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] };
  const hasPlayer = !!p.playerName;
  const decks = p.decks || {};
  const deckIds = Object.keys(decks);
  const curDeck = decks[p.currentDeckId];

  // 设置昵称区域
  $('personalSetupMsg').textContent = '';
  if (!hasPlayer) {
    $('personalApiOverview').style.display = 'none';
    $('personalDeckPanel').style.display = 'none';
    $('personalHistory').style.display = 'none';
    $('personalPlayerInput').value = '';
    return;
  }

  $('personalPlayerInput').value = p.playerName;
  $('personalDeckPanel').style.display = 'flex';
  $('personalHistory').style.display = 'block';

  // 渲染卡组选择器
  renderDeckSelector();

  // 渲染当前卡组战绩
  renderDeckStats();

  // 渲染对局历史
  renderHistory();

  // 渲染对阵分析
  renderMatchupAnalysis();

  // 渲染卡组列表管理
  renderDeckListManage();

  // 初始化图标选择器
  $('deckListIconPicker').innerHTML = renderDeckListIcons([]);
  $('deckListSelectedIcons').textContent = '未选择图标';

  // 刷新 API 数据
  refreshApiOverview();
}

async function refreshApiOverview() {
  const p = state.personal || {};
  if (!p.playerName) return;
  $('personalApiOverview').style.display = 'flex';
  const defaults = () => {
    $('apiRank').textContent = '--'; $('apiExp').textContent = '--';
    $('apiTotalWin').textContent = '--'; $('apiTotalLose').textContent = '--';
    $('apiWinRate').textContent = '--'; $('apiTotalGames').textContent = '--';
  };
  defaults();
  try {
    const [data, tops] = await Promise.all([
      fetchPlayer(p.playerName),
      fetchTops().catch(() => []),
    ]);
    if (data && !data.notFound && !data.error) {
      // 排行榜排名
      let rank = null;
      if (Array.isArray(tops)) {
        tops.forEach((tp, i) => { if (tp.name === data.name) rank = i + 1; });
      }
      $('apiRank').textContent = rank || '-';
      $('apiExp').textContent = data.exp || '-';
      $('apiTotalWin').textContent = data.win_total_count || '0';
      $('apiTotalLose').textContent = data.lose_total_count || '0';
      const t = (data.win_total_count || 0) + (data.lose_total_count || 0);
      $('apiTotalGames').textContent = t;
      $('apiWinRate').textContent = t > 0 ? ((data.win_total_count / t) * 100).toFixed(1) + '%' : '--';

      // --- 差分追踪：计算本次 API 与上次的差额，分配给当前卡组 ---
      const apiWins = data.win_total_count || 0;
      const apiLosses = data.lose_total_count || 0;

      if (p.lastApiWins !== undefined) {
        const deltaWins = apiWins - p.lastApiWins;
        const deltaLosses = apiLosses - p.lastApiLosses;

        // 只在差额非负且有变化时记录
        if (deltaWins >= 0 && deltaLosses >= 0 && (deltaWins > 0 || deltaLosses > 0)) {
          const curDeck = p.decks && p.decks[p.currentDeckId];
          if (curDeck) {
            curDeck.accumulatedWins = (curDeck.accumulatedWins || 0) + deltaWins;
            curDeck.accumulatedLosses = (curDeck.accumulatedLosses || 0) + deltaLosses;
            curDeck.snapshotWins = apiWins;
            curDeck.snapshotLosses = apiLosses;

            if (!p.matchHistory) p.matchHistory = [];
            p.matchHistory.push({
              id: uuid(),
              deckId: p.currentDeckId,
              deckName: curDeck.name,
              deltaWins,
              deltaLosses,
              cumulativeWins: curDeck.accumulatedWins,
              cumulativeLosses: curDeck.accumulatedLosses,
              time: new Date().toISOString(),
            });
          }
        } else if (deltaWins < 0 || deltaLosses < 0) {
          // 数据回退（如跨赛季），只更新快照不累加
          console.warn('API 数据回退，跳过差额记录');
        }
      }

      // 更新最后 API 值
      p.lastApiWins = apiWins;
      p.lastApiLosses = apiLosses;
      saveData();
      renderDeckStats();
      renderDeckSelector();
      renderHistory();
      renderMatchupAnalysis();
      showToast('战绩已获取，已自动分配差额', 'success');
    }
  } catch (e) {
    console.warn('获取个人 API 数据失败:', e);
    showToast('获取数据失败: ' + e.message, 'error');
  }
}

function setPersonalPlayer() {
  const input = $('personalPlayerInput');
  const name = input.value.trim();
  if (!name) {
    $('personalSetupMsg').textContent = '请输入游戏昵称';
    $('personalSetupMsg').className = 'add-result error';
    return;
  }
  state.personal.playerName = name;
  if (!state.personal.decks) state.personal.decks = {};
  if (!state.personal.matchHistory) state.personal.matchHistory = [];
  saveData();
  renderPersonalSection();
  showToast('已设置个人玩家: ' + name, 'success');
}

function createDeck() {
  const input = $('newDeckInput');
  const name = input.value.trim();
  if (!name) { showToast('请输入卡组名称', 'error'); return; }
  if (!state.personal.decks) state.personal.decks = {};

  // 检查重名
  if (Object.values(state.personal.decks).some(d => d.name === name)) {
    showToast('卡组名称已存在', 'error');
    return;
  }

  const id = uuid();
  const p = state.personal;
  state.personal.decks[id] = {
    name,
    accumulatedWins: 0, accumulatedLosses: 0,
    snapshotWins: p.lastApiWins ?? 0,
    snapshotLosses: p.lastApiLosses ?? 0,
  };
  if (!state.personal.currentDeckId || !state.personal.decks[state.personal.currentDeckId]) {
    state.personal.currentDeckId = id;
  }
  saveData();
  input.value = '';
  renderDeckList();
  renderDeckSelector();
  renderDeckStats();
  showToast('卡组 "' + name + '" 已创建', 'success');
}

function selectDeck() {
  const val = $('deckSelector').value;
  if (!val || val === state.personal.currentDeckId) return;

  const p = state.personal;

  // 结算旧卡组：将最后一次 API 到当前的差额计入旧卡组
  settleCurrentDeck();

  // 切换并给新卡组拍快照
  p.currentDeckId = val;
  const newDeck = p.decks[val];
  if (newDeck) {
    newDeck.snapshotWins = p.lastApiWins ?? 0;
    newDeck.snapshotLosses = p.lastApiLosses ?? 0;
  }

  saveData();
  renderDeckSelector();
  renderDeckStats();
  renderHistory();
  renderMatchupAnalysis();
  showToast('已切换到卡组: ' + (newDeck ? newDeck.name : ''), 'success');
}

// 结算当前卡组：将 lastApi - snapshot 的差额累加到 accumulated
function settleCurrentDeck() {
  const p = state.personal;
  if (!p.currentDeckId) return;
  const deck = p.decks[p.currentDeckId];
  if (!deck) return;
  if (p.lastApiWins === undefined && p.lastApiLosses === undefined) return;

  const apiW = p.lastApiWins || 0;
  const apiL = p.lastApiLosses || 0;
  const snapW = deck.snapshotWins || 0;
  const snapL = deck.snapshotLosses || 0;

  const deltaW = apiW - snapW;
  const deltaL = apiL - snapL;

  if (deltaW > 0 || deltaL > 0) {
    deck.accumulatedWins = (deck.accumulatedWins || 0) + Math.max(0, deltaW);
    deck.accumulatedLosses = (deck.accumulatedLosses || 0) + Math.max(0, deltaL);
  }
}

function renameDeck(id) {
  const input = document.getElementById('deckEditInput_' + id);
  if (!input) return;
  const newName = input.value.trim();
  if (!newName) { showToast('名称不能为空', 'error'); return; }
  if (!state.personal.decks[id]) return;

  const oldName = state.personal.decks[id].name;
  if (newName === oldName) { renderDeckList(); return; }

  // 检查重名
  if (Object.values(state.personal.decks).some((d, i) => i !== id && d.name === newName)) {
    showToast('卡组名称已存在', 'error');
    return;
  }

  state.personal.decks[id].name = newName;
  // 更新历史记录中的卡组名
  (state.personal.matchHistory || []).forEach(m => {
    if (m.deckId === id) m.deckName = newName;
  });
  saveData();
  renderDeckList();
  renderDeckSelector();
  renderDeckStats();
  renderHistory();
  showToast('卡组已重命名', 'success');
}

function deleteDeck(id) {
  const deck = state.personal.decks[id];
  if (!deck) return;
  if (!confirm(`确定删除卡组 "${deck.name}" 吗？\n该卡组的战绩和对应历史记录将被一并删除。`)) return;
  delete state.personal.decks[id];
  state.personal.matchHistory = (state.personal.matchHistory || []).filter(m => m.deckId !== id);
  if (state.personal.currentDeckId === id) {
    const remaining = Object.keys(state.personal.decks);
    state.personal.currentDeckId = remaining.length > 0 ? remaining[0] : null;
  }
  saveData();
  renderDeckList();
  renderDeckSelector();
  renderDeckStats();
  renderHistory();
  renderMatchupAnalysis();
  showToast('卡组已删除', 'success');
}

function clearHistory() {
  if (!confirm('确定清空所有对局历史吗？所有卡组战绩将归零。')) return;
  const p = state.personal;
  p.matchHistory = [];
  p.lastApiWins = undefined;
  p.lastApiLosses = undefined;
  Object.values(p.decks || {}).forEach(d => {
    d.accumulatedWins = 0;
    d.accumulatedLosses = 0;
    d.snapshotWins = 0;
    d.snapshotLosses = 0;
  });
  saveData();
  renderDeckStats();
  renderDeckSelector();
  renderDeckList();
  renderHistory();
  renderMatchupAnalysis();
  showToast('对局历史已清空');
}

// --- 个人板块局部渲染 ---

function renderDeckSelector() {
  const p = state.personal;
  const decks = p.decks || {};
  const sel = $('deckSelector');
  const ids = Object.keys(decks);
  if (ids.length === 0) {
    sel.innerHTML = '<option value="">-- 请先创建卡组 --</option>';
  } else {
    sel.innerHTML = ids.map(id => {
      const d = decks[id];
      const accW = d.accumulatedWins || 0;
      const accL = d.accumulatedLosses || 0;
      const total = accW + accL;
      return `<option value="${id}" ${id === p.currentDeckId ? 'selected' : ''}>${esc(d.name)} (${total}场)</option>`;
    }).join('');
  }
  sel.value = p.currentDeckId || '';
}

function renderDeckStats() {
  const p = state.personal;
  const cur = p.decks && p.decks[p.currentDeckId] ? p.decks[p.currentDeckId] : null;
  if (!cur) {
    $('deckWins').textContent = '0';
    $('deckLosses').textContent = '0';
    $('deckTotal').textContent = '0';
    $('deckWinRate').textContent = '--';
    return;
  }
  // 当前实时战绩 = 累计 + (最近一次API - 快照)
  const accW = cur.accumulatedWins || 0;
  const accL = cur.accumulatedLosses || 0;
  const apiW = p.lastApiWins ?? (cur.snapshotWins ?? 0);
  const apiL = p.lastApiLosses ?? (cur.snapshotLosses ?? 0);
  const snapW = cur.snapshotWins || 0;
  const snapL = cur.snapshotLosses || 0;

  const currentW = accW + Math.max(0, apiW - snapW);
  const currentL = accL + Math.max(0, apiL - snapL);

  $('deckWins').textContent = currentW;
  $('deckLosses').textContent = currentL;
  $('deckTotal').textContent = currentW + currentL;
  $('deckWinRate').textContent = (currentW + currentL) > 0 ? (currentW / (currentW + currentL) * 100).toFixed(1) + '%' : '--';
}

function renderDeckList() {
  const p = state.personal;
  const decks = p.decks || {};
  const ids = Object.keys(decks);
  const container = $('deckList');
  if (ids.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">暂无卡组，在上方创建</div>';
    return;
  }
  container.innerHTML = ids.map(id => {
    const d = decks[id];
    const accW = d.accumulatedWins || 0;
    const accL = d.accumulatedLosses || 0;
    const total = accW + accL;
    const wr = total > 0 ? (accW / total * 100).toFixed(1) : '--';
    const isActive = id === p.currentDeckId;
    return `<div class="deck-item ${isActive ? 'active' : ''}">
      <div class="deck-item-info">
        <span class="deck-item-name">${esc(d.name)}</span>
        <span class="deck-item-meta">${accW}胜 ${accL}败 · ${total}场 · 胜率${wr}%</span>
        ${isActive ? '<span style="font-size:11px;color:var(--accent);">● 当前</span>' : ''}
      </div>
      <div class="deck-item-actions">
        <button class="btn-deck-action" onclick="startRenameDeck('${id}')" title="重命名">✏</button>
        <button class="btn-deck-action danger" onclick="deleteDeck('${id}')" title="删除">🗑</button>
      </div>
    </div>`;
  });
}

function startRenameDeck(id) {
  const d = state.personal.decks[id];
  if (!d) return;
  const container = $('deckList');
  // 找到对应的 deck-item 并替换为输入框
  const items = container.querySelectorAll('.deck-item');
  for (const item of items) {
    const btn = item.querySelector('.btn-deck-action');
    if (btn && btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`startRenameDeck('${id}')`)) {
      item.innerHTML = `<div class="deck-item-info" style="flex:1;">
        <input class="deck-item-edit-input" id="deckEditInput_${id}" value="${esc(d.name)}" maxlength="30"
          onkeydown="if(event.key==='Enter') renameDeck('${id}'); else if(event.key==='Escape') renderDeckList();">
      </div>
      <div class="deck-item-actions">
        <button class="btn-deck-action" onclick="renameDeck('${id}')" title="确认">✓</button>
        <button class="btn-deck-action danger" onclick="renderDeckList()" title="取消">✕</button>
      </div>`;
      setTimeout(() => {
        const inp = document.getElementById('deckEditInput_' + id);
        if (inp) { inp.focus(); inp.select(); }
      }, 50);
      break;
    }
  }
}

function renderDeckListIcons(selectedIcons) {
  const icons = selectedIcons || [];
  return POKEMON_TYPES.map(t => {
    const isSel = icons.includes(t.emoji);
    const disabled = !isSel && icons.length >= 2;
    return `<button class="pokemon-icon-btn${isSel ? ' selected' : ''}${disabled ? ' disabled' : ''}"
      onclick="toggleDeckListIcon('${t.emoji}')" title="${t.name}">${t.emoji}</button>`;
  }).join('');
}

function toggleDeckListIcon(emoji) {
  const idx = selectedDeckListIcons.indexOf(emoji);
  if (idx >= 0) {
    selectedDeckListIcons.splice(idx, 1);
  } else if (selectedDeckListIcons.length < 2) {
    selectedDeckListIcons.push(emoji);
  }
  $('deckListIconPicker').innerHTML = renderDeckListIcons(selectedDeckListIcons);
  $('deckListSelectedIcons').textContent = selectedDeckListIcons.length > 0
    ? '已选: ' + selectedDeckListIcons.join(' ')
    : '未选择图标';
}

function addDeckToList() {
  const input = $('newDeckListInput');
  const name = input.value.trim();
  if (!name) { showToast('请输入卡组名称', 'error'); return; }
  if (!state.personal.deckList) state.personal.deckList = [];
  if (state.personal.deckList.some(d => d.name === name)) {
    showToast('卡组名称已存在', 'error'); return;
  }
  state.personal.deckList.push({
    id: uuid(),
    name,
    icons: [...selectedDeckListIcons],
  });
  saveData();
  input.value = '';
  selectedDeckListIcons = [];
  $('deckListIconPicker').innerHTML = renderDeckListIcons([]);
  $('deckListSelectedIcons').textContent = '未选择图标';
  renderDeckListManage();
  renderHistory();
  showToast('卡组 "' + name + '" 已添加到图鉴', 'success');
}

function removeDeckFromList(id) {
  const entry = (state.personal.deckList || []).find(d => d.id === id);
  if (!entry) return;
  if (!confirm('确定从图鉴中删除 "' + entry.name + '" 吗？\n已有对局记录的对手信息不会丢失。')) return;
  state.personal.deckList = (state.personal.deckList || []).filter(d => d.id !== id);
  saveData();
  renderDeckListManage();
  renderHistory();
  showToast('已删除', 'success');
}

function startEditDeckList(id) {
  editingDeckListId = id;
  renderDeckListManage();
}

function saveEditDeckList(id) {
  const input = document.getElementById('deckListEditInput_' + id);
  if (!input) { editingDeckListId = null; renderDeckListManage(); return; }
  const newName = input.value.trim();
  if (!newName) { showToast('名称不能为空', 'error'); return; }
  const entry = (state.personal.deckList || []).find(d => d.id === id);
  if (!entry) { editingDeckListId = null; renderDeckListManage(); return; }
  // 检查重名
  if (state.personal.deckList.some(d => d.id !== id && d.name === newName)) {
    showToast('卡组名称已存在', 'error'); return;
  }
  const oldName = entry.name;
  entry.name = newName;
  // 同步更新对局历史中的对手卡组名称
  (state.personal.matchHistory || []).forEach(h => {
    if (h.opponentDeck === oldName) h.opponentDeck = newName;
  });
  saveData();
  editingDeckListId = null;
  renderDeckListManage();
  renderHistory();
  showToast('已更新', 'success');
}

function cancelEditDeckList() {
  editingDeckListId = null;
  renderDeckListManage();
}

function toggleDeckListEditIcon(deckId, emoji) {
  const entry = (state.personal.deckList || []).find(d => d.id === deckId);
  if (!entry) return;
  if (!entry.icons) entry.icons = [];
  const idx = entry.icons.indexOf(emoji);
  if (idx >= 0) {
    entry.icons.splice(idx, 1);
  } else if (entry.icons.length < 2) {
    entry.icons.push(emoji);
  }
  saveData();
  renderDeckListManage();
}

function renderDeckListManage() {
  const deckList = state.personal.deckList || [];
  const container = $('deckListEntries');
  if (deckList.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:13px;">暂无对手卡组，在上方添加后，对局历史将可选对手卡组</div>';
    return;
  }
  container.innerHTML = deckList.map(d => {
    const icons = (d.icons || []).join('') || '—';

    if (editingDeckListId === d.id) {
      return `<div class="deck-list-entry" style="border-color:var(--info);background:rgba(59,109,233,0.04);">
        <div class="deck-list-entry-info" style="flex:1;">
          <input class="deck-item-edit-input" id="deckListEditInput_${d.id}" value="${esc(d.name)}" maxlength="30"
            style="width:180px;"
            onkeydown="if(event.key==='Enter'){event.preventDefault();saveEditDeckList('${d.id}');}else if(event.key==='Escape'){cancelEditDeckList();}">
          <div class="deck-list-edit-icons">
            ${POKEMON_TYPES.map(t => {
              const sel = (d.icons || []).includes(t.emoji);
              const dis = !sel && (d.icons || []).length >= 2;
              return `<button class="pokemon-icon-btn${sel ? ' selected' : ''}${dis ? ' disabled' : ''}"
                onclick="toggleDeckListEditIcon('${d.id}','${t.emoji}')" title="${t.name}">${t.emoji}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="deck-list-entry-actions">
          <button class="btn-deck-action" onclick="saveEditDeckList('${d.id}')" title="保存">✓</button>
          <button class="btn-deck-action danger" onclick="cancelEditDeckList()" title="取消">✕</button>
        </div>
      </div>`;
    }

    return `<div class="deck-list-entry">
      <div class="deck-list-entry-info">
        <span class="deck-list-entry-icons">${icons}</span>
        <span class="deck-list-entry-name">${esc(d.name)}</span>
      </div>
      <div class="deck-list-entry-actions">
        <button class="btn-deck-action" onclick="startEditDeckList('${d.id}')" title="编辑">✏</button>
        <button class="btn-deck-action danger" onclick="removeDeckFromList('${d.id}')" title="删除">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function renderMatchupAnalysis() {
  const p = state.personal;
  const curId = p.currentDeckId;
  const el = $('matchupAnalysis');
  const tbody = $('matchupTableBody');

  if (!curId) { el.style.display = 'none'; return; }

  // 收集当前卡组所有有对手信息的对局记录
  const history = (p.matchHistory || []).filter(h => h.deckId === curId && h.opponentDeck);
  if (history.length === 0) { el.style.display = 'none'; return; }

  // 按对手卡组聚合
  const matchup = {};
  history.forEach(h => {
    const opp = h.opponentDeck;
    if (!matchup[opp]) matchup[opp] = { wins: 0, losses: 0 };
    matchup[opp].wins += (h.deltaWins || 0);
    matchup[opp].losses += (h.deltaLosses || 0);
  });

  const rows = Object.entries(matchup)
    .map(([name, data]) => {
      const total = data.wins + data.losses;
      const wr = total > 0 ? (data.wins / total * 100) : 0;
      return { name, wins: data.wins, losses: data.losses, total, wr };
    })
    .sort((a, b) => b.total - a.total);

  if (rows.length === 0) { el.style.display = 'none'; return; }

  el.style.display = 'block';
  tbody.innerHTML = rows.map(r => {
    const deckEntry = (p.deckList || []).find(d => d.name === r.name);
    const iconsHtml = deckEntry && deckEntry.icons ? deckEntry.icons.join('') : '';
    const wrColor = r.wr >= 60 ? 'var(--accent)' : r.wr >= 40 ? 'var(--warning)' : 'var(--danger)';
    return `<tr>
      <td><span class="matchup-opp-name">${iconsHtml ? '<span style="font-size:14px;">' + iconsHtml + '</span>' : ''}${esc(r.name)}</span></td>
      <td class="matchup-total">${r.total}</td>
      <td class="matchup-win">${r.wins}</td>
      <td class="matchup-loss">${r.losses}</td>
      <td>
        <div class="matchup-wr-bar">
          <div class="matchup-wr-track"><div class="matchup-wr-fill" style="width:${Math.min(100, r.wr)}%;background:${wrColor}"></div></div>
          <span style="font-weight:700;color:${wrColor};">${r.wr.toFixed(1)}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderHistory() {
  const p = state.personal;
  const history = p.matchHistory || [];
  const listContainer = $('historyList');
  const emptyEl = $('historyEmpty');
  const deckList = p.deckList || [];

  if (history.length === 0) {
    listContainer.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';

  // 倒序显示（最新的在上面）
  const reversed = [...history].reverse();
  listContainer.innerHTML = reversed.map(h => {
    const d = new Date(h.time);
    const timeStr = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const opponentDeck = h.opponentDeck || '';

    // 下拉选项
    const selectOptions = deckList.map(dl => {
      const sel = dl.name === opponentDeck ? ' selected' : '';
      const iconStr = (dl.icons || []).join('');
      return `<option value="${esc(dl.name)}"${sel}>${iconStr} ${esc(dl.name)}</option>`;
    }).join('');

    // 编辑模式
    if (editingHistoryId === h.id) {
      return `<div class="history-item history-item-editing">
        <div class="history-left">
          <span class="history-deck-name">${esc(h.deckName)}</span>
          <span class="history-delta">+${h.deltaWins || 0}胜 +${h.deltaLosses || 0}败</span>
          <span class="history-cumulative">→ 累计 ${h.cumulativeWins || 0}胜 ${h.cumulativeLosses || 0}败</span>
          <span class="history-time">${timeStr}</span>
        </div>
        <div class="history-right">
          <select class="history-opponent-select" id="histEditSelect_${esc(h.id)}">
            <option value="">-- 未设置 --</option>
            ${selectOptions}
          </select>
          <button class="btn-history-action" onclick="saveHistoryOpponent('${esc(h.id)}')" title="保存">✓</button>
          <button class="btn-history-action danger" onclick="cancelEditHistory()" title="取消">✕</button>
        </div>
      </div>`;
    }

    // 正常显示模式
    const deckEntry = opponentDeck ? (deckList.find(dl => dl.name === opponentDeck)) : null;
    const opponentIcons = deckEntry ? (deckEntry.icons || []).join('') : '';
    const opponentHtml = opponentDeck
      ? `<span class="history-opponent" onclick="editHistoryOpponent('${esc(h.id)}')" style="cursor:pointer;" title="点击修改">${opponentIcons} vs ${esc(opponentDeck)}</span>`
      : `<span class="history-opponent empty" onclick="editHistoryOpponent('${esc(h.id)}')">+ 对手卡组</span>`;

    return `<div class="history-item">
      <div class="history-left">
        <span class="history-deck-name">${esc(h.deckName)}</span>
        <span class="history-delta">+${h.deltaWins || 0}胜 +${h.deltaLosses || 0}败</span>
        <span class="history-cumulative">→ 累计 ${h.cumulativeWins || 0}胜 ${h.cumulativeLosses || 0}败</span>
        <span class="history-time">${timeStr}</span>
      </div>
      <div class="history-right">
        ${opponentHtml}
      </div>
    </div>`;
  }).join('');
}

function editHistoryOpponent(id) {
  editingHistoryId = id;
  renderHistory();
  const sel = document.getElementById('histEditSelect_' + id);
  if (sel) sel.focus();
}

function cancelEditHistory() {
  editingHistoryId = null;
  editingDeckListId = null;
  renderHistory();
  renderDeckListManage();
}

function saveHistoryOpponent(id) {
  const sel = document.getElementById('histEditSelect_' + id);
  if (!sel) { editingHistoryId = null; renderHistory(); return; }
  const val = sel.value;
  const history = state.personal.matchHistory || [];
  const entry = history.find(h => h.id === id);
  if (entry) {
    if (val) {
      entry.opponentDeck = val;
    } else {
      delete entry.opponentDeck;
    }
    saveData();
    showToast('对手卡组已更新', 'success');
  }
  editingHistoryId = null;
  renderHistory();
  renderMatchupAnalysis();
}

function exportHistory() {
  const history = state.personal.matchHistory || [];
  if (history.length === 0) {
    showToast('暂无对局历史可导出', 'error');
    return;
  }

  const headers = ['时间', '使用卡组', '胜场增量', '败场增量', '累计胜场', '累计败场', '对手卡组'];
  const rows = history.map(h => {
    const d = new Date(h.time);
    const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return [
      timeStr,
      h.deckName || '',
      h.deltaWins || 0,
      h.deltaLosses || 0,
      h.cumulativeWins || 0,
      h.cumulativeLosses || 0,
      h.opponentDeck || '',
    ];
  });

  // CSV with BOM for Excel Chinese support
  const csv = '\uFEFF' + [headers, ...rows].map(r =>
    r.map(cell => {
      const s = String(cell);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ptcg-对局历史-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`已导出 ${history.length} 条对局历史`, 'success');
}

function pad(n) { return String(n).padStart(2, '0'); }

function openDeckManage() {
  $('deckManagePanel').style.display = 'block';
  renderDeckList();
}

function closeDeckManage() {
  $('deckManagePanel').style.display = 'none';
}

// ============================================================
// 渲染
// ============================================================

function render() {
  $('lastUpdate').textContent = formatTime(state.lastUpdate);

  const watchlist = state.watchlist;
  const players = state.players;

  if (watchlist.length === 0) {
    emptyState.style.display = 'block';
    tableContainer.style.display = 'none';
    statsSection.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  tableContainer.style.display = 'block';

  // 收集玩家数据
  let rows = watchlist.map(name => {
    const p = players[name];
    if (!p) return { name, key: name, pending: true };
    return { ...p, key: name };
  });

  // 搜索过滤
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    rows = rows.filter(r => {
      const name = r.name.toLowerCase();
      const note = (state.notes[r.key] || '').toLowerCase();
      return name.includes(term) || note.includes(term);
    });
  }

  // 排序
  rows.sort((a, b) => {
    if (a.pending && !b.pending) return 1;
    if (!a.pending && b.pending) return -1;
    if (a.pending && b.pending) return a.name.localeCompare(b.name);

    const aBad = a.notFound || a.error;
    const bBad = b.notFound || b.error;
    if (aBad && !bBad) return 1;
    if (!aBad && bBad) return -1;

    switch (currentSort) {
      case 'exp': return (b.exp || 0) - (a.exp || 0);
      case 'winRate': return (b.winRate || 0) - (a.winRate || 0);
      case 'winTotal': return (b.winTotal || 0) - (a.winTotal || 0);
      case 'rank':
        if (a.rank && b.rank) return a.rank - b.rank;
        if (a.rank) return -1;
        if (b.rank) return 1;
        return 0;
      case 'name': return a.name.localeCompare(b.name);
      default: return 0;
    }
  });

  playerTableBody.innerHTML = rows.map(row => renderRow(row)).join('');
  renderStats(rows);
}

function renderRow(row) {
  if (row.pending) {
    return `<tr class="row-pending">
      <td class="col-rank"><span class="rank-badge rank-none">-</span></td>
      <td class="col-name"><span class="player-name">${esc(row.name)}</span></td>
      <td class="col-note">${renderNoteCell(row.key)}</td>
      <td colspan="6" style="color:var(--text-muted);font-size:13px;">点击"更新数据"获取玩家信息</td>
    </tr>`;
  }

  if (row.notFound) {
    return `<tr class="row-notfound">
      <td class="col-rank"><span class="rank-badge rank-none">-</span></td>
      <td class="col-name"><span class="player-name">${esc(row.name)}</span></td>
      <td class="col-note">${renderNoteCell(row.key)}</td>
      <td colspan="5"><span class="status-badge badge-notfound">未找到该玩家（可能未进行排位赛）</span></td>
      <td class="col-action">${deleteBtn(row.key)}</td>
    </tr>`;
  }

  if (row.error) {
    return `<tr class="row-error">
      <td class="col-rank"><span class="rank-badge rank-none">-</span></td>
      <td class="col-name"><span class="player-name">${esc(row.name)}</span></td>
      <td class="col-note">${renderNoteCell(row.key)}</td>
      <td colspan="5"><span class="status-badge badge-error">查询失败: ${esc(row.error)}</span></td>
      <td class="col-action">${deleteBtn(row.key)}</td>
    </tr>`;
  }

  // 正常数据
  const rank = row.rank;
  let rankHtml;
  if (rank === 1) rankHtml = `<span class="rank-badge rank-1">1</span>`;
  else if (rank === 2) rankHtml = `<span class="rank-badge rank-2">2</span>`;
  else if (rank === 3) rankHtml = `<span class="rank-badge rank-3">3</span>`;
  else if (rank) rankHtml = `<span class="rank-badge rank-other">${rank}</span>`;
  else rankHtml = `<span class="rank-badge rank-none">未上榜</span>`;

  const wr = row.winRate;
  const wrCls = winRateClass(wr);
  const wrColor = winRateColor(wr);

  // 连胜/连败
  let streakHtml;
  if (row.winTemp > 0) {
    streakHtml = `<span class="streak-win">🔥${row.winTemp}连胜</span><span class="streak-max">(最高${row.winMax})</span>`;
  } else if (row.loseTemp > 0) {
    streakHtml = `<span class="streak-lose">💧${row.loseTemp}连败</span><span class="streak-max">(最高${row.loseMax})</span>`;
  } else {
    streakHtml = `<span class="streak-zero">-</span>`;
  }

  return `<tr>
    <td class="col-rank">${rankHtml}</td>
    <td class="col-name"><span class="player-name">${esc(row.name)}</span></td>
    <td class="col-note">${renderNoteCell(row.key)}</td>
    <td class="col-exp">
      <span class="exp-value">${row.exp}</span>
      <span class="exp-highest">最高 ${row.highestExp}</span>
    </td>
    <td class="col-win"><span class="win-count">${row.winTotal}</span></td>
    <td class="col-lose"><span class="lose-count">${row.loseTotal}</span></td>
    <td class="col-rate">
      <div class="winrate-bar">
        <div class="winrate-track"><div class="winrate-fill" style="width:${wr}%;background:${wrColor}"></div></div>
        <span class="winrate-text ${wrCls}">${wr}%</span>
      </div>
    </td>
    <td class="col-games"><span class="games-count">${row.totalGames}</span></td>
    <td class="col-streak"><div class="streak-display">${streakHtml}</div></td>
    <td class="col-action">${deleteBtn(row.key)}</td>
  </tr>`;
}

function deleteBtn(name) {
  return `<button class="btn-delete" onclick="removePlayer('${esc(name)}')" title="删除">✕</button>`;
}

function renderNoteCell(name) {
  const note = state.notes[name] || '';
  if (editingNote === name) {
    return `<input class="note-input" id="noteInput" value="${esc(note)}" onkeydown="noteKeydown(event,'${esc(name)}')" onblur="saveNote('${esc(name)}')" placeholder="输入备注..." maxlength="100">`;
  }
  if (note) {
    return `<span class="note-text" onclick="editNote('${esc(name)}')" title="点击编辑">${esc(note)}</span>`;
  }
  return `<span class="note-empty" onclick="editNote('${esc(name)}')">＋备注</span>`;
}

function renderStats(rows) {
  const valid = rows.filter(r => r.exp !== undefined && !r.notFound && !r.error);
  statsSection.style.display = valid.length > 0 ? 'grid' : 'none';
  if (valid.length === 0) return;

  const totalWins = valid.reduce((s, r) => s + r.winTotal, 0);
  const totalLosses = valid.reduce((s, r) => s + r.loseTotal, 0);
  const avgWr = valid.length > 0
    ? (valid.reduce((s, r) => s + r.winRate, 0) / valid.length).toFixed(1)
    : '--';

  $('statTotal').textContent = rows.length;
  $('statAvgWinRate').textContent = avgWr + '%';
  $('statTotalWins').textContent = totalWins;
  $('statTotalLosses').textContent = totalLosses;
}

// ============================================================
// 工具函数
// ============================================================

function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

function showLoading(text) {
  loadingText.textContent = text;
  loadingOverlay.style.display = 'flex';
}

function hideLoading() {
  loadingOverlay.style.display = 'none';
}

function formatTime(iso) {
  if (!iso) return '尚未更新';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function winRateClass(rate) {
  if (rate >= 60) return 'wr-high';
  if (rate >= 50) return 'wr-mid';
  return 'wr-low';
}

function winRateColor(rate) {
  if (rate >= 60) return '#4ecca3';
  if (rate >= 50) return '#f5a623';
  return '#e74c3c';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// 事件绑定
// ============================================================

refreshBtn.addEventListener('click', refreshData);
addBtn.addEventListener('click', addPlayers);
playerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    addPlayers();
  }
});
sortBy.addEventListener('change', () => {
  currentSort = sortBy.value;
  render();
});
searchInput.addEventListener('input', (e) => {
  searchTerm = e.target.value.trim();
  render();
});

// 个人板块事件
$('personalSetPlayerBtn').addEventListener('click', setPersonalPlayer);
$('personalPlayerInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); setPersonalPlayer(); }
});
$('personalRefreshApiBtn').addEventListener('click', refreshApiOverview);
$('personalFetchBtn').addEventListener('click', refreshApiOverview);
$('deckSelector').addEventListener('change', selectDeck);
$('manageDecksBtn').addEventListener('click', openDeckManage);
$('closeDeckManageBtn').addEventListener('click', closeDeckManage);
$('addDeckBtn').addEventListener('click', createDeck);
$('newDeckInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); createDeck(); }
});
$('clearHistoryBtn').addEventListener('click', clearHistory);
$('exportHistoryBtn').addEventListener('click', () => {
  exportHistory();
});
$('addDeckListBtn').addEventListener('click', addDeckToList);
$('newDeckListInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addDeckToList(); }
});

// 暴露全局函数（onclick 调用）
window.removePlayer = removePlayer;
window.editNote = function (name) {
  editingNote = name;
  render();
  const input = document.getElementById('noteInput');
  if (input) { input.focus(); input.select(); }
};
window.noteKeydown = function (e, name) {
  if (e.key === 'Enter') { e.preventDefault(); saveNote(name); }
  else if (e.key === 'Escape') { editingNote = null; render(); }
};
window.saveNote = saveNote;

// 个人板块全局函数
window.deleteDeck = deleteDeck;
window.renameDeck = renameDeck;
window.startRenameDeck = startRenameDeck;
window.renderDeckList = renderDeckList;
window.editHistoryOpponent = editHistoryOpponent;
window.saveHistoryOpponent = saveHistoryOpponent;
window.cancelEditHistory = cancelEditHistory;
window.toggleDeckListIcon = toggleDeckListIcon;
window.removeDeckFromList = removeDeckFromList;
window.startEditDeckList = startEditDeckList;
window.saveEditDeckList = saveEditDeckList;
window.cancelEditDeckList = cancelEditDeckList;
window.toggleDeckListEditIcon = toggleDeckListEditIcon;

// 菜单
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  menuDropdown.style.display = menuDropdown.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', () => {
  menuDropdown.style.display = 'none';
});
menuDropdown.addEventListener('click', (e) => e.stopPropagation());

$('autoRefreshToggle').addEventListener('click', toggleAutoRefresh);
$('exportBtn').addEventListener('click', () => {
  menuDropdown.style.display = 'none';
  exportData();
});
$('importBtn').addEventListener('click', () => {
  menuDropdown.style.display = 'none';
  $('importFile').click();
});
$('clearBtn').addEventListener('click', () => {
  menuDropdown.style.display = 'none';
  clearAllData();
});

// 头部直接可见的导出/导入按钮
$('exportBtn2').addEventListener('click', exportData);
$('importBtn2').addEventListener('click', () => $('importFile').click());

// 个人战绩模块导出/导入按钮
$('exportAllBtn').addEventListener('click', exportData);
$('importAllBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = '';
});

// ============================================================
// 悬浮窗
// ============================================================

let popupWindow = null;
const syncChannel = new BroadcastChannel('ptcg-sync');

// 打开悬浮窗（优先使用 PiP 强制置顶，不支持时回退到普通窗口）
$('popupBtn').addEventListener('click', async () => {
  if (popupWindow && !popupWindow.closed) {
    popupWindow.focus();
    return;
  }

  // 优先：Document Picture-in-Picture API — 始终置顶于所有窗口之上
  if ('documentPictureInPicture' in window) {
    try {
      const pipWindow = await documentPictureInPicture.requestWindow({
        width: 400,
        height: 560,
      });

      // 将 popup.html 内容写入 PiP 窗口
      const resp = await fetch('popup.html');
      let html = await resp.text();
      // 注入 <base> 修复相对路径（PiP 窗口的 base URL 是 about:blank）
      html = html.replace('</head>', '<base href="' + location.href.replace(/\/[^/]*$/, '/') + '"></head>');
      pipWindow.document.write(html);
      pipWindow.document.close();

      // 应用当前主题到 PiP 窗口
      const currentTheme = getTheme();
      pipWindow.document.documentElement.setAttribute('data-theme', currentTheme);

      popupWindow = pipWindow;

      pipWindow.addEventListener('pagehide', () => {
        popupWindow = null;
      });

      showToast('悬浮窗已置顶打开', 'success');
      return;
    } catch (e) {
      console.warn('PiP 打开失败，回退到普通窗口:', e);
    }
  }

  // 回退：普通浏览器窗口（不置顶）
  popupWindow = window.open('popup.html', 'ptcg-popup',
    'width=380,height=520,left=' + (screen.width - 400) + ',top=100');
  if (popupWindow) {
    const checkClosed = setInterval(() => {
      if (popupWindow.closed) { popupWindow = null; clearInterval(checkClosed); }
    }, 500);
  }
});

// 监听 popup 的刷新请求和主题切换
syncChannel.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'refresh-request') {
    refreshApiOverview();
  }
  if (e.data && e.data.type === 'deck-changed') {
    // Popup 切换了卡组，重新加载数据以同步
    loadData();
    renderPersonalSection();
  }
  if (e.data && e.data.type === 'theme-changed') {
    // Popup 切了主题，主页面同步
    setTheme(e.data.theme);
  }
});

// 数据更新后通知 popup
function notifyPopupDataUpdated() {
  syncChannel.postMessage({ type: 'data-updated' });
}

// 心跳：每 10 秒发送一次，让 popup 知道主页面还活着
setInterval(() => {
  syncChannel.postMessage({ type: 'heartbeat' });
}, 10000);

// 监听其他窗口（如 popup）对 localStorage 的修改
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) {
    loadData();
    renderPersonalSection();
  }
  if (e.key === 'ptcg-theme') {
    const theme = e.newValue || 'light';
    setTheme(theme);
  }
});

// ============================================================
// 主题切换
// ============================================================

const THEME_KEY = 'ptcg-theme';

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('themeBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀' : '🌙';
}

function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  syncChannel.postMessage({ type: 'theme-changed', theme: next });
}

$('themeBtn').addEventListener('click', toggleTheme);

// 初始化主题
applyTheme(getTheme());

// 在 saveData 后通知 popup（本地窗口 storage 事件不会触发，用 BroadcastChannel 补上）
const _originalSaveData = saveData;
saveData = function () {
  _originalSaveData();
  notifyPopupDataUpdated();
};

// 在 refreshApiOverview 成功后弹出 toast 前也通知 popup
const _originalRefreshApiOverview = refreshApiOverview;
refreshApiOverview = async function () {
  await _originalRefreshApiOverview();
  // notifyPopupDataUpdated 已在 saveData 中调用
};

// ============================================================
// 初始化
// ============================================================

loadData();
render();
renderPersonalSection();
