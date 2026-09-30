# 数据中转说明（为什么需要它 / 怎么自建）

## 为什么需要中转

本工具的数据来自小天冠山排位赛 API（`https://ptcg.mivm.cn/api/...`）。
该接口**没有返回 CORS 响应头**，所以网页里的 JS 无法直接读取它的内容（跨域限制），
必须经过一个「中转」（CORS proxy）代取，网页再去读中转的返回。

## 当前中转与实测记录

2026-09 之前用的三个公共中转**全部失效**了，这就是「突然获取不到战绩」的原因：
`proxy.cors.sh` 域名注销、`corsproxy.io` 改为必须 API Key、`api.allorigins.win` Cloudflare 520。

2026-09-29 又整体实测了一遍：

| 中转 | 状态 | 备注 |
| --- | --- | --- |
| `cors.isteed.cc` | ✅ 可用 | 1 秒左右返回，且原样透传 404（首选） |
| `cors-get-proxy.sirjosh.workers.dev` | ✅ 可用 | 404 被抹成 200 + 空响应，工具侧已兼容 |
| `r.jina.ai` | ✅ 可用 | 返回带 `Title / URL Source / Markdown Content` 前缀的纯文本，脚本会剥壳后再解析 |
| `cors.eu.org` | ✕ 429 | 限流；响应不带 CORS 头，浏览器里只会显示 `Failed to fetch` |
| `api.codetabs.com` | ✕ 503 | 服务异常 |
| `api.allorigins.win` | ✕ 522 | Cloudflare 源站不可达 |

**取数策略：并发竞速。** 每批最多 2 个中转同时发请求，谁先给出可用数据就用谁，
其余请求立刻中断；整批都失败才换下一批。所以单个中转挂掉或变慢不会再拖垮体验，
也不会像以前那样「一个超时等 12 秒、五个轮流等一分钟」。上次成功的中转会记在
`localStorage['ptcg-relay-ok']` 里，下次优先试它；自建中转永远排第一。

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
- **检测说「有中转可用」，但获取战绩还是失败？** 先重新点一次「获取战绩」试一下
  （上游偶发抖动）。如果稳定复现，多半是**浏览器的网络出口和命令行不一致**：
  浏览器走了代理/VPN，或装了广告拦截类扩展挡掉 `*.workers.dev`、`cors.isteed.cc`
  这类域名。可以用无痕窗口（默认禁用扩展）或换个浏览器再试；命令行能连上、
  浏览器连不上，基本就是这个原因。
- **中转会不会泄露数据？** 请求里只有游戏昵称这种公开信息，不含账号密码。介意的话就自建。

## 组卡页的卡图（已不依赖任何接口）

卡图以前是「先调 tcg.mik.moe 的卡组接口拿到中文版 set 编号，再拼图片地址」，
所以接口一挂就整页没图。现在改成纯离线推导：

1. 从卡组代码里直接取「英文 set 缩写 + 编号」（如 `3 Charmander PAF 7`）；
2. 用打包在本仓库的离线映射表 `card-sets.js`（三字母缩写 → 官方 set ID，
   数据取自 pokemontcg.io 的公开 set 列表）拼出 `images.pokemontcg.io/{setId}/{编号}.png`；
3. 浏览器按「候选地址链」依次尝试（中文版图床 → 公开 CDN 的 png → hires → 英文版图床），
   命中后把该模式记在本地，后续卡牌优先用它，全部失败才退化成文字卡片。

因此即使第三方卡组接口不可用、中转不可用，组卡页依然有图（卡面为英文版，图案相同）。
如要换图床，可在浏览器里设置 `localStorage['ptcg-img-base']` 为你的图床前缀。
