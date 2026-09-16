// ============================================================
// PTCG 玩家追踪器 - 组卡页
// 数据保存在 localStorage，卡图/卡组数据来自 tcg.mik.moe
// ============================================================

const CORS_PROXIES = [
  // 2026-09：原三个中转已全部失效（域名注销 / 需要 API Key / 服务 520）
  (url) => `https://cors.isteed.cc/${url}`,
  (url) => `https://cors-get-proxy.sirjosh.workers.dev/?url=${encodeURIComponent(url)}`,
  (url) => `https://cors.eu.org/${url}`,
  (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
];

const TCG_API_BASE = 'https://tcg.mik.moe/api/v3';
const TCG_IMG_BASE = 'https://tcg.mik.moe/static/img';
const POKEMON_TCG_IMG_BASE = 'https://images.pokemontcg.io'; // 公开卡图 CDN（按英文 set 编号）
const IMG_BASE_KEY = 'ptcg-img-base';       // 可自定义图床前缀（留空用默认）
const IMG_PATTERN_KEY = 'ptcg-img-pattern'; // 记住上次成功的地址模式，避免每张卡都重试
const DECK_BUILDER_KEY = 'ptcg-deck-builder-data';

const $ = (id) => document.getElementById(id);
const toast = $('toast');
let workingProxyIdx = 0; // 当前可用的代理索引

// ============================================================
// 卡图地址：完全由卡组代码里的卡牌信息推导，不依赖第三方 API
// 同一个卡可能有多种可用地址（中文版 set / 英文版 set × png / webp），
// 浏览器按顺序尝试，命中后记住该模式，后续卡牌优先使用它。
// ============================================================

function imgBase() {
  try {
    const custom = (localStorage.getItem(IMG_BASE_KEY) || '').trim();
    return custom ? custom.replace(/\/+$/, '') : TCG_IMG_BASE;
  } catch (e) {
    return TCG_IMG_BASE;
  }
}

function rememberedPattern() {
  try { return localStorage.getItem(IMG_PATTERN_KEY) || ''; } catch (e) { return ''; }
}

function rememberPattern(id) {
  try { if (id) localStorage.setItem(IMG_PATTERN_KEY, id); } catch (e) { /* 忽略 */ }
}

// 用卡组代码里的英文 set 缩写 + 编号，直接拼出公开 CDN 的卡图地址（离线映射，无需接口）
function pokemonTcgImgUrls(c) {
  const map = window.PTCG_SET_ID_MAP || {};
  const idsRaw = map[String(c.setEn || '').toUpperCase()];
  if (!idsRaw) return [];
  const ids = Array.isArray(idsRaw) ? idsRaw : [idsRaw];
  const num = String(c.numberEn || '').replace(/^0+(?=\d)/, '');
  if (!num) return [];
  const urls = [];
  ids.forEach((id) => urls.push({ id: `ptcg-${id}-png`, url: `${POKEMON_TCG_IMG_BASE}/${id}/${num}.png` }));
  ids.forEach((id) => urls.push({ id: `ptcg-${id}-hires`, url: `${POKEMON_TCG_IMG_BASE}/${id}/${num}_hires.png` }));
  return urls;
}

// 返回 [{ id, url }]，按「上次成功 → 中文版 → 英文版」的顺序
function cardImgPatterns(c) {
  const base = imgBase();
  const list = [];
  const push = (id, url) => {
    if (!url || !id) return;
    if (list.some((p) => p.url === url)) return;
    list.push({ id, url });
  };

  if (c.img) push('legacy', c.img);
  if (c.set && c.number) {
    push('cn-png', `${base}/${c.set}/${c.number}.png`);
    push('cn-webp', `${base}/${c.set}/${c.number}.webp`);
  }
  // 公开 CDN 兜底：只要卡组代码里有英文 set 缩写就能出图，不依赖任何接口
  pokemonTcgImgUrls(c).forEach((p) => push(p.id, p.url));
  if (c.setEn && c.numberEn) {
    push('en-png', `${base}/${c.setEn}/${c.numberEn}.png`);
    push('en-webp', `${base}/${c.setEn}/${c.numberEn}.webp`);
  }

  const mem = rememberedPattern();
  if (mem) {
    const i = list.findIndex((p) => p.id === mem);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
  }
  return list;
}

// 卡图加载失败时自动换下一个候选地址，全部失败才显示文字兜底
function onCardImgError(img) {
  const rest = (img.getAttribute('data-alt-src') || '').split('|').filter(Boolean);
  if (rest.length) {
    img.setAttribute('data-alt-src', rest.slice(1).join('|'));
    img.src = rest[0];
    return;
  }
  const tile = img.closest('.deck-card-tile');
  if (tile) tile.classList.add('img-error');
}

function onCardImgLoad(img) {
  const id = img.getAttribute('data-pattern');
  if (id) rememberPattern(id);
}

window.onCardImgError = onCardImgError;
window.onCardImgLoad = onCardImgLoad;

// ============================================================
// 工具函数
// ============================================================

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// POST 方式走 CORS 代理（部分代理只支持 GET 会在此跳过）
async function fetchViaProxyPost(targetUrl, body) {
  const custom = (localStorage.getItem('ptcg-relay-url') || '').trim();
  const proxies = custom
    ? [(url) => (custom.indexOf('{url}') !== -1 ? custom.replace('{url}', encodeURIComponent(url)) : custom.replace(/\/+$/, '') + '/' + url)].concat(CORS_PROXIES)
    : CORS_PROXIES;
  const tried = new Set();
  for (let attempt = 0; attempt < proxies.length; attempt++) {
    const idx = (workingProxyIdx + attempt) % proxies.length;
    if (tried.has(idx)) continue;
    tried.add(idx);
    const proxyUrl = proxies[idx](targetUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const resp = await fetch(proxyUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      workingProxyIdx = idx;
      return data;
    } catch (e) {
      // 继续尝试下一个代理
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('数据中转全部不可用，请稍后重试');
}

// ============================================================
// 组卡状态
// ============================================================

let deckBuilder = { decks: [], currentDeckId: null, owned: {}, cache: {} };

function loadDeckBuilder() {
  try {
    const raw = localStorage.getItem(DECK_BUILDER_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      deckBuilder = Object.assign({ decks: [], currentDeckId: null, owned: {}, cache: {} }, data);
      if (!Array.isArray(deckBuilder.decks)) deckBuilder.decks = [];
      if (deckBuilder.decks.length && !deckBuilder.decks.some(d => d.id === deckBuilder.currentDeckId)) {
        deckBuilder.currentDeckId = deckBuilder.decks[0].id;
      }
    }
  } catch (e) {
    console.error('加载组卡数据失败:', e);
  }
}

function saveDeckBuilder() {
  try {
    localStorage.setItem(DECK_BUILDER_KEY, JSON.stringify(deckBuilder));
  } catch (e) {
    console.error('保存组卡数据失败:', e);
    showToast('组卡数据保存失败，可能存储空间不足', 'error');
  }
}

function currentDeck() {
  return deckBuilder.decks.find(d => d.id === deckBuilder.currentDeckId) || null;
}

// 解析 tcg.mik.moe 导出的卡组代码（含 # 注释行）
function parseDeckCodeText(text) {
  const lines = String(text || '').split(/\r?\n/);
  let miniappId = null;
  const entries = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = line.match(/宝可梦官方微信小程序卡组ID\s*[:：]\s*([A-Za-z0-9]+)/i);
      if (m) miniappId = m[1];
      continue;
    }
    const m = line.match(/^(\d+)\s+(.+?)\s+([A-Za-z0-9]+)\s+(\d+)$/);
    if (m) {
      entries.push({
        count: parseInt(m[1], 10) || 1,
        name: m[2].trim(),
        set: m[3].toUpperCase(),
        number: m[4],
      });
    }
  }
  return { miniappId, entries };
}

function extractDeckUrlId(text) {
  const m = String(text || '').match(/decks\/list\/(\d+)/i);
  return m ? m[1] : null;
}

async function importDeck() {
  const input = $('deckCodeInput').value.trim();
  const msg = $('deckImportMsg');
  msg.className = 'add-result';
  msg.textContent = '';
  if (!input) {
    msg.className = 'add-result error';
    msg.textContent = '请先粘贴卡组代码或卡组链接';
    return;
  }

  let apiCards = null;
  let title = '';

  // 1) 卡组链接 → deck/detail
  const deckId = extractDeckUrlId(input);
  if (deckId) {
    msg.textContent = '正在从卡组链接导入...';
    try {
      const data = await fetchViaProxyPost(`${TCG_API_BASE}/deck/detail`, { deckId: Number(deckId) });
      const d = data && data.data;
      if (d && Array.isArray(d.cards) && d.cards.length) {
        apiCards = d.cards;
        title = d.deckName || (d.variant && d.variant.variantName) || '';
      } else {
        msg.className = 'add-result error';
        msg.textContent = '未能在该链接中找到卡组，请检查链接';
      }
    } catch (e) {
      msg.className = 'add-result error';
      msg.textContent = '链接导入失败（网络或代理不可用），请尝试粘贴卡组代码';
    }
  }

  // 2) 卡组代码 → 小程序ID → export-miniapp
  const parsed = parseDeckCodeText(input);
  if (!apiCards && parsed.miniappId) {
    msg.textContent = '正在通过小程序卡组ID导入...';
    try {
      const data = await fetchViaProxyPost(`${TCG_API_BASE}/deck/export-miniapp`, { deckCode: parsed.miniappId });
      const d = data && data.data;
      if (d && Array.isArray(d.cards) && d.cards.length) {
        apiCards = d.cards;
        title = (d.variant && d.variant.variantName) || '';
      } else {
        msg.className = 'add-result error';
        msg.textContent = '小程序卡组ID无效或卡组不存在';
      }
    } catch (e) {
      msg.className = 'add-result error';
      msg.textContent = '小程序卡组导入失败（网络或代理不可用），将按文本生成卡组';
    }
  }

  let cards = null;
  if (apiCards && apiCards.length) {
    cards = apiCards.map(c => {
      const set = c.setCode || '';
      const number = c.cardIndex || '';
      return {
        key: `${set}|${number}`,
        name: c.cardName || c.nameEn || `${c.setCodeEn || set} ${c.cardIndexEn || number}`,
        nameEn: c.nameEn || '',
        set,
        number,
        setEn: c.setCodeEn || '',
        numberEn: c.cardIndexEn || '',
        count: c.count || 1,
        img: set && number ? `${imgBase()}/${set}/${number}.png` : '',
        type: c.cardType || '',
      };
    });
    // 缓存 EN → CN 映射，便于后续纯文本卡组代码复用卡图
    apiCards.forEach(c => {
      if (c.setCodeEn && c.cardIndexEn && c.setCode && c.cardIndex) {
        deckBuilder.cache[`${c.setCodeEn}|${c.cardIndexEn}`] = { set: c.setCode, number: c.cardIndex };
      }
    });
  } else {
    // 3) 纯文本兜底：本地解析
    if (!parsed.entries.length) {
      msg.className = 'add-result error';
      msg.textContent = '无法识别卡组代码，请检查格式（每行：数量 卡名 缩写 编号）';
      return;
    }
    cards = parsed.entries.map(en => {
      const hit = deckBuilder.cache[`${en.set}|${en.number}`];
      return {
        key: hit ? `${hit.set}|${hit.number}` : `en|${en.set}|${en.number}`,
        name: en.name,
        nameEn: en.name,
        // 中文版 set 只有 API/缓存里才有；拿不到也没关系，卡图会用英文版 set 兜底
        set: hit ? hit.set : '',
        number: hit ? hit.number : '',
        setEn: en.set,
        numberEn: en.number,
        count: en.count,
        img: '',
        type: '',
      };
    });
    if (!title) title = cards[0] ? `${cards[0].name} 等` : '卡组';
  }

  addDeckToBuilder(cards, title);
  const total = cards.reduce((s, c) => s + c.count, 0);
  msg.className = 'add-result success';
  msg.textContent = `导入成功：共 ${cards.length} 种 / ${total} 张`;
  if (!apiCards) {
    msg.textContent += '（按文本生成，卡图按代码里的 set/编号 自动匹配）';
  }
  showToast('卡组导入成功', 'success');
}

function addDeckToBuilder(cards, title) {
  const id = 'd_' + Date.now();
  deckBuilder.decks.push({
    id,
    title: title || `卡组 ${new Date().toLocaleDateString('zh-CN')}`,
    cards,
    createdAt: Date.now(),
  });
  if (deckBuilder.decks.length > 20) deckBuilder.decks = deckBuilder.decks.slice(-20);
  deckBuilder.currentDeckId = id;
  if (!deckBuilder.owned[id]) deckBuilder.owned[id] = {};
  saveDeckBuilder();
  renderDeckBuilder();
  $('deckCodeInput').value = '';
}

function renderDeckBuilder() {
  const deck = currentDeck();
  const hasDeck = !!deck;
  $('deckBuilderResult').style.display = hasDeck ? 'flex' : 'none';
  $('resetOwnedBtn').disabled = !hasDeck;
  $('deleteDeckBtn').disabled = !hasDeck;
  if (!deck) return;

  $('deckBuilderTitle').textContent = deck.title;
  renderDeckSelector();
  renderDeckBuilderStats(deck);
  renderCardGrid(deck);
  renderBreakdown(deck);
}

function renderDeckSelector() {
  const sel = $('deckBuilderSelector');
  sel.innerHTML = deckBuilder.decks.map(d =>
    `<option value="${esc(d.id)}" ${d.id === deckBuilder.currentDeckId ? 'selected' : ''}>${esc(d.title)}</option>`
  ).join('');
  sel.style.display = deckBuilder.decks.length > 1 ? 'inline-block' : 'none';
}

function renderDeckBuilderStats(deck) {
  const owned = deckBuilder.owned[deck.id] || {};
  let total = 0;
  let have = 0;
  let minSets = Infinity;
  deck.cards.forEach(c => {
    const o = owned[c.key] || 0;
    const need = c.count;
    total += need;
    have += Math.min(o, need);
    minSets = Math.min(minSets, Math.floor(o / need));
  });
  if (!deck.cards.length) minSets = 0;
  const missing = total - have;
  const pct = total ? Math.round((have / total) * 100) : 0;
  $('deckBuilderStats').innerHTML = `
    <div class="deck-builder-stat stat-primary"><span class="stat-num">${total}</span><span class="stat-label">卡组总张数</span></div>
    <div class="deck-builder-stat stat-ok"><span class="stat-num">${have}</span><span class="stat-label">已有（实体卡）</span></div>
    <div class="deck-builder-stat ${missing > 0 ? 'stat-danger' : 'stat-ok'}"><span class="stat-num">${missing}</span><span class="stat-label">还缺</span></div>
    <div class="deck-builder-stat ${minSets > 0 ? 'stat-ok' : 'stat-warn'}"><span class="stat-num">${minSets}</span><span class="stat-label">可直接组出（套）</span></div>
    <div class="deck-progress">
      <div class="deck-progress-head"><span>完成度</span><span>${pct}%</span></div>
      <div class="deck-progress-track"><div class="deck-progress-fill" style="width:${pct}%"></div></div>
    </div>`;
}

function renderCardGrid(deck) {
  const owned = deckBuilder.owned[deck.id] || {};
  const onlyMissing = $('onlyMissingToggle').checked;
  const visible = deck.cards.filter(c => !onlyMissing || (owned[c.key] || 0) < c.count);
  $('deckCardGrid').innerHTML = visible.map(c => {
    const o = owned[c.key] || 0;
    const complete = o >= c.count;
    const patterns = cardImgPatterns(c);
    const cls = (complete ? 'complete' : (o > 0 ? 'partial' : 'missing')) + (patterns.length ? '' : ' img-error');
    const setLabel = (c.setEn || c.set) && (c.numberEn || c.number)
      ? `${esc(c.setEn || c.set)} ${esc(c.numberEn || c.number)}`
      : '';
    const imgHtml = patterns.length
      ? `<img src="${esc(patterns[0].url)}" data-pattern="${esc(patterns[0].id)}" data-alt-src="${esc(patterns.slice(1).map(p => p.url).join('|'))}" alt="${esc(c.name)}" loading="lazy" referrerpolicy="no-referrer" onload="onCardImgLoad(this)" onerror="onCardImgError(this)">`
      : `<div class="deck-card-text-fallback">${esc(c.name)}</div>`;
    return `<div class="deck-card-tile ${cls}" data-key="${esc(c.key)}">
      <div class="deck-card-img-wrap" data-key="${esc(c.key)}" onclick="onDeckCardClick(event)">
        ${imgHtml}
        <span class="deck-owned-badge ${complete ? 'ok' : ''}">持有 ${o}/${c.count}</span>
        <div class="deck-card-zone zone-plus">＋</div>
        <div class="deck-card-zone zone-minus">－</div>
        <div class="deck-card-zone-divider"></div>
      </div>
      <div class="deck-card-info">
        <span class="deck-card-name">${esc(c.name)}</span>
        ${setLabel ? `<span class="deck-card-set">${setLabel}${c.type ? ' · ' + esc(c.type) : ''}</span>` : ''}
        <span class="deck-card-counts">已有 <b>${o}</b> / 需要 ${c.count}${complete ? ' ✓ 已齐' : ''}</span>
      </div>
    </div>`;
  }).join('');
}

// 点击卡牌：左 70% +1，右 30% -1
function onDeckCardClick(e) {
  const wrap = e.currentTarget;
  const key = wrap.getAttribute('data-key');
  const deck = currentDeck();
  if (!deck || !key) return;
  const card = deck.cards.find(c => c.key === key);
  if (!card) return;

  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const ratio = rect.width ? x / rect.width : 1;
  if (!deckBuilder.owned[deck.id]) deckBuilder.owned[deck.id] = {};
  let owned = deckBuilder.owned[deck.id][key] || 0;
  if (ratio <= 0.7) {
    // 持有数上限 = 卡组导入时的需求数
    owned = Math.min(owned + 1, card.count);
  } else {
    owned = Math.max(owned - 1, 0);
  }
  deckBuilder.owned[deck.id][key] = owned;
  saveDeckBuilder();
  renderDeckBuilder();
}

function renderBreakdown(deck) {
  const owned = deckBuilder.owned[deck.id] || {};
  const onlyMissing = $('onlyMissingToggle').checked;
  const rows = deck.cards.map(c => {
    const o = owned[c.key] || 0;
    return {
      name: c.name,
      o,
      need: c.count,
      missing: Math.max(c.count - o, 0),
      set: c.setEn || c.set,
      number: c.numberEn || c.number,
    };
  });
  rows.sort((a, b) => b.missing - a.missing || b.need - a.need);
  const filtered = onlyMissing ? rows.filter(r => r.missing > 0) : rows;
  if (!filtered.length) {
    $('deckBreakdownBody').innerHTML = '<div class="deck-breakdown-empty">🎉 所有卡牌都已集齐，可以直接组卡！</div>';
    return;
  }
  $('deckBreakdownBody').innerHTML = filtered.map(r => {
    const pct = Math.min(100, Math.round((r.o / r.need) * 100));
    return `<div class="deck-breakdown-row ${r.missing > 0 ? 'missing' : ''}">
      <span class="breakdown-name">${esc(r.name)}</span>
      <div class="breakdown-bar"><div class="breakdown-bar-fill" style="width:${pct}%"></div></div>
      <span class="breakdown-counts">${r.o}/${r.need}</span>
      <span class="breakdown-status ${r.missing > 0 ? 'status-missing' : 'status-ok'}">${r.missing > 0 ? '缺 ' + r.missing : '✓'}</span>
    </div>`;
  }).join('');
}

function resetOwned() {
  const deck = currentDeck();
  if (!deck) return;
  if (!window.confirm('确定要清空当前卡组的所有持有数吗？')) return;
  deckBuilder.owned[deck.id] = {};
  saveDeckBuilder();
  renderDeckBuilder();
  showToast('已重置持有数', 'success');
}

function deleteCurrentDeck() {
  const deck = currentDeck();
  if (!deck) return;
  if (!window.confirm(`确定删除卡组"${deck.title}"及其持有记录吗？`)) return;
  deckBuilder.decks = deckBuilder.decks.filter(d => d.id !== deck.id);
  delete deckBuilder.owned[deck.id];
  deckBuilder.currentDeckId = deckBuilder.decks.length ? deckBuilder.decks[deckBuilder.decks.length - 1].id : null;
  saveDeckBuilder();
  renderDeckBuilder();
  showToast('卡组已删除', 'success');
}

function loadExampleDeck() {
  $('deckCodeInput').value = [
    '# Created by: tcg.mik.moe',
    '# 宝可梦官方微信小程序卡组ID: u0V77BXuvEFRERtCxS',
    '3 Charmander PAF 7',
    '1 Charmeleon MEW 5',
    '1 Charmeleon PAF 8',
    '2 Charizard ex OBF 125',
    '2 Duskull PRE 35',
    '1 Dusclops SFA 19',
    '1 Dusknoir SFA 20',
    '1 Pidgey OBF 162',
    '1 Pidgey MEW 16',
    '1 Pidgeotto MEW 17',
    '2 Pidgeot ex OBF 164',
    '1 Chi-Yu PAR 29',
    '1 Fezandipiti ex SFA 38',
    '1 Tatsugiri TWM 131',
    '1 Klefki SVI 96',
    '4 Arven SVI 166',
    '4 Iono PAL 185',
    "2 Boss's Orders RCL 154",
    '1 Briar PRE 100',
    '4 Ultra Ball SLG 68',
    '4 Buddy-Buddy Poffin PRE 101',
    '3 Rare Candy SUM 129',
    '2 Counter Catcher CIN 91',
    '2 Super Rod PAL 188',
    '2 Artazon PAL 171',
    '2 Technical Machine: Evolution PAR 178',
    '1 Maximum Belt PRE 117',
    '5 Fire Energy SVE 2',
    '4 Jet Energy PAL 190',
  ].join('\n');
  importDeck();
}

// ============================================================
// 事件绑定与初始化
// ============================================================

$('importDeckBtn').addEventListener('click', importDeck);
$('loadExampleDeckBtn').addEventListener('click', loadExampleDeck);
$('resetOwnedBtn').addEventListener('click', resetOwned);
$('deleteDeckBtn').addEventListener('click', deleteCurrentDeck);
$('deckBuilderSelector').addEventListener('change', (e) => {
  deckBuilder.currentDeckId = e.target.value;
  saveDeckBuilder();
  renderDeckBuilder();
});
$('onlyMissingToggle').addEventListener('change', () => {
  const deck = currentDeck();
  if (deck) {
    renderCardGrid(deck);
    renderBreakdown(deck);
  }
});

loadDeckBuilder();
renderDeckBuilder();
