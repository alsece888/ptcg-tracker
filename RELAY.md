# 数据中转说明（为什么需要它 / 怎么自建）

## 为什么需要中转

本工具的数据来自小天冠山排位赛 API（`https://ptcg.mivm.cn/api/...`）。
该接口**没有返回 CORS 响应头**，所以网页里的 JS 无法直接读取它的内容（跨域限制），
必须经过一个「中转」（CORS proxy）代取，网页再去读中转的返回。

## 当前默认中转与失效记录

2026-09 之前用的三个公共中转**全部失效**了，这就是「突然获取不到战绩」的原因：

| 中转 | 状态 |
| --- | --- |
| `proxy.cors.sh` | 域名已注销，DNS 解析失败 |
| `corsproxy.io` | 改为必须申请 API Key，未带 Key 返回 401 |
| `api.allorigins.win` | Cloudflare 520，服务不可用 |

现在的默认顺序（在「⋮ → 数据中转」里可以一键检测）：

1. `cors.isteed.cc` — 国内社区维护，实测可用，且能正确透传 404
2. `cors-get-proxy.sirjosh.workers.dev` — 公共 Workers 中转
3. `cors.eu.org`
4. `api.codetabs.com/v1/proxy`
5. `api.allorigins.win`

公共中转是「别人免费提供的服务」，随时可能限流或停服。长期使用建议自己部署一个中转：
免费、稳定、只有你自己用（见下）。

## 自建中转（Cloudflare Worker，免费，约 5 分钟）

1. 打开 https://dash.cloudflare.com/ 注册/登录，进入 **Workers & Pages → Create → Worker**。
2. 把默认代码整段替换成下面这段，然后 **Deploy**：

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url') || url.pathname.slice(1) + url.search;
    if (!target) {
      return new Response(JSON.stringify({ usage: 'https://你的worker域名/?url=<目标地址>' }), {
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }
    // 只允许转发到小天冠山 API，避免被人当成任意代理滥用（可按需调整）
    if (!target.startsWith('https://ptcg.mivm.cn/')) {
      return new Response('target not allowed', { status: 403 });
    }
    const upstream = await fetch(target, { headers: { 'user-agent': 'malo-ptcg-relay' } });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status, // 404 也会原样透传，工具据此判断「玩家不存在」
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    });
  },
};
```

3. 部署后会得到一个地址，形如 `https://xxxx.your-name.workers.dev`。
4. 回到本工具 →「⋮ → 数据中转」→ 在输入框里填这个地址 → 保存。
   工具会自动拼成 `https://xxxx.workers.dev/?url=<目标地址>`，并优先使用它。

如果你的中转是别的拼接方式，可以直接写 `{url}` 占位符，例如
`https://你的域名/proxy?target={url}`。

补充：`*.workers.dev` 在某些网络下访问不稳定，可给 Worker 绑定自己的域名
（例如 `api.malo-ptcg.cn`），连通性会更好。

## 常见疑问

- **为什么不把 API 数据直接抓下来放在本站？** 排行榜可以，但单个玩家的数据是按昵称按需查询的，
  静态文件无法覆盖，所以仍然需要中转。
- **检测显示全部不可用怎么办？** 说明公共中转当前都不通，此时只有自建中转能救急。
  可以先用浏览器 F12 控制台打开
  `https://ptcg.mivm.cn/api/rank/player/query?screen_name=你的昵称` 确认上游本身正常
  （多数情况下它是正常的，问题只在中转）。
- **中转会不会泄露数据？** 请求里只有游戏昵称这种公开信息，不含账号密码。介意的话就自建。
