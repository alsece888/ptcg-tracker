# Teable 胜负记录表

现有 [PTCG 胜负记录](https://app.teable.ai/base/bsetDUa7U6I8cZqJF4F/table/tblvmcKar5T76mmII8D/viwruIJ49rsMe3CPzRk) 表 ID 为 `tblvmcKar5T76mmII8D`。2026-10-21 已补充 `密码盐`、`密码校验值`、`同步资料`，并读取核对同步资料字段的类型。

## 字段映射

| Teable 字段 | 来源或用途 |
| --- | --- |
| 记录ID | 战绩行：`用户ID:本地记录ID`；账号行：`用户ID:account`；资料行：`用户ID:profile`。全表唯一 |
| 用户ID | 用户自设 ID，区分不同用户 |
| 对局时间 | `matchHistory[].time` |
| 玩家昵称 | `personal.playerName` |
| 我的卡组ID、我的卡组 | `deckId`、`deckName` |
| 胜负 | `result`；混合或无法确定时留空 |
| 先后手 | `firstMove` |
| 对手卡组 | `opponentDeck` |
| 胜场数、负场数 | `deltaWins`、`deltaLosses`，保留旧记录的多局数据 |
| 最后修改时间 | `updatedAt`，用于比较版本 |
| 密码盐、密码校验值 | 仅账号行填写；不保存密码明文 |
| 同步资料 | 仅资料行填写，保存我的卡组、关注玩家 ID、卡组图鉴及删除标记 |

## 给现有表补字段

在 [Teable 个人访问令牌页面](https://app.teable.ai/setting/personal-access-token)创建限权令牌，授权读取和创建字段，以及后续 Worker 读写记录。将令牌存到仓库外的本机文件，设置 `TEABLE_TOKEN_FILE` 指向文件后运行：

```powershell
node teable/add-auth-fields.mjs --dry-run
node teable/add-sync-field.mjs
node teable/add-auth-fields.mjs
```

脚本只处理表 ID `tblvmcKar5T76mmII8D`，已存在且类型正确的字段会跳过，结束时重新核对。令牌不应写进网页或 Git。建新数据库时可用 `teable/create-table.mjs` 和 `match-records.schema.json` 创建完整 15 字段表；当前项目无需建新表。

网页、Worker 和部署操作见 [cloud/README.md](../cloud/README.md)。
