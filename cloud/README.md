# Teable 云端战绩

网页托管在 GitHub Pages；Cloudflare Worker 保存 Teable API 令牌、验证用户 ID 和密码，并按登录身份读写对局记录。**所有数据使用现有的 `PTCG 胜负记录` 表，不新建用户表。**

## 用户操作

1. 老用户在存有历史记录的浏览器中，设置唯一用户 ID 和至少 10 位密码，点击“注册 ID”。登录后会自动上传本机历史记录。
2. 换电脑后输入同一 ID 和密码，点击“登录”；已有战绩会自动读取。
3. 保持网页打开且登录时，新增、修改或删除对局会在保存后自动同步；其他电脑在打开页面、回到页面时及约 30 秒一次读取更新。离线保存会在恢复连接后重试。两个按钮仍可用于立即同步或仅从云端读取。
4. 密码丢失后暂无找回功能；关闭浏览器后需要重新登录。

## 单表结构

现有表已经有 `记录ID`、`用户ID` 等 12 个战绩字段。运行 `teable/add-auth-fields.mjs` 后再增加两个可空文本字段：`密码盐`、`密码校验值`。每位用户占一条账号行，`记录ID = 用户ID:account`，只在这条行填写密码相关字段；普通战绩行 `记录ID = 用户ID:本地记录ID`，密码字段留空。删除标记也使用同一张表，`记录ID = 用户ID:deleted:本地记录ID`，并在 `最后修改时间` 写入删除时间；无需新增字段。网页读取时会排除账号行和被删除的战绩行。

密码明文不保存到 Teable。`密码校验值` 是浏览器用随机盐和 PBKDF2-HMAC-SHA-256（600,000 次）得到的派生值，再由 Worker 使用 `AUTH_SECRET` 签名后的结果。不要把 Teable 表公开分享；有表管理权限的人仍可看到盐和校验值。

## 已部署实例

现有 Worker 地址为 `https://ptcg-teable-bridge.cxdalsece.workers.dev`。2026-10-21 已设置两个 secret，线上只读检查通过。网页地址已写入 `cloud-config.js`，GitHub Pages 已发布新页面和脚本。

有用户报告另一台电脑无法打开 `workers.dev` 地址。为此增加了 [Pages 转发入口](pages-proxy/) `https://ptcg-sync-gateway.pages.dev`，它通过 Cloudflare Service binding 调用现有 Worker，已验证账号查询和 CORS 正常。用户已确认另一台电脑能打开这个地址；网页的 `cloud-config.js` 已切到 Pages 入口，因此无须更改 DNS。主站仍由 GitHub Pages 托管。

## 重新部署

1. 在 [Teable 个人访问令牌页面](https://app.teable.ai/setting/personal-access-token)创建仅限该项目的令牌，授权读取和创建字段、读取/创建/更新记录。把令牌保存在仓库外的本机文件，绝不能写进网页、仓库或聊天。
2. 在仓库根目录设置 `TEABLE_TOKEN_FILE=<令牌文件路径>`，运行 `node teable/add-auth-fields.mjs`。脚本先检查已有字段，只添加缺失的两个字段，再重新读取核对。可先运行 `node teable/add-auth-fields.mjs --dry-run` 查看目标。
3. 在 `cloud/` 目录部署 `worker.mjs`：`npx wrangler login`、`npx wrangler deploy`。在 Worker Secrets 中设置 `TEABLE_TOKEN`（同一令牌）与 `AUTH_SECRET`（随机生成、至少 32 字节的密钥）。不要把 secret 写进 `wrangler.jsonc` 的 `vars`。
4. 将得到的 HTTPS Worker 地址写入 [cloud-config.js](../cloud-config.js)，发布 GitHub Pages。测试账号注册、错误密码、上传、重复上传和换浏览器读取后再让旧用户上传。

Worker 只允许 `https://malo-ptcg.cn` 和 `https://www.malo-ptcg.cn` 发起浏览器请求。登录接口有速率限制；登录成功的签名会话保存在当前标签页，12 小时到期。记录按账号 ID 隔离，不能靠修改请求中的 ID 读取其他人的记录。

## 当前同步范围

- 每次上传最多 10 条记录或删除标记，网页自动分批；读取每页 100 条。重复上传跳过未更新的记录，更新过的同 ID 记录会覆盖云端版本。
- 读取时按记录 ID 和最后修改时间合并到本机，不覆盖本机独有记录。云端保存对局历史及删除标记，不同步好友列表、卡组图标和草稿。
- 同一条对局在两台电脑同时编辑时，修改时间较新的版本优先；设备系统时间明显错误会影响这个判断。请定期使用网页的“导出全部数据”备份。
- 仓库测试使用模拟 Teable；正式部署后还需用测试账号进行真实联调。
