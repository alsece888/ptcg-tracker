// ============================================================
// 统一数据存储层：主页面 (app.js) 与悬浮窗 (popup.html) 共用
//
// 对战历史「丢失 / 记不准」的三个根因，以及这里的解法：
//  1) 两个窗口各自把「整份快照」写回 localStorage，谁后写谁赢，
//     另一个窗口期间新增的记录被整份覆盖。
//     → 改成「读最新数据 → 按记录合并 → 写回」，同 id 取 updatedAt 新的那份。
//  2) 差额记账是「先取 state.personal 引用 → await 网络 → 再改」，
//     期间任何一次 loadData() 都会让 state 换新对象，改动写进没人引用的旧对象。
//     → mutate() 提供同步的「读 → 改 → 写」，调用方在网络返回后再现取现算。
//  3) 同一个差额被并发的多次刷新各记一遍（重复计数）。
//     → 记账放进 mutate() 里基于「最新存储里的 lastApiWins」计算一次。
//
// 另外：
//  - 删除写入墓碑（tombstone），合并时不会被旧快照「复活」；
//  - 清空历史写入 historyClearedAt，早于它的记录不会再回来；
//  - 每次写入前把旧数据轮转备份到 ptcg-tracker-backups；
//  - 每条历史记录都会进 ptcg-history-journal，万一真的丢了可以自动捞回。
// ============================================================
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PtcgStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var KEY = 'ptcg-tracker-data';
  var BACKUP_KEY = 'ptcg-tracker-backups';
  var JOURNAL_KEY = 'ptcg-history-journal';
  var MAX_BACKUPS = 3;
  var MAX_JOURNAL = 600;
  var MAX_BACKUP_BYTES = 400000; // 单份备份超过 400KB 就不再留，避免撑爆 localStorage

  function store() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
  }

  function deepCopy(v) {
    if (v === undefined) return undefined;
    return JSON.parse(JSON.stringify(v));
  }

  function stampOf(v) {
    return (v && typeof v.updatedAt === 'number') ? v.updatedAt : 0;
  }

  // 时间戳必须严格递增：同一毫秒内的两次写入若时间戳相等，合并时会误判成「没有更新」
  // （旧的实际表现：刚记下的差额基准被当成旧值，下一次刷新又把同一差额记一遍）
  function nextStamp(floor) {
    var now = Date.now();
    return now > floor ? now : floor + 1;
  }

  function maxStamp(data) {
    var max = 0;
    var p = (data && data.personal) || {};
    (p.matchHistory || []).forEach(function (e) { max = Math.max(max, stampOf(e)); });
    Object.keys(p.decks || {}).forEach(function (k) { max = Math.max(max, stampOf(p.decks[k])); });
    (p.deckList || []).forEach(function (d) { max = Math.max(max, stampOf(d)); });
    ['apiSnapAt', 'draftAt', 'currentDeckAt'].forEach(function (k) {
      if (typeof p[k] === 'number') max = Math.max(max, p[k]);
    });
    return max;
  }

  // ---------- 规范化 ----------
  function normalize(input) {
    var d = (input && typeof input === 'object') ? input : {};
    if (!Array.isArray(d.watchlist)) d.watchlist = [];
    if (!d.players || typeof d.players !== 'object') d.players = {};
    if (!d.notes || typeof d.notes !== 'object') d.notes = {};
    if (d.lastUpdate === undefined) d.lastUpdate = null;

    var p = (d.personal && typeof d.personal === 'object') ? d.personal : (d.personal = {});
    if (typeof p.playerName !== 'string') p.playerName = p.playerName ? String(p.playerName) : '';
    if (!p.decks || typeof p.decks !== 'object') p.decks = {};
    if (!Array.isArray(p.matchHistory)) p.matchHistory = [];
    if (!Array.isArray(p.deckList)) p.deckList = [];
    if (p.draftMatch === undefined) p.draftMatch = null;
    if (!p.historyTombstones || typeof p.historyTombstones !== 'object') p.historyTombstones = {};
    if (!p.deckTombstones || typeof p.deckTombstones !== 'object') p.deckTombstones = {};
    if (!p.deckListTombstones || typeof p.deckListTombstones !== 'object') p.deckListTombstones = {};
    if (typeof p.historyClearedAt !== 'number') p.historyClearedAt = 0;

    // 老数据没有 updatedAt：用记录自带的时间兜底
    p.matchHistory.forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      if (typeof e.updatedAt !== 'number') e.updatedAt = Date.parse(e.time) || 0;
      stripTransient(e);
    });
    Object.keys(p.decks).forEach(function (id) {
      var dk = p.decks[id];
      if (!dk || typeof dk !== 'object') return;
      if (typeof dk.updatedAt !== 'number') dk.updatedAt = 0;
      stripTransient(dk);
    });
    p.deckList.forEach(function (dl) {
      if (!dl || typeof dl !== 'object') return;
      if (typeof dl.updatedAt !== 'number') dl.updatedAt = 0;
      stripTransient(dl);
    });
    return d;
  }

  // 悬浮窗编辑时会挂 _editingOpp/_editingTurn 这类临时标记，只存在于界面状态里，不该进存储
  function stripTransient(obj) {
    Object.keys(obj).forEach(function (k) {
      if (k.charAt(0) === '_') delete obj[k];
    });
  }

  function readRaw() {
    var ls = store();
    if (!ls) return null;
    try {
      var raw = ls.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : null;
    } catch (e) {
      return null;
    }
  }

  function read() {
    var raw = readRaw();
    return raw ? normalize(raw) : null;
  }

  // ---------- 合并 ----------
  function mergeTombstones(a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) {
      if (!(k in out) || b[k] > out[k]) out[k] = b[k];
    });
    return out;
  }

  function mergeDecks(baseDecks, incDecks, tombstones) {
    var out = {};
    Object.keys(baseDecks || {}).forEach(function (k) { out[k] = baseDecks[k]; });
    Object.keys(incDecks || {}).forEach(function (k) {
      var a = out[k], b = incDecks[k];
      if (!a) { out[k] = b; return; }
      if (stampOf(b) > stampOf(a)) out[k] = b; // 平局保留存储里的那份，避免旧快照回退
    });
    Object.keys(out).forEach(function (k) {
      var t = tombstones && tombstones[k];
      if (t && t >= stampOf(out[k])) delete out[k];
    });
    return out;
  }

  function mergeIdList(baseArr, incArr, tombstones) {
    var map = {};
    var order = [];
    function put(list) {
      (list || []).forEach(function (d) {
        if (!d || !d.id) return;
        var a = map[d.id];
        if (!a) { map[d.id] = d; order.push(d.id); return; }
        if (stampOf(d) > stampOf(a)) map[d.id] = d;
      });
    }
    put(baseArr);
    put(incArr);
    return order.map(function (id) { return map[id]; }).filter(function (d) {
      var t = tombstones && tombstones[d.id];
      return !(t && t >= stampOf(d));
    });
  }

  function mergeHistory(baseArr, incArr, personal) {
    var map = {};
    function put(list) {
      (list || []).forEach(function (e) {
        if (!e || !e.id) return;
        var a = map[e.id];
        if (!a || stampOf(e) > stampOf(a)) map[e.id] = e;
      });
    }
    put(baseArr);
    put(incArr);
    var out = [];
    Object.keys(map).forEach(function (id) {
      var e = map[id];
      var tomb = personal.historyTombstones[id];
      if (tomb && tomb >= stampOf(e)) return;                       // 已删除
      if (personal.historyClearedAt && stampOf(e) <= personal.historyClearedAt) return;
      out.push(e);
    });
    out.sort(function (x, y) { return stampOf(x) - stampOf(y); });
    return out;
  }

  function merge(base, inc, opts) {
    opts = opts || {};
    var out = normalize(deepCopy(base) || {});
    var incoming = normalize(deepCopy(inc) || {});

    if (opts.authoritative) {
      // 主页面这是「全量快照」写入：关注列表/备注/玩家数据以传入的为准（与旧行为一致）
      out.watchlist = incoming.watchlist;
      out.lastUpdate = incoming.lastUpdate;
      out.players = incoming.players;
      out.notes = incoming.notes;
    } else {
      // 悬浮窗这类「只改局部」的写入：不动关注列表/玩家数据，只补缺失的键
      var names = {};
      out.watchlist.forEach(function (w) { names[w] = true; });
      incoming.watchlist.forEach(function (w) { if (!names[w]) { names[w] = true; out.watchlist.push(w); } });
      Object.keys(incoming.players).forEach(function (k) { if (!(k in out.players)) out.players[k] = incoming.players[k]; });
      Object.keys(incoming.notes).forEach(function (k) { if (!(k in out.notes)) out.notes[k] = incoming.notes[k]; });
    }

    var bp = out.personal;
    var ip = incoming.personal;
    bp.historyTombstones = mergeTombstones(bp.historyTombstones, ip.historyTombstones);
    bp.deckTombstones = mergeTombstones(bp.deckTombstones, ip.deckTombstones);
    bp.deckListTombstones = mergeTombstones(bp.deckListTombstones, ip.deckListTombstones);
    bp.historyClearedAt = Math.max(bp.historyClearedAt || 0, ip.historyClearedAt || 0);
    bp.decks = mergeDecks(bp.decks, ip.decks, bp.deckTombstones);
    bp.deckList = mergeIdList(bp.deckList, ip.deckList, bp.deckListTombstones);
    bp.matchHistory = mergeHistory(bp.matchHistory, ip.matchHistory, bp);

    bp.playerName = ip.playerName || bp.playerName;
    // 标量用「后写胜出」（>=）：本窗口刚算出来的值就是最新的
    if ((ip.currentDeckAt || 0) >= (bp.currentDeckAt || 0) && ip.currentDeckId !== undefined) {
      bp.currentDeckId = ip.currentDeckId;
      bp.currentDeckAt = ip.currentDeckAt;
    } else if (bp.currentDeckId == null && ip.currentDeckId) {
      bp.currentDeckId = ip.currentDeckId;
      bp.currentDeckAt = ip.currentDeckAt || 0;
    }
    if ((ip.draftAt || 0) >= (bp.draftAt || 0) && ip.draftMatch !== undefined) {
      bp.draftMatch = ip.draftMatch;
      bp.draftAt = ip.draftAt;
    } else if (bp.draftMatch == null && ip.draftMatch) {
      bp.draftMatch = ip.draftMatch;
      bp.draftAt = ip.draftAt || 0;
    }
    if ((ip.apiSnapAt || 0) >= (bp.apiSnapAt || 0) && ip.lastApiWins !== undefined) {
      bp.lastApiWins = ip.lastApiWins;
      bp.lastApiLosses = ip.lastApiLosses;
      bp.apiSnapAt = ip.apiSnapAt;
    } else if (bp.lastApiWins === undefined) {
      bp.lastApiWins = ip.lastApiWins;
      bp.lastApiLosses = ip.lastApiLosses;
      bp.apiSnapAt = ip.apiSnapAt || 0;
    }
    return out;
  }

  // ---------- 变更打时间戳（本窗口改了什么，就更新它的 updatedAt）----------
  function flushTombstones(incTomb, prevTomb, stamp) {
    prevTomb = prevTomb || {};
    Object.keys(incTomb || {}).forEach(function (id) {
      if (incTomb[id] !== prevTomb[id]) incTomb[id] = stamp(0);
    });
  }

  // prev：本窗口上次读到/写入的副本；base：存储里的当前值。
  // 本窗口的改动要拿到比两者都新的时间戳，才能在合并时胜出。
  function stampChanges(inc, prev, tombstoneMissing, base) {
    var floor = Math.max(maxStamp(prev), maxStamp(base));
    var stamp = function (old) { return nextStamp(Math.max(floor, old || 0)); };
    var ip = inc.personal;
    var pp = (prev && prev.personal) || {};

    var prevDecks = pp.decks || {};
    Object.keys(ip.decks).forEach(function (id) {
      var a = prevDecks[id];
      if (!a || JSON.stringify(a) !== JSON.stringify(ip.decks[id])) ip.decks[id].updatedAt = stamp(stampOf(a));
    });

    // 界面上显式写的墓碑（删除卡组 / 清空历史）也统一抬到比现有时间戳都新，
    // 否则记录的时间戳稍微靠前一点（合并时的单调递增可能超过 wall clock），删除就会失效
    flushTombstones(ip.historyTombstones, pp.historyTombstones, stamp);
    flushTombstones(ip.deckTombstones, pp.deckTombstones, stamp);
    flushTombstones(ip.deckListTombstones, pp.deckListTombstones, stamp);
    if (ip.historyClearedAt && ip.historyClearedAt !== (pp.historyClearedAt || 0)) ip.historyClearedAt = stamp(0);

    if (tombstoneMissing) {
      Object.keys(prevDecks).forEach(function (id) {
        if (!(id in ip.decks)) ip.deckTombstones[id] = stamp(0);
      });
    }

    var prevEntries = {};
    (pp.matchHistory || []).forEach(function (e) { if (e && e.id) prevEntries[e.id] = e; });
    ip.matchHistory.forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      var a = prevEntries[e.id];
      if (!a) e.updatedAt = stamp(0);                                        // 新记录
      else if (JSON.stringify(a) !== JSON.stringify(e)) e.updatedAt = stamp(stampOf(a)); // 改动过
      else if (typeof e.updatedAt !== 'number') e.updatedAt = stampOf(a);
    });
    if (tombstoneMissing) {
      var nowIds = {};
      ip.matchHistory.forEach(function (e) { if (e && e.id) nowIds[e.id] = true; });
      Object.keys(prevEntries).forEach(function (id) {
        if (!nowIds[id]) ip.historyTombstones[id] = stamp(0);
      });
    }

    var prevList = {};
    (pp.deckList || []).forEach(function (d) { if (d && d.id) prevList[d.id] = d; });
    ip.deckList.forEach(function (d) {
      if (!d || !d.id) return;
      var a = prevList[d.id];
      if (!a || JSON.stringify(a) !== JSON.stringify(d)) d.updatedAt = stamp(stampOf(a));
    });
    if (tombstoneMissing) {
      var listIds = {};
      ip.deckList.forEach(function (d) { if (d && d.id) listIds[d.id] = true; });
      Object.keys(prevList).forEach(function (id) {
        if (!listIds[id]) ip.deckListTombstones[id] = stamp(0);
      });
    }

    if (JSON.stringify(pp.draftMatch || null) !== JSON.stringify(ip.draftMatch || null)) ip.draftAt = stamp(0);
    if (pp.currentDeckId !== ip.currentDeckId) ip.currentDeckAt = stamp(0);
    if (pp.lastApiWins !== ip.lastApiWins || pp.lastApiLosses !== ip.lastApiLosses) ip.apiSnapAt = stamp(0);
  }

  // ---------- 写入 + 备份 + 日志 ----------
  function pushBackup(raw) {
    var ls = store();
    if (!ls || !raw || raw.length > MAX_BACKUP_BYTES) return;
    try {
      var list = JSON.parse(ls.getItem(BACKUP_KEY) || '[]');
      if (!Array.isArray(list)) list = [];
      list.unshift({ at: Date.now(), raw: raw });
      ls.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, MAX_BACKUPS)));
    } catch (e) { /* 备份失败不影响主流程 */ }
  }

  function journalAdd(entries) {
    var ls = store();
    if (!ls || !entries.length) return;
    try {
      var j = JSON.parse(ls.getItem(JOURNAL_KEY) || '{}');
      if (!j || typeof j !== 'object') j = {};
      entries.forEach(function (e) {
        if (!e || !e.id) return;
        var cur = j[e.id];
        if (!cur || stampOf(e) >= stampOf(cur)) j[e.id] = e;
      });
      var ids = Object.keys(j);
      if (ids.length > MAX_JOURNAL) {
        ids.sort(function (x, y) { return stampOf(j[y]) - stampOf(j[x]); });
        ids.slice(MAX_JOURNAL).forEach(function (id) { delete j[id]; });
      }
      ls.setItem(JOURNAL_KEY, JSON.stringify(j));
    } catch (e) { /* 日志失败不影响主流程 */ }
  }

  function write(data, prevRaw) {
    var ls = store();
    if (!ls) return;
    var raw = JSON.stringify(data);
    try {
      ls.setItem(KEY, raw);
    } catch (e) {
      // 空间不足：先丢掉备份和日志，再试一次，保正数据本身
      try {
        ls.removeItem(BACKUP_KEY);
        ls.removeItem(JOURNAL_KEY);
        ls.setItem(KEY, raw);
      } catch (e2) {
        throw e2;
      }
    }
    pushBackup(prevRaw);
    journalAdd(data.personal.matchHistory || []);
  }

  // ---------- 对外 API ----------

  // 同步「读最新 → 改 → 合并写回」，返回写回后的完整数据
  function mutate(fn) {
    var base = read() || normalize({});
    var draft = deepCopy(base);
    var returned = fn ? fn(draft) : draft;
    var next = normalize((returned && typeof returned === 'object') ? returned : draft);
    stampChanges(next, base, false, base); // 悬浮窗只做局部修改，不做「缺失即删除」
    var merged = merge(base, next, { authoritative: false });
    write(merged, JSON.stringify(base));
    return merged;
  }

  // 主页面：传入整份内存快照。prev 是本窗口上次读到/写入的副本，用于判断「我改了什么」
  // 注意 tombstoneMissing 默认 false：不能靠「快照里少了某条」就认定是删除——
  // 一个开着很久的旧窗口，快照里本来就没有别处新增的记录，那样会误删。
  // 删除要在界面上真的删（deleteDeck / clearHistory 会显式写墓碑）。
  function applyState(incoming, prev, opts) {
    opts = opts || {};
    var base = read() || normalize({});
    var inc = normalize(deepCopy(incoming));
    // prev 也要规范化后再比较：否则「补 updatedAt」这一步会被误判成「这条刚改过」
    var prevNorm = normalize(deepCopy(prev || base));
    stampChanges(inc, prevNorm, opts.tombstoneMissing === true, base);
    var merged = merge(base, inc, { authoritative: opts.authoritative !== false });
    write(merged, JSON.stringify(base));
    return merged;
  }

  // 从日志里捞回历史记录（存储里少了的补回来，已删除的不复活）
  function recoverHistory(data) {
    var ls = store();
    if (!ls || !data || !data.personal) return 0;
    var p = data.personal;
    var found = 0;
    try {
      var j = JSON.parse(ls.getItem(JOURNAL_KEY) || '{}');
      if (!j || typeof j !== 'object') return 0;
      var have = {};
      (p.matchHistory || []).forEach(function (e) { if (e && e.id) have[e.id] = true; });
      Object.keys(j).forEach(function (id) {
        if (have[id]) return;
        var e = j[id];
        if (!e || !e.id) return;
        var tomb = p.historyTombstones[id];
        if (tomb && tomb >= stampOf(e)) return;
        if (p.historyClearedAt && stampOf(e) <= p.historyClearedAt) return;
        var deckTomb = e.deckId ? p.deckTombstones[e.deckId] : 0;
        if (deckTomb && deckTomb >= stampOf(e)) return;
        p.matchHistory.push(e);
        found++;
      });
      if (found) {
        p.matchHistory.sort(function (x, y) { return stampOf(x) - stampOf(y); });
      }
    } catch (e) { /* 忽略 */ }
    return found;
  }

  function backups() {
    var ls = store();
    if (!ls) return [];
    try { return JSON.parse(ls.getItem(BACKUP_KEY) || '[]'); } catch (e) { return []; }
  }

  return {
    KEY: KEY,
    BACKUP_KEY: BACKUP_KEY,
    JOURNAL_KEY: JOURNAL_KEY,
    normalize: normalize,
    read: read,
    readRaw: readRaw,
    mutate: mutate,
    applyState: applyState,
    recoverHistory: recoverHistory,
    backups: backups,
    stampOf: stampOf,
  };
});
