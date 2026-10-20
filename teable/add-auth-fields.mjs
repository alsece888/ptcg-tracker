import { readFile } from 'node:fs/promises';

const schema = JSON.parse(await readFile(new URL('./match-records.schema.json', import.meta.url), 'utf8'));
const tableId = process.env.TEABLE_TABLE_ID || 'tblvmcKar5T76mmII8D';
const origin = (process.env.TEABLE_API_ORIGIN || 'https://app.teable.ai').replace(/\/$/, '');
const required = schema.fields.filter((field) => field.name === '密码盐' || field.name === '密码校验值');
if (process.argv.includes('--dry-run')) {
  console.log(`目标表 ${tableId}；将检查并补充字段：${required.map((field) => field.name).join('、')}`);
  process.exit(0);
}
const token = process.env.TEABLE_TOKEN || (process.env.TEABLE_TOKEN_FILE
  ? (await readFile(process.env.TEABLE_TOKEN_FILE, 'utf8')).trim() : '');
if (!token || !/^tbl[A-Za-z0-9]+$/.test(tableId) || !/^https:\/\//.test(origin)) {
  throw new Error('请设置 TEABLE_TOKEN_FILE（或 TEABLE_TOKEN）；表 ID 应以 tbl 开头，Teable 地址必须为 HTTPS');
}

const path = `/api/table/${tableId}/field`;
async function teable(options = {}) {
  const result = await fetch(`${origin}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!result.ok) throw new Error(`Teable 字段请求失败（HTTP ${result.status}）`);
  return result.json();
}

let fields = await teable();
for (const { name, type } of required) {
  const existing = fields.find((field) => field.name === name);
  if (existing) {
    if (existing.type !== type) throw new Error(`已有字段「${name}」类型应为 ${type}`);
    console.log(`已存在：${name}`);
    continue;
  }
  await teable({ method: 'POST', body: JSON.stringify({ name, type }) });
  console.log(`已添加：${name}`);
  fields = await teable();
}
const finalFields = await teable();
for (const { name, type } of schema.fields) {
  if (!finalFields.some((field) => field.name === name && field.type === type)) {
    throw new Error(`未能验证字段「${name}」及类型 ${type}`);
  }
}
console.log(`表字段已核对：${schema.fields.length}/${schema.fields.length}`);
