import { readFile } from 'node:fs/promises';

const schema = JSON.parse(await readFile(new URL('./match-records.schema.json', import.meta.url), 'utf8'));
function verifyFields(fields) {
  const actual = new Map(fields.map((field) => [field.name, field]));
  const missing = schema.fields.filter((field) => !actual.has(field.name));
  const wrongType = schema.fields.filter((field) => actual.has(field.name) && actual.get(field.name).type !== field.type);
  if (missing.length || wrongType.length) {
    const issues = [
      ...missing.map((field) => `缺少 ${field.name}`),
      ...wrongType.map((field) => `${field.name} 类型应为 ${field.type}，实际为 ${actual.get(field.name).type}`),
    ];
    throw new Error(`表字段检查失败：${issues.join('；')}`);
  }
  return `${schema.fields.length}/${schema.fields.length}，表内总字段 ${fields.length}`;
}

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(schema, null, 2));
  process.exit(0);
}

const token = process.env.TEABLE_TOKEN || (process.env.TEABLE_TOKEN_FILE
  ? (await readFile(process.env.TEABLE_TOKEN_FILE, 'utf8')).trim()
  : '');
const baseId = process.env.TEABLE_BASE_ID;
const origin = (process.env.TEABLE_API_ORIGIN || 'https://app.teable.ai').replace(/\/$/, '');

if (!token || !baseId) {
  console.error('缺少 TEABLE_TOKEN（或 TEABLE_TOKEN_FILE）或 TEABLE_BASE_ID。详见 teable/README.md。');
  process.exit(1);
}
if (!/^https:\/\//.test(origin) || !/^bse[A-Za-z0-9]+$/.test(baseId)) {
  console.error('TEABLE_API_ORIGIN 必须是 HTTPS 地址，TEABLE_BASE_ID 必须是 bse 开头的数据库 ID。');
  process.exit(1);
}

async function teable(path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Teable HTTP ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : null;
}

const basePath = `/api/base/${encodeURIComponent(baseId)}/table`;
const tables = await teable(basePath);
const existing = tables.find((table) => table.name === schema.name);

if (existing) {
  const fields = await teable(`/api/table/${encodeURIComponent(existing.id)}/field`);
  console.log(`表已存在且字段齐全：${schema.name} (${existing.id})，字段 ${verifyFields(fields)}`);
  console.log(`${origin}/base/${baseId}/table/${existing.id}`);
  process.exit(0);
}

const created = await teable(`${basePath}/`, {
  method: 'POST',
  body: JSON.stringify(schema),
});
const fieldCount = verifyFields(created.fields || []);
console.log(`已创建表：${created.name} (${created.id})，字段 ${fieldCount}`);
console.log(`${origin}/base/${baseId}/table/${created.id}${created.defaultViewId ? `/${created.defaultViewId}` : ''}`);
