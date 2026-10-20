import { readFile } from 'node:fs/promises';

const tableId = process.env.TEABLE_TABLE_ID || 'tblvmcKar5T76mmII8D';
const origin = (process.env.TEABLE_API_ORIGIN || 'https://app.teable.ai').replace(/\/$/, '');
const token = process.env.TEABLE_TOKEN || (process.env.TEABLE_TOKEN_FILE
  ? (await readFile(process.env.TEABLE_TOKEN_FILE, 'utf8')).trim() : '');
if (!token || !/^tbl[A-Za-z0-9]+$/.test(tableId) || !/^https:\/\//.test(origin)) {
  throw new Error('请提供 TEABLE_TOKEN_FILE、有效表 ID 和 HTTPS 地址');
}
const url = `${origin}/api/table/${tableId}/field`;
async function fields(options = {}) {
  const result = await fetch(url, { ...options, headers: {
    Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  } });
  if (!result.ok) throw new Error(`Teable 字段请求失败（HTTP ${result.status}）`);
  return result.json();
}
let list = await fields();
const existing = list.find((field) => field.name === '同步资料');
if (existing && existing.type !== 'longText') throw new Error('同步资料字段类型不正确');
if (!existing) {
  await fields({ method: 'POST', body: JSON.stringify({ name: '同步资料', type: 'longText' }) });
  list = await fields();
  console.log('已添加同步资料字段');
}
if (!list.some((field) => field.name === '同步资料' && field.type === 'longText')) {
  throw new Error('未能验证同步资料字段');
}
console.log(`已验证同步资料字段：${tableId}`);
