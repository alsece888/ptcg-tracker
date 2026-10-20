# 云端战绩状态（2026-10-21）

## 已确认

- 网站由 GitHub Pages 托管，用户有 Cloudflare 账号。Teable 现有战绩表为 `tblvmcKar5T76mmII8D`。
- 用户最终选择“ID 加密码”，且明确要求账号信息放在**同一张战绩表**，不新建用户表。
- 旧数据只从用户当前浏览器的 `matchHistory` 上传；下载目录的 JSON 仅用于本地测试，不写入真实 Teable。

## 本地实现与验证

- `index.html`、`style.css`、`cloud.js`：注册、登录、手动上传和读取界面。`cloud-config.js` 已写入 Worker 地址；提交 `bfd4f94` 已推送到 `main`，线上 `index.html`、`cloud.js`、`cloud-config.js` 均返回 200，页面包含云端模块。
- `cloud/worker.mjs`：一张表中使用 `用户ID:account` 行保存盐和密码校验值，普通战绩行保存历史。Worker 校验密码、签发会话并按 ID 过滤。
- `teable/add-auth-fields.mjs`：已给真实表添加两个账号字段，重新读取核对 14/14 个字段类型匹配。
- `cloud/worker.test.mjs`：模拟 Teable 验证隔离、去重、更新、非法请求；本地 216 条样本上传并读回 216 条，其中账号行不出现在战绩结果。
- Cloudflare Worker 已部署到 `https://ptcg-teable-bridge.cxdalsece.workers.dev`，`TEABLE_TOKEN` 和 `AUTH_SECRET` 已存为 Worker secret。线上只读检查：取盐 200、未登录读取 401、非本站来源 403、预检 204。
- 真实 Teable 字段再次核对：`记录ID` 类型为单行文本且唯一、必填；`用户ID` 必填；密码盐和校验值为可空单行文本。

## 还需完成

1. 用真实使用者的 ID 验证注册、错误密码、上传与跨浏览器读取。当前未创建测试账号，以免在没有清理权限时留下测试记录。自动审批拒绝了 DELETE 权限探测，理由是未经验证的记录 ID 可能误删。
2. 真实联调通过后，通知旧用户在有历史的浏览器中上传。

当前是手动同步；删除对局不传播到云端，好友列表、卡组图标和草稿不随战绩恢复。本机 `npx` 启动脚本路径曾异常，部署时需检查或使用 Cloudflare 控制台。
