// Password-gated Teable bridge. The Teable token and signing key are Worker secrets.
const USER_ID = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const ENTRY_ID = /^[A-Za-z0-9_-]{1,80}$/;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const SALT = /^[A-Za-z0-9_-]{22}$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 40;
const MAX_BATCH = 10;
const MAX_BODY_BYTES = 100_000;

function response(data, status = 200, origin = '') {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers.Vary = 'Origin';
  }
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.SITE_ORIGINS || 'https://malo-ptcg.cn')
    .split(',').map((item) => item.trim());
  return allowed.includes(origin) ? origin : '';
}

function validUserId(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!USER_ID.test(id)) throw new HttpError(400, '用户 ID 需为 3–32 位小写英文字母、数字、_ 或 -，且以字母或数字开头');
  return id;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function teablePath(env, suffix) {
  const id = env.TEABLE_TABLE_ID || 'tblvmcKar5T76mmII8D';
  if (!/^tbl[A-Za-z0-9]+$/.test(id)) throw new Error('TEABLE_TABLE_ID 配置有误');
  return `/api/table/${id}${suffix}`;
}

async function teable(env, path, options = {}) {
  if (!env.TEABLE_TOKEN) throw new Error('缺少 TEABLE_TOKEN Worker secret');
  const origin = (env.TEABLE_ORIGIN || 'https://app.teable.ai').replace(/\/$/, '');
  const res = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.TEABLE_TOKEN}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    // Do not pass upstream error bodies to an unauthenticated visitor.
    throw new HttpError(502, `Teable 请求失败（HTTP ${res.status}）`);
  }
  return res.json();
}

async function fieldId(env, path, name) {
  const fields = await teable(env, path);
  const field = fields.find((item) => item.name === name);
  if (!field) throw new Error(`Teable 表缺少 ${name} 字段`);
  return field.id;
}

async function filteredRows(env, path, fieldId, value, userId, maxPages = MAX_PAGES) {
  const filter = JSON.stringify({ conjunction: 'and', filterSet: [
    { fieldId, operator: 'is', value },
  ] });
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const query = new URLSearchParams({ filter, take: String(PAGE_SIZE), skip: String(page * PAGE_SIZE), fieldKeyType: 'name' });
    const body = await teable(env, `${path}/record?${query}`);
    if (!body || !Array.isArray(body.records)) throw new Error('Teable 返回的记录格式有误');
    // Validate ownership again even though Teable applied a filter.
    const rows = body.records.filter((row) => row.fields && row.fields['用户ID'] === userId &&
      (value === userId || row.fields['记录ID'] === value));
    all.push(...rows);
    if (body.records.length < PAGE_SIZE) return all;
  }
  throw new HttpError(413, '该 ID 的记录超过当前同步上限，请联系站点管理员');
}

async function recordsForUser(env, userId) {
  const id = await fieldId(env, teablePath(env, '/field'), '用户ID');
  return filteredRows(env, teablePath(env, ''), id, userId, userId);
}

async function userRow(env, userId) {
  const id = await fieldId(env, teablePath(env, '/field'), '记录ID');
  const rows = await filteredRows(env, teablePath(env, ''), id, `${userId}:account`, userId, 1);
  if (rows.length > 1) throw new Error('Teable 用户 ID 重复');
  return rows[0] || null;
}

const encoder = new TextEncoder();
function b64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function unb64(value) {
  try {
    const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  } catch { return new Uint8Array(); }
}
function randomSalt() { return b64(crypto.getRandomValues(new Uint8Array(16))); }

async function authKey(env) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error('缺少足够长的 AUTH_SECRET Worker secret');
  return crypto.subtle.importKey('raw', encoder.encode(env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(env, message) {
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', await authKey(env), encoder.encode(message))));
}

async function verify(env, message, signature) {
  const bytes = unb64(signature);
  if (bytes.length !== 32) return false;
  return crypto.subtle.verify('HMAC', await authKey(env), bytes, encoder.encode(message));
}

async function sessionToken(env, userId) {
  const expires = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const nonce = randomSalt();
  const payload = `${userId}.${expires}.${nonce}`;
  return `${payload}.${await sign(env, `session:${payload}`)}`;
}

async function sessionUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) throw new HttpError(401, '请先登录');
  const token = header.slice(7);
  const parts = token.split('.');
  if (parts.length !== 4 || !USER_ID.test(parts[0]) || !/^\d{10}$/.test(parts[1])) {
    throw new HttpError(401, '登录已失效，请重新登录');
  }
  if (Number(parts[1]) <= Math.floor(Date.now() / 1000)) throw new HttpError(401, '登录已过期，请重新登录');
  const payload = parts.slice(0, 3).join('.');
  if (!(await verify(env, `session:${payload}`, parts[3]))) throw new HttpError(401, '登录已失效，请重新登录');
  return parts[0];
}

async function authRate(request, env, userId) {
  if (!env.AUTH_RATE) throw new Error('缺少 AUTH_RATE 速率限制绑定');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const a = await env.AUTH_RATE.limit({ key: `id:${userId}` });
  const b = await env.AUTH_RATE.limit({ key: `ip:${ip}` });
  if (!a.success || !b.success) throw new HttpError(429, '尝试过于频繁，请稍后再试');
}

function parseDate(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function cleanText(value, max = 100) {
  if (value == null) return null;
  return String(value).slice(0, max);
}

function cleanCount(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 10000) throw new HttpError(400, '胜负场数不合法');
  return n;
}

function entryToFields(userId, entry, playerName) {
  if (!entry || typeof entry !== 'object' || !ENTRY_ID.test(entry.id || '') || entry.id === 'account') {
    throw new HttpError(400, '存在无效的记录 ID');
  }
  const time = entry.time == null ? null : parseDate(entry.time);
  if (entry.time != null && !time) throw new HttpError(400, '存在无效的对局时间');
  const modified = Number(entry.updatedAt);
  const modifiedAt = Number.isFinite(modified) && modified > 0
    ? parseDate(modified) : time;
  const wins = cleanCount(entry.deltaWins);
  const losses = cleanCount(entry.deltaLosses);
  const result = entry.result === 'win' || entry.result === '胜' ? '胜'
    : entry.result === 'loss' || entry.result === '负' ? '负'
      : wins > 0 && !losses ? '胜' : losses > 0 && !wins ? '负' : null;
  const firstMove = entry.firstMove === 'first' || entry.firstMove === '先手' ? '先手'
    : entry.firstMove === 'second' || entry.firstMove === '后手' ? '后手' : null;
  return {
    '记录ID': `${userId}:${entry.id}`,
    '用户ID': userId,
    '对局时间': time,
    '玩家昵称': cleanText(playerName, 50),
    '我的卡组ID': cleanText(entry.deckId, 80),
    '我的卡组': cleanText(entry.deckName, 100),
    '胜负': result,
    '先后手': firstMove,
    '对手卡组': cleanText(entry.opponentDeck, 100),
    '胜场数': wins,
    '负场数': losses,
    '最后修改时间': modifiedAt,
  };
}

function fieldsToEntry(userId, fields) {
  const composite = fields['记录ID'];
  if (typeof composite !== 'string' || !composite.startsWith(`${userId}:`)) return null;
  const id = composite.slice(userId.length + 1);
  if (!ENTRY_ID.test(id) || id === 'account') return null;
  const entry = {
    id,
    deckId: fields['我的卡组ID'] || null,
    deckName: fields['我的卡组'] || '',
    time: fields['对局时间'] || null,
    deltaWins: fields['胜场数'] ?? 0,
    deltaLosses: fields['负场数'] ?? 0,
    updatedAt: Date.parse(fields['最后修改时间']) || Date.parse(fields['对局时间']) || 0,
  };
  if (fields['胜负'] === '胜') entry.result = 'win';
  if (fields['胜负'] === '负') entry.result = 'loss';
  if (fields['先后手'] === '先手') entry.firstMove = 'first';
  if (fields['先后手'] === '后手') entry.firstMove = 'second';
  if (fields['对手卡组']) entry.opponentDeck = fields['对手卡组'];
  return { entry, playerName: fields['玩家昵称'] || '' };
}

// 删除标记使用独立记录行，无需在现有 Teable 表增加字段。
function fieldsToDeletion(userId, fields) {
  const prefix = `${userId}:deleted:`;
  const composite = fields['记录ID'];
  if (typeof composite !== 'string' || !composite.startsWith(prefix)) return null;
  const id = composite.slice(prefix.length);
  if (!ENTRY_ID.test(id) || id === 'account') return null;
  const deletedAt = Date.parse(fields['最后修改时间']);
  return { id, deletedAt: Number.isFinite(deletedAt) ? deletedAt : 0 };
}

function deletionToFields(userId, item) {
  if (!item || !ENTRY_ID.test(item.id || '') || item.id === 'account') {
    throw new HttpError(400, '存在无效的删除记录 ID');
  }
  const deletedAt = parseDate(item.deletedAt);
  if (!deletedAt) throw new HttpError(400, '删除时间不合法');
  return {
    '记录ID': `${userId}:deleted:${item.id}`,
    '用户ID': userId,
    '最后修改时间': deletedAt,
  };
}

async function readBody(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, '单次上传数据过大');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new HttpError(413, '单次上传数据过大');
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'JSON 格式有误'); }
}

async function rateLimit(request, env, userId, write) {
  const binding = write ? env.WRITE_RATE : env.READ_RATE;
  if (!binding) throw new Error('缺少 Cloudflare 速率限制绑定');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const byId = await binding.limit({ key: `id:${userId}` });
  const byIp = await binding.limit({ key: `ip:${ip}` });
  if (!byId.success || !byIp.success) throw new HttpError(429, '请求过于频繁，请稍后重试');
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === 'OPTIONS') {
      return origin ? response({}, 204, origin) : response({ error: '来源不允许' }, 403);
    }
    if (request.headers.has('Origin') && !origin) return response({ error: '来源不允许' }, 403);
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/auth/salt' && request.method === 'GET') {
        const userId = validUserId(url.searchParams.get('userId'));
        await authRate(request, env, userId);
        const row = await userRow(env, userId);
        const fallback = b64(unb64(await sign(env, `missing-salt:${userId}`)).slice(0, 16));
        return response({ salt: row?.fields?.['密码盐'] || fallback }, 200, origin);
      }
      if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        if (!origin) throw new HttpError(403, '仅允许从本站注册');
        const body = await readBody(request);
        const userId = validUserId(body.userId);
        if (!SALT.test(body.salt || '') || !PROOF.test(body.proof || '')) throw new HttpError(400, '密码校验数据格式有误');
        await authRate(request, env, userId);
        if (await userRow(env, userId)) throw new HttpError(409, '这个用户 ID 已被使用');
        const verifier = await sign(env, `password:${body.proof}`);
        await teable(env, teablePath(env, '/record'), { method: 'POST', body: JSON.stringify({ records: [{ fields: {
          '记录ID': `${userId}:account`,
          '用户ID': userId,
          '密码盐': body.salt,
          '密码校验值': verifier,
          '最后修改时间': new Date().toISOString(),
        } }] }) });
        return response({ userId, token: await sessionToken(env, userId) }, 201, origin);
      }
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        if (!origin) throw new HttpError(403, '仅允许从本站登录');
        const body = await readBody(request);
        const userId = validUserId(body.userId);
        if (!PROOF.test(body.proof || '')) throw new HttpError(400, '密码校验数据格式有误');
        await authRate(request, env, userId);
        const row = await userRow(env, userId);
        const valid = row && await verify(env, `password:${body.proof}`, row.fields['密码校验值'] || '');
        if (!valid) throw new HttpError(401, '用户 ID 或密码错误');
        return response({ userId, token: await sessionToken(env, userId) }, 200, origin);
      }
      if (url.pathname === '/api/records' && request.method === 'GET') {
        const userId = await sessionUser(request, env);
        await rateLimit(request, env, userId, false);
        const rows = await recordsForUser(env, userId);
        const deleted = rows.map((row) => fieldsToDeletion(userId, row.fields)).filter(Boolean);
        const deletedIds = new Set(deleted.map((item) => item.id));
        const parsed = rows.map((row) => fieldsToEntry(userId, row.fields)).filter(Boolean);
        return response({ userId, playerName: parsed.find((x) => x.playerName)?.playerName || '',
          records: parsed.map((x) => x.entry).filter((entry) => !deletedIds.has(entry.id)), deleted }, 200, origin);
      }
      if (url.pathname === '/api/records/upload' && request.method === 'POST') {
        if (!origin) throw new HttpError(403, '仅允许从本站上传');
        const userId = await sessionUser(request, env);
        const body = await readBody(request);
        if (body.userId && validUserId(body.userId) !== userId) throw new HttpError(403, '不能上传到其他用户 ID');
        const deleted = body.deleted || [];
        if (!Array.isArray(body.records) || !Array.isArray(deleted) || body.records.length + deleted.length > MAX_BATCH) {
          throw new HttpError(400, `每次只能上传 0–${MAX_BATCH} 条记录或删除标记`);
        }
        await rateLimit(request, env, userId, true);
        const desired = body.records.map((entry) => entryToFields(userId, entry, body.playerName));
        const removals = deleted.map((item) => deletionToFields(userId, item));
        const allIds = [...desired, ...removals].map((fields) => fields['记录ID']);
        if (new Set(allIds).size !== allIds.length) {
          throw new HttpError(400, '单次上传含重复记录 ID');
        }
        if (deleted.some((item) => body.records.some((entry) => entry.id === item.id))) {
          throw new HttpError(400, '同一条记录不能同时上传和删除');
        }
        const existing = new Map((await recordsForUser(env, userId)).map((row) => [row.fields['记录ID'], row]));
        const creations = [];
        let updated = 0, skipped = 0;
        for (const fields of desired) {
          const entryId = fields['记录ID'].slice(userId.length + 1);
          if (existing.has(`${userId}:deleted:${entryId}`) || removals.some((item) => item['记录ID'] === `${userId}:deleted:${entryId}`)) {
            skipped++; continue;
          }
          const row = existing.get(fields['记录ID']);
          if (!row) { creations.push({ fields }); continue; }
          const oldStamp = Date.parse(row.fields['最后修改时间']) || 0;
          const newStamp = Date.parse(fields['最后修改时间']) || 0;
          if (newStamp <= oldStamp) { skipped++; continue; }
          await teable(env, teablePath(env, `/record/${encodeURIComponent(row.id)}`), {
            method: 'PATCH', body: JSON.stringify({ record: { fields } }),
          });
          updated++;
        }
        for (const fields of removals) {
          if (existing.has(fields['记录ID'])) { skipped++; continue; }
          creations.push({ fields });
        }
        if (creations.length) {
          await teable(env, teablePath(env, '/record'), {
            method: 'POST', body: JSON.stringify({ records: creations }),
          });
        }
        return response({ created: creations.length, updated, skipped }, 200, origin);
      }
      return response({ error: '接口不存在' }, 404, origin);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Cloud bridge error:', error);
      return response({ error: error instanceof HttpError ? error.message : '服务器暂时不可用' }, error instanceof HttpError ? error.status : 500, origin);
    }
  },
};
