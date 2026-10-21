// ============================================================
// PTCG 玩家追踪器 - 纯前端版
// 数据保存在 localStorage，API 通过 CORS 代理调用
// ============================================================

const PTCG_BASE = 'https://ptcg.mivm.cn';
// ============================================================
// CORS 中转（浏览器直连上游 API 会被 CORS 拦截，只能走中转）
// 「连得通」和「状态码透传正确」是两回事，2026-09-29 实测结果：
//   cors.isteed.cc           可用，且原样透传 404（首选）
//   cors-get-proxy.sirjosh…  可用，但 404 被抹成 200 + 空响应
//   r.jina.ai                可用，返回带前缀的纯文本，需要剥壳
//   cors.eu.org              429 限流（无 CORS 头，浏览器只会报 Failed to fetch）
//   api.codetabs.com         503 / 超时
//   api.allorigins.win       522
// 策略：每批并发竞速，谁先给出可用数据就用谁，其余请求立刻中断；整批都失败才换下一批。
// 可在「⋮ → 数据中转」里检测可用性，或填入自建中转地址（见 RELAY.md）。
// ============================================================
const RELAY_STORAGE_KEY = 'ptcg-relay-url'; // 用户自建的中转地址
const RELAY_OK_KEY = 'ptcg-relay-ok';       // 上次成功的中转 id（下次优先用它）

// r.jina.ai 会把内容包成 "Title: … / URL Source: … / Markdown Content: <原文>" 的纯文本
function unwrapJina(text) {
  const start = text.search(/[[{]/);
  if (start < 0) return '';
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
  return end > start ? text.slice(start, end + 1) : '';
}

const CORS_PROXIES = [
  { id: 'isteed', name: 'cors.isteed.cc', build: (url) => `https://cors.isteed.cc/${url}` },
  { id: 'sirjosh', name: 'workers.dev 中转', build: (url) => `https://cors-get-proxy.sirjosh.workers.dev/?url=${encodeURIComponent(url)}` },
  { id: 'jina', name: 'r.jina.ai', build: (url) => `https://r.jina.ai/${url}`, unwrap: unwrapJina },
  { id: 'cors-eu', name: 'cors.eu.org', build: (url) => `https://cors.eu.org/${url}` },
  { id: 'codetabs', name: 'api.codetabs.com', build: (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}` },
  { id: 'allorigins', name: 'api.allorigins.win', build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
];
const RELAY_TIMEOUT_MS = 9000; // 单个中转的超时时间
// 每批并发几个中转：2 是「抗单点故障」和「别把公共中转请求量翻几倍」之间的折中
// （批量刷新战绩时本来就是 5 个玩家并发，每批开得越多越容易被限流）
const RELAY_WAVE_SIZE = 2;

// 自定义中转地址：填前缀（会自动拼完整 URL），或用 {url} 占位符
function getCustomRelay() {
  try { return (localStorage.getItem(RELAY_STORAGE_KEY) || '').trim(); } catch (e) { return ''; }
}

function buildCustomRelayUrl(template, targetUrl) {
  if (template.indexOf('{url}') !== -1) return template.replace('{url}', encodeURIComponent(targetUrl));
  return template.replace(/\/+$/, '') + '/' + targetUrl;
}

function activeProxies() {
  const custom = getCustomRelay();
  if (!custom) return CORS_PROXIES;
  return [{ id: 'custom', name: '自定义中转', build: (url) => buildCustomRelayUrl(custom, url) }].concat(CORS_PROXIES);
}

const STORAGE_KEY = 'ptcg-tracker-data';
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 分钟

// areazero.top 宝可梦角色图标 (卡组分类图标)
const DECK_ICONS = [
  { id: 'urshifu-gmax', name: '一击武道熊师', url: 'https://tcg.mik.moe/static/icon/urshifu-gmax.png' },
  { id: 'magneton', name: '三合一磁怪', url: 'https://tcg.mik.moe/static/icon/magneton.png' },
  { id: 'malamar', name: '乌贼王', url: 'https://tcg.mik.moe/static/icon/malamar.png' },
  { id: 'cinccino', name: '奇诺栗鼠', url: 'https://tcg.mik.moe/static/icon/cinccino.png' },
  { id: 'honchkrow', name: '乌鸦头头', url: 'https://tcg.mik.moe/static/icon/honchkrow.png' },
  { id: 'sylveon', name: '仙子伊布', url: 'https://tcg.mik.moe/static/icon/sylveon.png' },
  { id: 'yveltal', name: '伊裴尔塔尔', url: 'https://tcg.mik.moe/static/icon/yveltal.png' },
  { id: 'weezing-galar', name: '伽勒尔双弹瓦斯', url: 'https://tcg.mik.moe/static/icon/weezing-galar.png' },
  { id: 'slowking-galar', name: '伽勒尔呆呆王', url: 'https://tcg.mik.moe/static/icon/slowking-galar.png' },
  { id: 'moltres-galar', name: '伽勒尔火焰鸟', url: 'https://tcg.mik.moe/static/icon/moltres-galar.png' },
  { id: 'zapdos-galar', name: '伽勒尔闪电鸟', url: 'https://tcg.mik.moe/static/icon/zapdos-galar.png' },
  { id: 'glaceon', name: '冰伊布', url: 'https://tcg.mik.moe/static/icon/glaceon.png' },
  { id: 'sableye', name: '勾魂眼', url: 'https://tcg.mik.moe/static/icon/sableye.png' },
  { id: 'aerodactyl', name: '化石翼龙', url: 'https://tcg.mik.moe/static/icon/aerodactyl.png' },
  { id: 'inteleon', name: '千面避役', url: 'https://tcg.mik.moe/static/icon/inteleon.png' },
  { id: 'inteleon-gmax', name: '千面避役VMAX', url: 'https://tcg.mik.moe/static/icon/inteleon-gmax.png' },
  { id: 'tapu-koko', name: '卡璞・鸣鸣', url: 'https://tcg.mik.moe/static/icon/tapu-koko.png' },
  { id: 'crobat', name: '叉字蝠', url: 'https://tcg.mik.moe/static/icon/crobat.png' },
  { id: 'chien-pao', name: '古剑豹', url: 'https://tcg.mik.moe/static/icon/chien-pao.png' },
  { id: 'cramorant', name: '古月鸟', url: 'https://tcg.mik.moe/static/icon/cramorant.png' },
  { id: 'porygon-z', name: '多边兽Z', url: 'https://tcg.mik.moe/static/icon/porygon-z.png' },
  { id: 'leafeon', name: '叶伊布', url: 'https://tcg.mik.moe/static/icon/leafeon.png' },
  { id: 'shaymin-sky', name: '谢米', url: 'https://tcg.mik.moe/static/icon/shaymin-sky.png' },
  { id: 'trumbeak', name: '喇叭啄鸟', url: 'https://tcg.mik.moe/static/icon/trumbeak.png' },
  { id: 'charizard', name: '喷火龙', url: 'https://tcg.mik.moe/static/icon/charizard.png' },
  { id: 'braixen', name: '长尾火狐', url: 'https://tcg.mik.moe/static/icon/braixen.png' },
  { id: 'charizard-gmax', name: '喷火龙VMAX', url: 'https://tcg.mik.moe/static/icon/charizard-gmax.png' },
  { id: 'groudon', name: '固拉多', url: 'https://tcg.mik.moe/static/icon/groudon.png' },
  { id: 'obstagoon', name: '堵拦熊', url: 'https://tcg.mik.moe/static/icon/obstagoon.png' },
  { id: 'dragapult', name: '多龙巴鲁托', url: 'https://tcg.mik.moe/static/icon/dragapult.png' },
  { id: 'lickilicky', name: '大舌舔', url: 'https://tcg.mik.moe/static/icon/lickilicky.png' },
  { id: 'altaria', name: '七夕青鸟', url: 'https://tcg.mik.moe/static/icon/altaria.png' },
  { id: 'beedrill', name: '大针蜂', url: 'https://tcg.mik.moe/static/icon/beedrill.png' },
  { id: 'solrock', name: '太阳岩', url: 'https://tcg.mik.moe/static/icon/solrock.png' },
  { id: 'lunatone', name: '月石', url: 'https://tcg.mik.moe/static/icon/lunatone.png' },
  { id: 'archeops', name: '始祖大鸟', url: 'https://tcg.mik.moe/static/icon/archeops.png' },
  { id: 'coalossal', name: '巨炭山', url: 'https://tcg.mik.moe/static/icon/coalossal.png' },
  { id: 'stonjourner', name: '巨石丁', url: 'https://tcg.mik.moe/static/icon/stonjourner.png' },
  { id: 'metagross', name: '巨金怪', url: 'https://tcg.mik.moe/static/icon/metagross.png' },
  { id: 'granbull', name: '布鲁皇', url: 'https://tcg.mik.moe/static/icon/granbull.png' },
  { id: 'blissey', name: '幸福蛋', url: 'https://tcg.mik.moe/static/icon/blissey.png' },
  { id: 'basculegion', name: '幽尾玄鱼', url: 'https://tcg.mik.moe/static/icon/basculegion.png' },
  { id: 'hitmonchan', name: '快拳郎', url: 'https://tcg.mik.moe/static/icon/hitmonchan.png' },
  { id: 'guzzlord', name: '恶食大王', url: 'https://tcg.mik.moe/static/icon/guzzlord.png' },
  { id: 'hitmontop', name: '战舞郎', url: 'https://tcg.mik.moe/static/icon/hitmontop.png' },
  { id: 'lapras', name: '拉普拉斯', url: 'https://tcg.mik.moe/static/icon/lapras.png' },
  { id: 'zekrom', name: '捷克罗姆', url: 'https://tcg.mik.moe/static/icon/zekrom.png' },
  { id: 'zeraora', name: '捷拉奥拉', url: 'https://tcg.mik.moe/static/icon/zeraora.png' },
  { id: 'bunnelby', name: '掘掘兔', url: 'https://tcg.mik.moe/static/icon/bunnelby.png' },
  { id: 'eternatus', name: '无极汰那', url: 'https://tcg.mik.moe/static/icon/eternatus.png' },
  { id: 'drednaw-gmax', name: '暴噬龟VMAX', url: 'https://tcg.mik.moe/static/icon/drednaw-gmax.png' },
  { id: 'umbreon', name: '月亮伊布', url: 'https://tcg.mik.moe/static/icon/umbreon.png' },
  { id: 'rowlet', name: '木木枭', url: 'https://tcg.mik.moe/static/icon/rowlet.png' },
  { id: 'substitute', name: '未知', url: 'https://tcg.mik.moe/static/icon/substitute.png' },
  { id: 'unown', name: '未知图腾', url: 'https://tcg.mik.moe/static/icon/unown.png' },
  { id: 'trevenant', name: '朽木妖', url: 'https://tcg.mik.moe/static/icon/trevenant.png' },
  { id: 'polteageist', name: '来悲茶', url: 'https://tcg.mik.moe/static/icon/polteageist.png' },
  { id: 'mew', name: '梦幻', url: 'https://tcg.mik.moe/static/icon/mew.png' },
  { id: 'jumpluff', name: '毽子棉', url: 'https://tcg.mik.moe/static/icon/jumpluff.png' },
  { id: 'suicune', name: '水君', url: 'https://tcg.mik.moe/static/icon/suicune.png' },
  { id: 'chandelure', name: '水晶灯火灵', url: 'https://tcg.mik.moe/static/icon/chandelure.png' },
  { id: 'blastoise-gmax', name: '水箭龟VMAX', url: 'https://tcg.mik.moe/static/icon/blastoise-gmax.png' },
  { id: 'gardevoir', name: '沙奈朵', url: 'https://tcg.mik.moe/static/icon/gardevoir.png' },
  { id: 'sandaconda', name: '沙螺蟒', url: 'https://tcg.mik.moe/static/icon/sandaconda.png' },
  { id: 'volcanion', name: '波尔凯尼恩', url: 'https://tcg.mik.moe/static/icon/volcanion.png' },
  { id: 'golurk', name: '泥偶巨人', url: 'https://tcg.mik.moe/static/icon/golurk.png' },
  { id: 'samurott-hisui', name: '洗翠大剑鬼', url: 'https://tcg.mik.moe/static/icon/samurott-hisui.png' },
  { id: 'decidueye-hisui', name: '洗翠狙射树枭', url: 'https://tcg.mik.moe/static/icon/decidueye-hisui.png' },
  { id: 'zoroark-hisui', name: '洗翠索罗亚克', url: 'https://tcg.mik.moe/static/icon/zoroark-hisui.png' },
  { id: 'arcanine-hisui', name: '洗翠风速狗', url: 'https://tcg.mik.moe/static/icon/arcanine-hisui.png' },
  { id: 'goodra-hisui', name: '洗翠黏美龙', url: 'https://tcg.mik.moe/static/icon/goodra-hisui.png' },
  { id: 'lugia', name: '洛奇亚', url: 'https://tcg.mik.moe/static/icon/lugia.png' },
  { id: 'flareon', name: '火伊布', url: 'https://tcg.mik.moe/static/icon/flareon.png' },
  { id: 'moltres', name: '火焰鸟', url: 'https://tcg.mik.moe/static/icon/moltres.png' },
  { id: 'blaziken', name: '火焰鸡', url: 'https://tcg.mik.moe/static/icon/blaziken.png' },
  { id: 'entei', name: '炎帝', url: 'https://tcg.mik.moe/static/icon/entei.png' },
  { id: 'ludicolo', name: '乐天河童', url: 'https://tcg.mik.moe/static/icon/ludicolo.png' },
  { id: 'garchomp', name: '烈咬陆鲨', url: 'https://tcg.mik.moe/static/icon/garchomp.png' },
  { id: 'rayquaza', name: '烈空坐', url: 'https://tcg.mik.moe/static/icon/rayquaza.png' },
  { id: 'victini', name: '比克提尼', url: 'https://tcg.mik.moe/static/icon/victini.png' },
  { id: 'centiskorch-gmax', name: '焚焰蚣VMAX', url: 'https://tcg.mik.moe/static/icon/centiskorch-gmax.png' },
  { id: 'buzzwole', name: '爆肌蚊', url: 'https://tcg.mik.moe/static/icon/buzzwole.png' },
  { id: 'decidueye', name: '狙射树枭', url: 'https://tcg.mik.moe/static/icon/decidueye.png' },
  { id: 'espurr', name: '妙喵', url: 'https://tcg.mik.moe/static/icon/espurr.png' },
  { id: 'persian', name: '猫老大', url: 'https://tcg.mik.moe/static/icon/persian.png' },
  { id: 'weavile', name: '玛狃拉', url: 'https://tcg.mik.moe/static/icon/weavile.png' },
  { id: 'tyranitar', name: '班基拉斯', url: 'https://tcg.mik.moe/static/icon/tyranitar.png' },
  { id: 'koffing', name: '瓦斯弹', url: 'https://tcg.mik.moe/static/icon/koffing.png' },
  { id: 'tsareena', name: '甜冷美后', url: 'https://tcg.mik.moe/static/icon/tsareena.png' },
  { id: 'greninja', name: '甲贺忍蛙', url: 'https://tcg.mik.moe/static/icon/greninja.png' },
  { id: 'calyrex-ice-rider', name: '白马蕾冠王', url: 'https://tcg.mik.moe/static/icon/calyrex-ice-rider.png' },
  { id: 'ditto', name: '百变怪', url: 'https://tcg.mik.moe/static/icon/ditto.png' },
  { id: 'pikachu', name: '皮卡丘', url: 'https://tcg.mik.moe/static/icon/pikachu.png' },
  { id: 'clefairy', name: '皮皮', url: 'https://tcg.mik.moe/static/icon/clefairy.png' },
  { id: 'kyogre', name: '盖欧卡', url: 'https://tcg.mik.moe/static/icon/kyogre.png' },
  { id: 'cryogonal', name: '几何雪花', url: 'https://tcg.mik.moe/static/icon/cryogonal.png' },
  { id: 'genesect', name: '盖诺赛克特', url: 'https://tcg.mik.moe/static/icon/genesect.png' },
  { id: 'blacephalon', name: '砰头小丑', url: 'https://tcg.mik.moe/static/icon/blacephalon.png' },
  { id: 'dhelmise', name: '破破舵轮', url: 'https://tcg.mik.moe/static/icon/dhelmise.png' },
  { id: 'necrozma-ultra', name: '究极奈克洛兹玛', url: 'https://tcg.mik.moe/static/icon/necrozma-ultra.png' },
  { id: 'solgaleo', name: '索尔迦雷欧', url: 'https://tcg.mik.moe/static/icon/solgaleo.png' },
  { id: 'zoroark', name: '索罗亚克', url: 'https://tcg.mik.moe/static/icon/zoroark.png' },
  { id: 'armarouge', name: '红莲铠骑', url: 'https://tcg.mik.moe/static/icon/armarouge.png' },
  { id: 'melmetal', name: '美录梅塔', url: 'https://tcg.mik.moe/static/icon/melmetal.png' },
  { id: 'meloetta', name: '美洛耶塔', url: 'https://tcg.mik.moe/static/icon/meloetta.png' },
  { id: 'gengar-gmax', name: '耿鬼VMAX', url: 'https://tcg.mik.moe/static/icon/gengar-gmax.png' },
  { id: 'magnezone', name: '自爆磁怪', url: 'https://tcg.mik.moe/static/icon/magnezone.png' },
  { id: 'spiritomb', name: '花岩怪', url: 'https://tcg.mik.moe/static/icon/spiritomb.png' },
  { id: 'comfey', name: '花疗环环', url: 'https://tcg.mik.moe/static/icon/comfey.png' },
  { id: 'zacian-crowned', name: '苍响', url: 'https://tcg.mik.moe/static/icon/zacian-crowned.png' },
  { id: 'flaaffy', name: '茸茸羊', url: 'https://tcg.mik.moe/static/icon/flaaffy.png' },
  { id: 'reshiram', name: '莱希拉姆', url: 'https://tcg.mik.moe/static/icon/reshiram.png' },
  { id: 'greedent', name: '藏饱栗鼠', url: 'https://tcg.mik.moe/static/icon/greedent.png' },
  { id: 'charjabug', name: '虫电宝', url: 'https://tcg.mik.moe/static/icon/charjabug.png' },
  { id: 'mimikyu', name: '谜拟丘', url: 'https://tcg.mik.moe/static/icon/mimikyu.png' },
  { id: 'palkia-origin', name: '起源帕路奇亚', url: 'https://tcg.mik.moe/static/icon/palkia-origin.png' },
  { id: 'noctowl', name: '猫头夜鹰', url: 'https://tcg.mik.moe/static/icon/noctowl.png' },
  { id: 'dialga-origin', name: '起源帝牙卢卡', url: 'https://tcg.mik.moe/static/icon/dialga-origin.png' },
  { id: 'metang', name: '金属怪', url: 'https://tcg.mik.moe/static/icon/metang.png' },
  { id: 'mewtwo', name: '超梦', url: 'https://tcg.mik.moe/static/icon/mewtwo.png' },
  { id: 'lucario', name: '路卡利欧', url: 'https://tcg.mik.moe/static/icon/lucario.png' },
  { id: 'emolga', name: '电飞鼠', url: 'https://tcg.mik.moe/static/icon/emolga.png' },
  { id: 'pachirisu', name: '帕奇利兹', url: 'https://tcg.mik.moe/static/icon/pachirisu.png' },
  { id: 'darkrai', name: '达克莱伊', url: 'https://tcg.mik.moe/static/icon/darkrai.png' },
  { id: 'urshifu-rapid-strike-gmax', name: '连击武道熊师', url: 'https://tcg.mik.moe/static/icon/urshifu-rapid-strike-gmax.png' },
  { id: 'boltund', name: '逐电犬', url: 'https://tcg.mik.moe/static/icon/boltund.png' },
  { id: 'corviknight', name: '钢铠鸦', url: 'https://tcg.mik.moe/static/icon/corviknight.png' },
  { id: 'iron-valiant', name: '铁武者', url: 'https://tcg.mik.moe/static/icon/iron-valiant.png' },
  { id: 'durant', name: '铁蚁', url: 'https://tcg.mik.moe/static/icon/durant.png' },
  { id: 'duraludon-gmax', name: '铝钢龙VMAX', url: 'https://tcg.mik.moe/static/icon/duraludon-gmax.png' },
  { id: 'silvally', name: '银伴战兽', url: 'https://tcg.mik.moe/static/icon/silvally.png' },
  { id: 'vikavolt', name: '锹农炮虫', url: 'https://tcg.mik.moe/static/icon/vikavolt.png' },
  { id: 'cinderace', name: '闪焰王牌', url: 'https://tcg.mik.moe/static/icon/cinderace.png' },
  { id: 'zapdos', name: '闪电鸟', url: 'https://tcg.mik.moe/static/icon/zapdos.png' },
  { id: 'arceus', name: '阿尔宙斯', url: 'https://tcg.mik.moe/static/icon/arceus.png' },
  { id: 'gyarados', name: '暴鲤龙', url: 'https://tcg.mik.moe/static/icon/gyarados.png' },
  { id: 'aggron', name: '波士可多拉', url: 'https://tcg.mik.moe/static/icon/aggron.png' },
  { id: 'serperior', name: '君主蛇', url: 'https://tcg.mik.moe/static/icon/serperior.png' },
  { id: 'vulpix-alola', name: '阿罗拉六尾', url: 'https://tcg.mik.moe/static/icon/vulpix-alola.png' },
  { id: 'exeggutor-alola', name: '阿罗拉椰蛋树', url: 'https://tcg.mik.moe/static/icon/exeggutor-alola.png' },
  { id: 'persian-alola', name: '阿罗拉猫老大', url: 'https://tcg.mik.moe/static/icon/persian-alola.png' },
  { id: 'hoopa-unbound', name: '胡帕', url: 'https://tcg.mik.moe/static/icon/hoopa-unbound.png' },
  { id: 'muk-alola', name: '阿罗拉臭臭泥', url: 'https://tcg.mik.moe/static/icon/muk-alola.png' },
  { id: 'raichu-alola', name: '阿罗拉雷丘', url: 'https://tcg.mik.moe/static/icon/raichu-alola.png' },
  { id: 'frosmoth', name: '雪绒蛾', url: 'https://tcg.mik.moe/static/icon/frosmoth.png' },
  { id: 'raichu', name: '雷丘', url: 'https://tcg.mik.moe/static/icon/raichu.png' },
  { id: 'jolteon', name: '雷伊布', url: 'https://tcg.mik.moe/static/icon/jolteon.png' },
  { id: 'regigigas', name: '雷吉奇卡斯', url: 'https://tcg.mik.moe/static/icon/regigigas.png' },
  { id: 'regieleki', name: '雷吉艾勒奇', url: 'https://tcg.mik.moe/static/icon/regieleki.png' },
  { id: 'regidrago', name: '雷吉铎拉戈', url: 'https://tcg.mik.moe/static/icon/regidrago.png' },
  { id: 'dracozolt', name: '雷鸟龙', url: 'https://tcg.mik.moe/static/icon/dracozolt.png' },
  { id: 'alcremie-gmax', name: '霜奶仙VMAX', url: 'https://tcg.mik.moe/static/icon/alcremie-gmax.png' },
  { id: 'lunala', name: '露奈雅拉', url: 'https://tcg.mik.moe/static/icon/lunala.png' },
  { id: 'bronzong', name: '青铜钟', url: 'https://tcg.mik.moe/static/icon/bronzong.png' },
  { id: 'electrode', name: '顽皮雷弹', url: 'https://tcg.mik.moe/static/icon/electrode.png' },
  { id: 'hitmonlee', name: '飞腿郎', url: 'https://tcg.mik.moe/static/icon/hitmonlee.png' },
  { id: 'seviper', name: '饭匙蛇', url: 'https://tcg.mik.moe/static/icon/seviper.png' },
  { id: 'giratina-origin', name: '骑拉帝纳', url: 'https://tcg.mik.moe/static/icon/giratina-origin.png' },
  { id: 'dusknoir', name: '黑夜魔灵', url: 'https://tcg.mik.moe/static/icon/dusknoir.png' },
  { id: 'calyrex-shadow-rider', name: '黑马蕾冠王', url: 'https://tcg.mik.moe/static/icon/calyrex-shadow-rider.png' },
  { id: 'tornadus', name: '龙卷云', url: 'https://tcg.mik.moe/static/icon/tornadus.png' },
  { id: 'raging-bolt', name: '猛雷鼓', url: 'https://tcg.mik.moe/static/icon/raging-bolt.png' },
  { id: 'grimmsnarl', name: '长毛巨魔', url: 'https://tcg.mik.moe/static/icon/grimmsnarl.png' },
  { id: 'gholdengo', name: '赛富豪', url: 'https://tcg.mik.moe/static/icon/gholdengo.png' },
  { id: 'joltik', name: '电电虫', url: 'https://tcg.mik.moe/static/icon/joltik.png' },
  { id: 'archaludon', name: '铝钢桥龙', url: 'https://tcg.mik.moe/static/icon/archaludon.png' },
  { id: 'ogerpon-wellspring', name: '碧草面具厄鬼椪', url: 'https://tcg.mik.moe/static/icon/ogerpon-wellspring.png' },
  { id: 'roaring-moon', name: '轰鸣月', url: 'https://tcg.mik.moe/static/icon/roaring-moon.png' },
  { id: 'toedscruel', name: '陆地水母', url: 'https://tcg.mik.moe/static/icon/toedscruel.png' },
  { id: 'ogerpon', name: '厄鬼椪', url: 'https://tcg.mik.moe/static/icon/ogerpon.png' },
  { id: 'spidops', name: '操陷蛛', url: 'https://tcg.mik.moe/static/icon/spidops.png' },
  { id: 'iron-thorns', name: '铁荆棘', url: 'https://tcg.mik.moe/static/icon/iron-thorns.png' },
  { id: 'crustle', name: '岩殿居蟹', url: 'https://tcg.mik.moe/static/icon/crustle.png' },
  { id: 'ceruledge', name: '苍炎刃鬼', url: 'https://tcg.mik.moe/static/icon/ceruledge.png' },
  { id: 'typhlosion', name: '火暴兽', url: 'https://tcg.mik.moe/static/icon/typhlosion.png' },
  { id: 'snorlax', name: '卡比兽', url: 'https://tcg.mik.moe/static/icon/snorlax.png' },
  { id: 'froslass', name: '雪妖女', url: 'https://tcg.mik.moe/static/icon/froslass.png' },
  { id: 'munkidori', name: '愿增猿', url: 'https://tcg.mik.moe/static/icon/munkidori.png' },
  { id: 'magcargo', name: '熔岩蜗牛', url: 'https://tcg.mik.moe/static/icon/magcargo.png' },
  { id: 'ho-oh', name: '凤王', url: 'https://tcg.mik.moe/static/icon/ho-oh.png' },
  { id: 'miraidon', name: '密勒顿', url: 'https://tcg.mik.moe/static/icon/miraidon.png' },
  { id: 'conkeldurr', name: '修建老匠', url: 'https://tcg.mik.moe/static/icon/conkeldurr.png' },
  { id: 'great-tusk', name: '雄伟牙', url: 'https://tcg.mik.moe/static/icon/great-tusk.png' },
  { id: 'pidgeot', name: '大比鸟', url: 'https://tcg.mik.moe/static/icon/pidgeot.png' },
  { id: 'terapagos', name: '太乐巴戈斯', url: 'https://tcg.mik.moe/static/icon/terapagos.png' },
  { id: 'hydrapple', name: '蜜集大蛇', url: 'https://tcg.mik.moe/static/icon/hydrapple.png' },
  { id: 'iron-hands', name: '铁臂膀', url: 'https://tcg.mik.moe/static/icon/iron-hands.png' },
  { id: 'ogerpon-hearthflame', name: '火灶面具厄鬼椪', url: 'https://tcg.mik.moe/static/icon/ogerpon-hearthflame.png' },
  { id: 'ogerpon-cornerstone', name: '础石面具厄鬼椪', url: 'https://tcg.mik.moe/static/icon/ogerpon-cornerstone.png' },
  { id: 'ogerpon-teal', name: '碧草面具厄鬼椪', url: 'https://tcg.mik.moe/static/icon/ogerpon-teal.png' },
  { id: 'fezandipiti', name: '吉雉鸡', url: 'https://tcg.mik.moe/static/icon/fezandipiti.png' },
  { id: 'okidogi', name: '够赞狗', url: 'https://tcg.mik.moe/static/icon/okidogi.png' },
  { id: 'munkidori-ex', name: '愿增猿ex', url: 'https://tcg.mik.moe/static/icon/munkidori-ex.png' },
  { id: 'squawkabilly', name: '怒鹦哥', url: 'https://tcg.mik.moe/static/icon/squawkabilly.png' },
  { id: 'tinkaton', name: '巨锻匠', url: 'https://tcg.mik.moe/static/icon/tinkaton.png' },
  { id: 'luxray', name: '勒克猫', url: 'https://tcg.mik.moe/static/icon/luxray.png' },
  { id: 'baxcalibur', name: '戟脊龙', url: 'https://tcg.mik.moe/static/icon/baxcalibur.png' },
  { id: 'palafin', name: '海豚侠', url: 'https://tcg.mik.moe/static/icon/palafin.png' },
  { id: 'annihilape', name: '弃世猴', url: 'https://tcg.mik.moe/static/icon/annihilape.png' },
  { id: 'scizor', name: '巨钳螳螂', url: 'https://tcg.mik.moe/static/icon/scizor.png' },
  { id: 'rotom', name: '洛托姆', url: 'https://tcg.mik.moe/static/icon/rotom.png' },
  { id: 'ting-lu', name: '古鼎鹿', url: 'https://tcg.mik.moe/static/icon/ting-lu.png' },
  { id: 'wo-chien', name: '古简蜗', url: 'https://tcg.mik.moe/static/icon/wo-chien.png' },
  { id: 'chi-yu', name: '古玉鱼', url: 'https://tcg.mik.moe/static/icon/chi-yu.png' },
  { id: 'chien-pao-ex', name: '古剑豹ex', url: 'https://tcg.mik.moe/static/icon/chien-pao-ex.png' },
  { id: 'espathra', name: '超能艳鸵', url: 'https://tcg.mik.moe/static/icon/espathra.png' },
  { id: 'banette', name: '诅咒娃娃', url: 'https://tcg.mik.moe/static/icon/banette.png' },
  { id: 'dipplin', name: '裹蜜虫', url: 'https://tcg.mik.moe/static/icon/dipplin.png' },
  { id: 'iron-crown', name: '铁头壳', url: 'https://tcg.mik.moe/static/icon/iron-crown.png' },
  { id: 'iron-boulder', name: '铁磐岩', url: 'https://tcg.mik.moe/static/icon/iron-boulder.png' },
  { id: 'iron-leaves', name: '铁斑叶', url: 'https://tcg.mik.moe/static/icon/iron-leaves.png' },
  { id: 'walking-wake', name: '波荡水', url: 'https://tcg.mik.moe/static/icon/walking-wake.png' },
  { id: 'gouging-fire', name: '破空焰', url: 'https://tcg.mik.moe/static/icon/gouging-fire.png' },
  { id: 'kingambit', name: '仆刀将军', url: 'https://tcg.mik.moe/static/icon/kingambit.png' },
  { id: 'glimmora', name: '晶光花', url: 'https://tcg.mik.moe/static/icon/glimmora.png' },
  { id: 'dondozo', name: '吃吼霸', url: 'https://tcg.mik.moe/static/icon/dondozo.png' },
  { id: 'tatsugiri', name: '米立龙', url: 'https://tcg.mik.moe/static/icon/tatsugiri.png' },
  { id: 'meowscarada', name: '魔幻假面喵', url: 'https://tcg.mik.moe/static/icon/meowscarada.png' },
  { id: 'skeledirge', name: '骨纹巨声鳄', url: 'https://tcg.mik.moe/static/icon/skeledirge.png' },
  { id: 'quaquaval', name: '狂欢浪舞鸭', url: 'https://tcg.mik.moe/static/icon/quaquaval.png' },
  { id: 'dudunsparce', name: '土龙节节', url: 'https://tcg.mik.moe/static/icon/dudunsparce.png' },
  { id: 'arboliva', name: '奥利瓦', url: 'https://tcg.mik.moe/static/icon/arboliva.png' },
  { id: 'garganacl', name: '盐石巨灵', url: 'https://tcg.mik.moe/static/icon/garganacl.png' },
  { id: 'bellibolt', name: '电肚蛙', url: 'https://tcg.mik.moe/static/icon/bellibolt.png' },
  { id: 'wugtrio', name: '三海地鼠', url: 'https://tcg.mik.moe/static/icon/wugtrio.png' },
  { id: 'bombirdier', name: '下石鸟', url: 'https://tcg.mik.moe/static/icon/bombirdier.png' },
  { id: 'orthworm', name: '拖拖蚓', url: 'https://tcg.mik.moe/static/icon/orthworm.png' },
  { id: 'revavroom', name: '普隆隆姆', url: 'https://tcg.mik.moe/static/icon/revavroom.png' },
  { id: 'dachsbun', name: '麻花犬', url: 'https://tcg.mik.moe/static/icon/dachsbun.png' },
  { id: 'armarouge-ex', name: '红莲铠骑ex', url: 'https://tcg.mik.moe/static/icon/armarouge-ex.png' },
  { id: 'ceruledge-ex', name: '苍炎刃鬼ex', url: 'https://tcg.mik.moe/static/icon/ceruledge-ex.png' },
  { id: 'houndoom', name: '黑鲁加', url: 'https://tcg.mik.moe/static/icon/houndoom.png' },
  { id: 'tyranitar-ex', name: '班基拉斯ex', url: 'https://tcg.mik.moe/static/icon/tyranitar-ex.png' },
  { id: 'pawmot', name: '巴布土拨', url: 'https://tcg.mik.moe/static/icon/pawmot.png' },
  { id: 'kilowattrel', name: '大电海燕', url: 'https://tcg.mik.moe/static/icon/kilowattrel.png' },
  { id: 'toedscool', name: '原野水母', url: 'https://tcg.mik.moe/static/icon/toedscool.png' },
  { id: 'brute-bonnet', name: '猛恶菇', url: 'https://tcg.mik.moe/static/icon/brute-bonnet.png' },
  { id: 'flutter-mane', name: '振翼发', url: 'https://tcg.mik.moe/static/icon/flutter-mane.png' },
  { id: 'sandy-shocks', name: '沙铁皮', url: 'https://tcg.mik.moe/static/icon/sandy-shocks.png' },
  { id: 'slither-wing', name: '爬地翅', url: 'https://tcg.mik.moe/static/icon/slither-wing.png' },
  { id: 'scream-tail', name: '吼叫尾', url: 'https://tcg.mik.moe/static/icon/scream-tail.png' },
  { id: 'iron-moth', name: '铁毒蛾', url: 'https://tcg.mik.moe/static/icon/iron-moth.png' },
  { id: 'iron-jugulis', name: '铁脖颈', url: 'https://tcg.mik.moe/static/icon/iron-jugulis.png' },
  { id: 'iron-treads', name: '铁辙迹', url: 'https://tcg.mik.moe/static/icon/iron-treads.png' },
  { id: 'iron-bundle', name: '铁包袱', url: 'https://tcg.mik.moe/static/icon/iron-bundle.png' },
  { id: 'milotic', name: '美纳斯', url: 'https://tcg.mik.moe/static/icon/milotic.png' },
  { id: 'feraligatr', name: '大力鳄', url: 'https://tcg.mik.moe/static/icon/feraligatr.png' },
  { id: 'meganium', name: '大竺葵', url: 'https://tcg.mik.moe/static/icon/meganium.png' },
  { id: 'emboar', name: '炎武王', url: 'https://tcg.mik.moe/static/icon/emboar.png' },
  { id: 'samurott', name: '大剑鬼', url: 'https://tcg.mik.moe/static/icon/samurott.png' },
  { id: 'delphox', name: '妖火红狐', url: 'https://tcg.mik.moe/static/icon/delphox.png' },
  { id: 'chesnaught', name: '布里卡隆', url: 'https://tcg.mik.moe/static/icon/chesnaught.png' },
  { id: 'greninja-ex', name: '甲贺忍蛙ex', url: 'https://tcg.mik.moe/static/icon/greninja-ex.png' },
  { id: 'incineroar', name: '炽焰咆哮虎', url: 'https://tcg.mik.moe/static/icon/incineroar.png' },
  { id: 'primarina', name: '西狮海壬', url: 'https://tcg.mik.moe/static/icon/primarina.png' },
  { id: 'rillaboom', name: '轰擂金刚猩', url: 'https://tcg.mik.moe/static/icon/rillaboom.png' },
  { id: 'inteleon-ex', name: '千面避役ex', url: 'https://tcg.mik.moe/static/icon/inteleon-ex.png' },
];

// 内置默认卡组图鉴 —— 新用户首次打开自动加载
const DEFAULT_DECK_LIST = [
  { name: '沙奈朵', icons: ['gardevoir'] },
  { name: '多龙', icons: ['dragapult'] },
  { name: '多龙（自爆轴）', icons: ['dragapult', 'dusknoir'] },
  { name: '多龙（恶喷轴）', icons: ['dragapult', 'charizard'] },
  { name: '多龙（火鸡轴）', icons: ['dragapult', 'blaziken'] },
  { name: '猛雷鼓', icons: ['raging-bolt'] },
  { name: '猛雷鼓（白轴）', icons: ['raging-bolt'] },
  { name: '赛富豪', icons: ['gholdengo'] },
  { name: '赛富豪（多龙轴）', icons: ['gholdengo'] },
  { name: '玛长', icons: ['grimmsnarl'] },
  { name: '电电虫box', icons: ['joltik'] },
  { name: '伊布box', icons: [] },
  { name: '恶喷', icons: ['charizard'] },
  { name: '恶喷（白轴）', icons: ['charizard', 'noctowl'] },
  { name: '钛晶box', icons: ['terapagos'] },
  { name: 'N索', icons: ['zoroark'] },
  { name: '桥龙', icons: ['archaludon'] },
  { name: '桥龙（毒轴）', icons: ['archaludon'] },
  { name: '陆地水母', icons: ['toedscruel'] },
  { name: '火箭队box', icons: ['mewtwo'] },
  { name: '轰明月ex（毒）', icons: ['roaring-moon'] },
  { name: '轰鸣月', icons: ['roaring-moon'] },
  { name: '赫普box', icons: ['zacian-crowned'] },
  { name: '凤王送火box', icons: ['ho-oh'] },
  { name: '火暴兽', icons: ['typhlosion'] },
  { name: '苍炎刃鬼ex', icons: ['ceruledge'] },
  { name: '呆呆王', icons: ['slowking-galar'] },
  { name: '铁荆棘ex', icons: ['iron-thorns'] },
  { name: '岩殿居蟹', icons: ['crustle'] },
  { name: '幸福蛋愿增猿', icons: ['blissey', 'munkidori'] },
  { name: '祭典乐舞', icons: [] },
  { name: '三首恶龙', icons: [] },
  { name: '雪妖女愿增援', icons: ['froslass'] },
  { name: '未来box', icons: ['miraidon'] },
  { name: '雄伟牙', icons: ['great-tusk'] },
  { name: '大力鳄', icons: ['feraligatr'] },
  { name: '超能艳鸵', icons: ['espathra'] },
  { name: '钛晶龟', icons: ['terapagos'] },
  { name: '凤王熔岩蜗牛', icons: ['ho-oh', 'magcargo'] },
  { name: '甲贺忍蛙ex', icons: ['greninja'] },
  { name: '古剑豹', icons: ['chien-pao'] },
  { name: '魔幻假面喵ex', icons: ['meowscarada'] },
  { name: '厄诡椪box', icons: [] },
  { name: '修建老匠', icons: ['conkeldurr'] },
  { name: '雕控', icons: ['pidgeot'] },
  { name: '古鼎鹿ex', icons: ['ting-lu'] },
];

// 图标辅助函数
function findDeckIcon(id) {
  return DECK_ICONS.find(i => i.id === id);
}

function renderDeckIcon(id, size = 22) {
  const icon = findDeckIcon(id);
  if (icon) {
    return `<img src="${icon.url}" alt="${esc(icon.name)}" class="deck-icon-img" style="width:${size}px;height:${size}px;object-fit:contain;" title="${esc(icon.name)}">`;
  }
  // 兼容旧数据：emoji 或未知字符串
  return `<span class="deck-icon-fallback" style="font-size:${Math.max(12, size * 0.75)}px;" title="${esc(id)}">${esc(id)}</span>`;
}

function renderDeckIcons(ids, size = 22) {
  if (!ids || ids.length === 0) return '';
  return `<span class="deck-icons">${ids.map(id => renderDeckIcon(id, size)).join('')}</span>`;
}

// 根据卡组名称模糊匹配推荐宝可梦图标（最多 2 个）
function suggestDeckIconsByName(name) {
  const raw = name.toLowerCase().trim();
  if (!raw) return [];

  // 去除常见后缀，避免 "耿鬼VMAX" 无法匹配 "耿鬼"
  const suffixes = ['卡组', '牌组', '套牌', 'vmax', 'v-star', 'vstar', 'v-union', 'v-uno', 'v', 'ex', 'gx', 'mega'];
  let cleaned = raw;
  for (const suffix of suffixes) {
    if (cleaned.endsWith(suffix)) {
      cleaned = cleaned.slice(0, -suffix.length).trim();
    }
  }
  if (!cleaned) cleaned = raw;

  // 1. 名称完全包含搜索词（如 "沙奈朵"）
  let matches = DECK_ICONS.filter(i => i.name.toLowerCase().includes(cleaned));

  // 2. 搜索词包含完整图标名（如 "铝钢龙VMAX" 包含 "铝钢龙"）
  if (matches.length < 2) {
    const extra = DECK_ICONS.filter(i =>
      !matches.includes(i) &&
      cleaned.includes(i.name.toLowerCase())
    );
    matches = matches.concat(extra);
  }

  // 3. 按名称长度排序（越短越具体，优先）
  matches.sort((a, b) => a.name.length - b.name.length);

  return matches.slice(0, 2).map(i => i.id);
}

// --- 工具函数 ---
function uuid() {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16));
}

// --- 状态 ---
let state = {
  watchlist: [], lastUpdate: null, players: {}, notes: {},
  personal: { playerName: '', currentDeckId: null, decks: {}, matchHistory: [], draftMatch: null }
};
// 本窗口上次读到/写入的数据副本，交给 PtcgStore 判断「我改了什么」
let lastWrittenState = null;
let currentSort = 'exp';
let editingNote = null;
let editingHistoryId = null;
let selectedDeckListIcons = [];
let lastSuggestedDeckIcons = [];
let editingDeckListId = null;
let deckIconSearchTerm = '';
let searchTerm = '';
let autoRefreshTimer = null;
let lastWorkingRelayId = ''; // 上次成功的中转 id

// --- DOM 元素 ---
const $ = (id) => document.getElementById(id);
const refreshBtn = $('refreshBtn');
const addBtn = $('addBtn');
const playerInput = $('playerInput');
const addResult = $('addResult');
const playerTableBody = $('playerTableBody');
const tableContainer = $('tableContainer');
const emptyState = $('emptyState');
const statsSection = $('statsSection');
const loadingOverlay = $('loadingOverlay');
const loadingText = $('loadingText');
const toast = $('toast');
const sortBy = $('sortBy');
const searchInput = $('searchInput');
const menuBtn = $('menuBtn');
const menuDropdown = $('menuDropdown');
const mobileList = $('mobilePlayerList');

// ============================================================
// 数据持久化 (localStorage)
// ============================================================

function loadData() {
  try {
    // 统一走 PtcgStore：它负责规范化、合并和「历史记录找回」
    const data = window.PtcgStore
      ? PtcgStore.read()
      : (() => { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; })();
    if (data) {
      state = {
        watchlist: data.watchlist || [],
        lastUpdate: data.lastUpdate || null,
        players: data.players || {},
        notes: data.notes || {},
        personal: data.personal || { playerName: '', currentDeckId: null, decks: {}, matchHistory: [], draftMatch: null },
      };
      // 初始化 deckList
      if (!state.personal.deckList) state.personal.deckList = [];
      if (state.personal.draftMatch === undefined) state.personal.draftMatch = null;
      // 迁移旧版卡组数据（wins/losses → accumulatedWins/accumulatedLosses + snapshot）
      if (state.personal && state.personal.decks) {
        let migrated = false;
        Object.values(state.personal.decks).forEach(d => {
          if (d.wins !== undefined && d.accumulatedWins === undefined) {
            d.accumulatedWins = d.wins;
            d.accumulatedLosses = d.losses || 0;
            d.snapshotWins = d.snapshotWins ?? 0;
            d.snapshotLosses = d.snapshotLosses ?? 0;
            delete d.wins;
            delete d.losses;
            migrated = true;
          }
        });
        if (migrated) saveData();
      }
      // 记下本窗口的基线：之后 saveData 时据此判断哪些记录是本窗口新加/改过的
      if (window.PtcgStore) {
        lastWrittenState = PtcgStore.normalize(JSON.parse(JSON.stringify(state)));
        // 万一某条记录被别的窗口整份覆盖掉了，从日志里补回来
        const found = PtcgStore.recoverHistory(state);
        if (found > 0) {
          saveData();
          showToast(`已从备份日志找回 ${found} 条对局记录`, 'success');
        }
      }
    }
    // 注入默认卡组图鉴：新用户或未设置卡组的用户首次加载时自动填充
    if (data && data.personal && !Array.isArray(data.personal.deckList) && state.personal.playerName) {
      state.personal.deckList = DEFAULT_DECK_LIST.map(d => ({
        id: uuid(),
        name: d.name,
        icons: [...d.icons],
      }));
      saveData();
    }
  } catch (e) {
    console.error('加载数据失败:', e);
  }
}

// 把存储里的数据同步到内存 state（写入后用它保持界面与存储一致）
function stateFromStore(d) {
  return {
    watchlist: d.watchlist || [],
    lastUpdate: d.lastUpdate || null,
    players: d.players || {},
    notes: d.notes || {},
    personal: d.personal || { playerName: '', currentDeckId: null, decks: {}, matchHistory: [], draftMatch: null },
  };
}

function saveData(opts) {
  try {
    if (window.PtcgStore) {
      // 不再整份覆盖：把本窗口的改动合并进存储（另一窗口新增的记录不会被吃掉）
      const merged = PtcgStore.applyState(state, lastWrittenState, opts);
      state = stateFromStore(merged);
      // 基线必须是独立副本：否则界面里的原地修改会把基线一起改掉，
      // 删除就判断不出来（删除靠「基线里有、现在没有」来写墓碑）
      lastWrittenState = JSON.parse(JSON.stringify(merged));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        watchlist: state.watchlist,
        lastUpdate: state.lastUpdate,
        players: state.players,
        notes: state.notes,
        personal: state.personal,
      }));
    }
  } catch (e) {
    console.error('保存数据失败:', e);
    showToast('数据保存失败，可能存储空间不足', 'error');
  }
}

// ============================================================
// PTCG API 调用 (通过 CORS 代理)
// ============================================================

let lastWorkingRelay = ''; // 最近一次成功的中转名（用于诊断提示）

function preferredRelayId() {
  try { return localStorage.getItem(RELAY_OK_KEY) || ''; } catch (e) { return ''; }
}

// 自建中转永远排第一，其次是上次成功过的中转，其余保持声明顺序
function orderProxies(proxies) {
  const rest = proxies.slice();
  const front = [];
  const take = (id) => {
    if (!id) return;
    const i = rest.findIndex((p) => p.id === id);
    if (i >= 0) front.push(rest.splice(i, 1)[0]);
  };
  take('custom');
  take(lastWorkingRelayId || preferredRelayId());
  return front.concat(rest);
}

function rememberRelay(proxy) {
  lastWorkingRelay = proxy.name;
  lastWorkingRelayId = proxy.id;
  try { localStorage.setItem(RELAY_OK_KEY, proxy.id); } catch (e) { /* localStorage 不可用时忽略 */ }
  const badge = $('relayStatus');
  if (badge) badge.textContent = proxy.name;
}

// 单个中转的一次尝试
// 返回 { kind:'data', data } | { kind:'notFound', definitive } | { kind:'fail', reason }
async function tryOneRelay(proxy, targetUrl, opts, controller) {
  const timer = setTimeout(() => controller.abort(), opts.timeout || RELAY_TIMEOUT_MS);
  try {
    const init = { signal: controller.signal, headers: { 'Accept': 'application/json' } };
    if (opts.method === 'POST') {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body || {});
    }
    const resp = await fetch(proxy.build(targetUrl), init);
    const text = (await resp.text()) || '';

    // 上游 404 = 玩家不存在，必须和中转故障区分开。
    // 有的中转原样透传 404，有的把它抹平仅在文本里提示，所以两种都要认。
    if (resp.status === 404 || /Target URL returned error 404/.test(text)) {
      if (opts.accept404) return { kind: 'notFound', definitive: resp.status === 404 };
      return { kind: 'fail', reason: `${proxy.name}: HTTP 404` };
    }
    if (!resp.ok) return { kind: 'fail', reason: `${proxy.name}: HTTP ${resp.status}` };

    const body = proxy.unwrap ? proxy.unwrap(text) : text;
    if (!body.trim()) {
      // 部分中转（如 sirjosh）会把 404 抹成 200 + 空响应，这种「空」不能当成功
      if (opts.accept404) return { kind: 'notFound', definitive: false };
      return { kind: 'fail', reason: `${proxy.name}: 返回空内容` };
    }
    try {
      return { kind: 'data', data: JSON.parse(body) };
    } catch (e) {
      return { kind: 'fail', reason: `${proxy.name}: 返回的不是 JSON` };
    }
  } catch (e) {
    const why = (e && e.name === 'AbortError') ? '超时' : ((e && e.message) || '网络错误');
    return { kind: 'fail', reason: `${proxy.name}: ${why}` };
  } finally {
    clearTimeout(timer);
  }
}

// 一批中转并发竞速：拿到可用数据或确定的 404 就立刻返回，并中断同批其他请求
function raceRelays(wave, targetUrl, opts) {
  return new Promise((resolve) => {
    const controllers = wave.map(() => new AbortController());
    const reasons = [];
    let pending = wave.length;
    let looseNotFound = null; // 被中转抹平的 404：只有没有更确定的答案时才采用
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      controllers.forEach((c) => { try { c.abort(); } catch (e) { /* 忽略 */ } });
      resolve(result);
    };

    wave.forEach((proxy, i) => {
      tryOneRelay(proxy, targetUrl, opts, controllers[i]).then((res) => {
        pending--;
        if (settled) return;
        if (res.kind === 'data') return finish({ proxy, data: res.data });
        if (res.kind === 'notFound') {
          if (res.definitive) return finish({ proxy, notFound: true });
          if (!looseNotFound) looseNotFound = { proxy, notFound: true };
        } else {
          reasons.push(res.reason);
        }
        if (pending === 0) finish(looseNotFound || { failures: reasons });
      });
    });
  });
}

async function fetchViaProxy(targetUrl, opts) {
  opts = opts || {};
  const ordered = orderProxies(activeProxies());
  const reasons = [];

  for (let i = 0; i < ordered.length; i += RELAY_WAVE_SIZE) {
    const out = await raceRelays(ordered.slice(i, i + RELAY_WAVE_SIZE), targetUrl, opts);
    if (out.proxy) {
      rememberRelay(out.proxy);
      return out.notFound ? { notFound: true } : out.data;
    }
    if (out.failures) reasons.push.apply(reasons, out.failures);
  }

  const err = new Error('数据中转全部不可用');
  err.reasons = reasons;
  throw err;
}

async function fetchPlayer(screenName) {
  const url = `${PTCG_BASE}/api/rank/player/query?screen_name=${encodeURIComponent(screenName)}`;
  try {
    const data = await fetchViaProxy(url, { accept404: true });
    if (data && data.notFound) return { notFound: true, name: screenName };
    return data;
  } catch (e) {
    // 中转故障要和「玩家不存在」区分开，否则界面会误报成未找到
    return { error: e.message || '查询失败', name: screenName, reasons: e.reasons || [] };
  }
}

async function fetchTops() {
  const url = `${PTCG_BASE}/api/rank/player/tops`;
  return await fetchViaProxy(url);
}

// 并发查询（限制并发数）
async function fetchAllPlayers(names, concurrency = 5, onProgress) {
  const results = [];
  for (let i = 0; i < names.length; i += concurrency) {
    const batch = names.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async name => {
        const data = await fetchPlayer(name);
        return { name, data };
      })
    );
    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({ name: batch[j], error: r.reason?.message || '查询失败' });
      }
    }
    if (onProgress) onProgress(results.length, names.length);
  }
  return results;
}

// ============================================================
// 核心操作
// ============================================================

async function refreshData() {
  if (state.watchlist.length === 0) {
    showToast('请先添加关注的玩家');
    return;
  }

  refreshBtn.disabled = true;
  showLoading(`正在更新 ${state.watchlist.length} 个玩家数据...`);

  try {
    // 同时获取排行榜和玩家详情
    let tops = [];
    try {
      tops = await fetchTops();
    } catch (e) {
      console.warn('获取排行榜失败:', e);
    }

    const playerResults = await fetchAllPlayers(state.watchlist, 5, (done, total) => {
      loadingText.textContent = `正在更新 ${done}/${total} 个玩家数据...`;
    });

    // 构建排名映射
    const rankMap = {};
    tops.forEach((p, i) => { rankMap[p.name] = i + 1; });

    // 更新玩家数据
    const players = {};
    for (const result of playerResults) {
      if (result.data && !result.data.notFound && !result.data.error) {
        const d = result.data;
        const total = d.win_total_count + d.lose_total_count;
        const winRate = total > 0 ? (d.win_total_count / total * 100) : 0;
        players[result.name] = {
          name: d.name,
          exp: d.exp,
          highestExp: d.highest_exp,
          winTotal: d.win_total_count,
          loseTotal: d.lose_total_count,
          winRate: parseFloat(winRate.toFixed(2)),
          winTemp: d.win_temp_count,
          winMax: d.win_max_count,
          loseTemp: d.lose_temp_count,
          loseMax: d.lose_max_count,
          rank: rankMap[d.name] || null,
          totalGames: total,
          updatedAt: d.updated_at,
        };
      } else if (result.data && result.data.notFound) {
        players[result.name] = { name: result.name, notFound: true };
      } else {
        players[result.name] = { name: result.name, error: result.error || '查询失败' };
      }
    }

    state.players = players;
    state.lastUpdate = new Date().toISOString();
    saveData();
    render();

    const valid = Object.values(players).filter(p => p.exp !== undefined);
    const notFound = Object.values(players).filter(p => p.notFound);
    const errors = Object.values(players).filter(p => p.error);

    let msg = `更新完成: ${valid.length} 个成功`;
    if (notFound.length > 0) msg += `, ${notFound.length} 个未找到`;
    if (errors.length > 0) msg += `, ${errors.length} 个获取失败`;
    if (valid.length === 0 && errors.length > 0) {
      showToast(msg + ' — 数据中转可能已失效，可在「⋮ → 数据中转」检测', 'error');
    } else {
      showToast(msg, 'success');
    }
  } catch (e) {
    showToast('更新失败: ' + e.message, 'error');
  } finally {
    hideLoading();
    refreshBtn.disabled = false;
  }
}

function addPlayers() {
  const text = playerInput.value.trim();
  if (!text) {
    addResult.textContent = '请输入至少一个玩家昵称';
    addResult.className = 'add-result error';
    return;
  }

  const names = text.split(/[,，\n\s]+/).map(s => s.trim()).filter(Boolean);
  if (names.length === 0) {
    addResult.textContent = '请输入有效的昵称';
    addResult.className = 'add-result error';
    return;
  }

  const added = [];
  for (const name of names) {
    if (name && !state.watchlist.some(n => n.toLowerCase() === name.toLowerCase())) {
      state.watchlist.push(name);
      added.push(name);
    }
  }
  saveData();

  if (added.length > 0) {
    addResult.textContent = `成功添加 ${added.length} 个玩家${added.length < names.length ? `（${names.length - added.length} 个已存在）` : ''}`;
    addResult.className = 'add-result success';
    playerInput.value = '';
  } else {
    addResult.textContent = '所有玩家已在关注列表中';
    addResult.className = 'add-result error';
  }
  render();
}

function removePlayer(name) {
  if (!confirm(`确定删除玩家 "${name}" 吗？`)) return;
  state.watchlist = state.watchlist.filter(n => n.toLowerCase() !== name.toLowerCase());
  delete state.players[name];
  delete state.notes[name];
  saveData();
  render();
  showToast('已删除 ' + name);
}

function saveNote(name) {
  const input = document.getElementById('noteInput');
  if (!input) { editingNote = null; return; }
  const note = input.value.trim();
  const oldNote = state.notes[name] || '';
  if (note === oldNote) {
    editingNote = null;
    render();
    return;
  }
  const trimmedNote = note.slice(0, 100);
  if (trimmedNote) {
    state.notes[name] = trimmedNote;
  } else {
    delete state.notes[name];
  }
  saveData();
  editingNote = null;
  render();
  showToast('备注已保存', 'success');
}

// ============================================================
function clearAllData() {
  if (!confirm('确定清空所有数据吗？此操作不可恢复！')) return;
  if (!confirm('再次确认：将删除所有关注玩家、战绩和备注。')) return;
  // 删除全部内容也要留墓碑，否则另一个还开着的窗口一保存就把数据带回来了
  const now = Date.now();
  const p = state.personal || {};
  const deckTombstones = {}, historyTombstones = {}, deckListTombstones = {};
  Object.keys(p.decks || {}).forEach(id => { deckTombstones[id] = now; });
  (p.matchHistory || []).forEach(m => { historyTombstones[m.id] = now; });
  (p.deckList || []).forEach(d => { deckListTombstones[d.id] = now; });
  state = { watchlist: [], lastUpdate: null, players: {}, notes: {},
    personal: {
      playerName: '', currentDeckId: null, decks: {}, matchHistory: [], deckList: [], draftMatch: null,
      deckListTombstones, historyTombstones, deckTombstones,
      historyClearedAt: now,
    } };
  editingHistoryId = null;
  historyEditBuffer = null;
  saveData();
  render();
  renderPersonalSection();
  showToast('所有数据已清空');
}

// ============================================================
// 自动刷新
// ============================================================

function toggleAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    $('autoRefreshStatus').textContent = '关';
    $('autoRefreshStatus').classList.remove('active');
    showToast('已关闭自动刷新');
  } else {
    autoRefreshTimer = setInterval(() => {
      if (state.watchlist.length > 0) refreshData();
    }, AUTO_REFRESH_INTERVAL);
    $('autoRefreshStatus').textContent = '开';
    $('autoRefreshStatus').classList.add('active');
    showToast(`已开启自动刷新（每 ${AUTO_REFRESH_INTERVAL / 60000} 分钟）`, 'success');
  }
}

// ============================================================
// 个人战绩板块
// ============================================================

// --- 对局记录 / 战绩口径 ---
// 手动记录模式：卡组战绩 = 该卡组所有对局记录的胜负合计。
// 记录是唯一事实来源，界面上的数字全部由它现算，所以编辑/删除一条记录后，
// 胜场、胜率、对阵分析会立刻跟着变，不会再出现「数字和列表对不上」。
function entryWins(e) {
  if (!e) return 0;
  if (e.deltaWins) return e.deltaWins;
  return (e.result === 'win' || e.result === '胜') ? 1 : 0;
}

function entryLosses(e) {
  if (!e) return 0;
  if (e.deltaLosses) return e.deltaLosses;
  return (e.result === 'loss' || e.result === '负') ? 1 : 0;
}

function entryTime(e) {
  const t = e && e.time ? Date.parse(e.time) : NaN;
  if (!isNaN(t)) return t;
  return (e && e.updatedAt) || 0;
}

function deckTotalsFromHistory(p) {
  const totals = {};
  (p.matchHistory || []).forEach(e => {
    if (!e || !e.deckId) return;
    const t = totals[e.deckId] || (totals[e.deckId] = { wins: 0, losses: 0, total: 0 });
    t.wins += entryWins(e);
    t.losses += entryLosses(e);
  });
  Object.keys(totals).forEach(id => { totals[id].total = totals[id].wins + totals[id].losses; });
  return totals;
}

function deckTotalsFor(p, deckId) {
  return (deckTotalsFromHistory(p)[deckId]) || { wins: 0, losses: 0, total: 0 };
}

function winRateText(wins, losses) {
  const total = wins + losses;
  return total > 0 ? (wins / total * 100).toFixed(1) + '%' : '--';
}

// 按时间正序逐条累加，得到每条记录「记下那一刻」的累计战绩
// （不去写存储里的 cumulativeXxx，编辑/删除后由这里现算，字段就不会过期）
function cumulativeByEntry(history) {
  const ordered = [...(history || [])].sort((a, b) => entryTime(a) - entryTime(b));
  const running = {};
  const out = {};
  ordered.forEach(e => {
    if (!e || !e.id) return;
    const r = running[e.deckId] || (running[e.deckId] = { wins: 0, losses: 0 });
    r.wins += entryWins(e);
    r.losses += entryLosses(e);
    out[e.id] = { wins: r.wins, losses: r.losses };
  });
  return out;
}

function renderPersonalSection() {
  const p = state.personal || { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] };
  const hasPlayer = !!p.playerName;
  $('personalSection').classList.toggle('has-player', hasPlayer);
  const decks = p.decks || {};
  const deckIds = Object.keys(decks);
  const curDeck = decks[p.currentDeckId];

  // 设置昵称区域
  $('personalSetupMsg').textContent = '';
  if (!hasPlayer) {
    $('personalApiOverview').classList.remove('is-visible');
    $('personalDeckPanel').style.display = 'none';
    $('personalHistory').style.display = 'none';
    $('personalPlayerInput').value = '';
    return;
  }

  $('personalPlayerInput').value = p.playerName;
  $('personalDeckPanel').style.display = 'flex';
  $('personalHistory').style.display = 'block';

  // 渲染卡组选择器
  renderDeckSelector();

  // 渲染当前卡组战绩
  renderDeckStats();

  // 渲染对局历史
  renderHistory();

  // 渲染对阵分析
  renderMatchupAnalysis();

  // 渲染卡组列表管理
  renderDeckListManage();

  // 初始化图标选择器
  $('deckListIconPicker').innerHTML = renderDeckListIcons([]);
  $('deckListSelectedIcons').textContent = '未选择图标';

  // 刷新 API 数据
  refreshApiOverview();
}

// 同一时刻只允许一次刷新在跑，避免并发重复打中转
let apiRefreshInFlight = false;

// 排位 API 现在只是「只读参考」：刷新它只更新排名/积分那几个数字，不写任何对局记录。
// 记录一律由用户在「对局历史」里手动添加（点胜/点负），因此这里不再定时轮询。
let lastApiRefreshAt = 0;

async function refreshApiOverview(opts) {
  opts = opts || {};
  if (apiRefreshInFlight) return;
  const p = state.personal || {};
  if (!p.playerName) return;
  apiRefreshInFlight = true;
  $('personalApiOverview').classList.add('is-visible');
  const defaults = () => {
    $('apiRank').textContent = '--'; $('apiExp').textContent = '--';
    $('apiTotalWin').textContent = '--'; $('apiTotalLose').textContent = '--';
    $('apiWinRate').textContent = '--'; $('apiTotalGames').textContent = '--';
  };
  // 静默刷新时不把已有数字清成「--」，否则界面上会一直闪
  if (!opts.silent) { defaults(); setApiHint(''); }
  try {
    const [data, tops] = await Promise.all([
      fetchPlayer(p.playerName),
      // 排名要拉整张排行榜，比较重；静默刷新时就不拉了，沿用上次的排名
      opts.skipTops ? Promise.resolve(null) : fetchTops().catch(() => []),
    ]);
    if (data && !data.notFound && !data.error) {
      if (Array.isArray(tops)) {
        let rank = null;
        tops.forEach((tp, i) => { if (tp.name === data.name) rank = i + 1; });
        $('apiRank').textContent = rank || '-';
      }
      $('apiExp').textContent = data.exp || '-';
      $('apiTotalWin').textContent = data.win_total_count || '0';
      $('apiTotalLose').textContent = data.lose_total_count || '0';
      const t = (data.win_total_count || 0) + (data.lose_total_count || 0);
      $('apiTotalGames').textContent = t;
      $('apiWinRate').textContent = t > 0 ? ((data.win_total_count / t) * 100).toFixed(1) + '%' : '--';
      setApiHint('');

      const apiWins = data.win_total_count || 0;
      const apiLosses = data.lose_total_count || 0;

      // 只留一份排位参考值，对局历史不动（记录全部由手动添加）
      recordApiSnapshot(apiWins, apiLosses);
      lastApiRefreshAt = Date.now();
      updatePersonalSyncStatus();
      if (!opts.silent) showToast('排位数据已刷新（只读，不会新增对局记录）', 'success');
    } else if (data && data.error) {
      const detail = (data.reasons && data.reasons.length) ? '（' + data.reasons.join('；') + '）' : '';
      setApiHint('⚠️ 刷新排位数据失败：' + data.error + detail + ' — 可在「⋮ → 数据中转」检测可用的中转（只影响上面这几个参考数字，不影响对局记录）。', 'error');
      if (!opts.silent) showToast('刷新排位数据失败：' + data.error, 'error');
    } else if (data && data.notFound) {
      setApiHint('⚠️ 未查询到玩家「' + ((state.personal || {}).playerName || '') + '」的排位数据：昵称需与游戏内完全一致，且该账号至少打过一场排位。', 'warn');
      if (!opts.silent) showToast('未查询到该玩家的排位数据', 'error');
    } else {
      setApiHint('⚠️ 数据获取异常，请稍后重试。', 'warn');
    }
  } catch (e) {
    console.warn('获取个人 API 数据失败:', e);
    setApiHint('⚠️ 刷新排位数据失败：' + e.message, 'error');
    if (!opts.silent) showToast('获取数据失败: ' + e.message, 'error');
  } finally {
    apiRefreshInFlight = false;
  }
}

// 状态角标：说明当前是手动记录模式，顺带显示排位参考值的更新时间
function updatePersonalSyncStatus() {
  const el = $('personalAutoStatus');
  if (!el) return;
  const p = state.personal || {};
  if (!p.playerName) { el.textContent = ''; return; }
  if (!lastApiRefreshAt) { el.textContent = '手动记录 · 排位数据仅作参考'; return; }
  const d = new Date(lastApiRefreshAt);
  el.textContent = `手动记录 · 排位数据更新于 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 排位基准值：只留一份参考数字，不再据此生成任何对局记录
// 排位状态角标仍会用到它，所以照旧写回存储。
function recordApiSnapshot(apiWins, apiLosses) {
  if (!window.PtcgStore) return;
  const merged = PtcgStore.mutate((d) => {
    d.personal.lastApiWins = apiWins;
    d.personal.lastApiLosses = apiLosses;
    return d;
  });
  state = stateFromStore(merged);
  lastWrittenState = JSON.parse(JSON.stringify(merged));
}

function setPersonalPlayer() {
  const input = $('personalPlayerInput');
  const name = input.value.trim();
  if (!name) {
    $('personalSetupMsg').textContent = '请输入游戏昵称';
    $('personalSetupMsg').className = 'add-result error';
    return;
  }
  const firstSetup = !state.personal.playerName;
  state.personal.playerName = name;
  if (firstSetup && (!state.personal.deckList || state.personal.deckList.length === 0)) {
    state.personal.deckList = DEFAULT_DECK_LIST.map(d => ({ id: uuid(), name: d.name, icons: [...d.icons] }));
  }
  if (!state.personal.decks) state.personal.decks = {};
  if (!state.personal.matchHistory) state.personal.matchHistory = [];
  saveData();
  renderPersonalSection();
  refreshApiOverview(); // 顺手拉一次排位参考数据（只读）
  showToast('已设置个人玩家: ' + name, 'success');
}

function createDeck() {
  const input = $('newDeckInput');
  const name = input.value.trim();
  if (!name) { showToast('请输入卡组名称', 'error'); return; }
  if (!state.personal.decks) state.personal.decks = {};

  // 检查重名
  if (Object.values(state.personal.decks).some(d => d.name === name)) {
    showToast('卡组名称已存在', 'error');
    return;
  }

  const id = uuid();
  state.personal.decks[id] = {
    name,
    accumulatedWins: 0, accumulatedLosses: 0,
  };
  if (!state.personal.currentDeckId || !state.personal.decks[state.personal.currentDeckId]) {
    state.personal.currentDeckId = id;
  }
  saveData();
  input.value = '';
  renderDeckList();
  renderDeckSelector();
  renderDeckStats();
  showToast('卡组 "' + name + '" 已创建', 'success');
}

function selectDeck() {
  const val = $('deckSelector').value;
  if (!val || val === state.personal.currentDeckId) return;

  const p = state.personal;
  p.currentDeckId = val;
  const newDeck = p.decks[val];

  saveData();
  renderDeckSelector();
  renderDeckStats();
  renderHistory();
  renderMatchupAnalysis();
  showToast('已切换到卡组: ' + (newDeck ? newDeck.name : ''), 'success');
}

function renameDeck(id) {
  const input = document.getElementById('deckEditInput_' + id);
  if (!input) return;
  const newName = input.value.trim();
  if (!newName) { showToast('名称不能为空', 'error'); return; }
  if (!state.personal.decks[id]) return;

  const oldName = state.personal.decks[id].name;
  if (newName === oldName) { renderDeckList(); return; }

  // 检查重名
  if (Object.values(state.personal.decks).some((d, i) => i !== id && d.name === newName)) {
    showToast('卡组名称已存在', 'error');
    return;
  }

  state.personal.decks[id].name = newName;
  // 更新历史记录中的卡组名
  (state.personal.matchHistory || []).forEach(m => {
    if (m.deckId === id) m.deckName = newName;
  });
  saveData();
  renderDeckList();
  renderDeckSelector();
  renderDeckStats();
  renderHistory();
  showToast('卡组已重命名', 'success');
}

function deleteDeck(id) {
  const deck = state.personal.decks[id];
  if (!deck) return;
  if (!confirm(`确定删除卡组 "${deck.name}" 吗？\n该卡组的战绩和对应历史记录将被一并删除。`)) return;
  const now = Date.now();
  // 显式写墓碑：这样删除才不会被别的窗口的旧快照「复活」
  if (!state.personal.deckTombstones) state.personal.deckTombstones = {};
  if (!state.personal.historyTombstones) state.personal.historyTombstones = {};
  state.personal.deckTombstones[id] = now;
  (state.personal.matchHistory || []).forEach(m => {
    if (m.deckId === id) state.personal.historyTombstones[m.id] = now;
  });
  delete state.personal.decks[id];
  state.personal.matchHistory = (state.personal.matchHistory || []).filter(m => m.deckId !== id);
  if (state.personal.currentDeckId === id) {
    const remaining = Object.keys(state.personal.decks);
    state.personal.currentDeckId = remaining.length > 0 ? remaining[0] : null;
  }
  // 记录卡里若正选着这个卡组，改回「跟随当前卡组」
  if (state.personal.draftMatch && state.personal.draftMatch.deckId === id) {
    state.personal.draftMatch.deckId = null;
  }
  saveData();
  renderDeckList();
  renderDeckSelector();
  renderDeckStats();
  renderHistory();
  renderMatchupAnalysis();
  showToast('卡组已删除', 'success');
}

function clearHistory() {
  if (!confirm('确定清空所有对局历史吗？所有卡组战绩将归零。')) return;
  const p = state.personal;
  const now = Date.now();
  if (!p.historyTombstones) p.historyTombstones = {};
  (p.matchHistory || []).forEach(m => { p.historyTombstones[m.id] = now; });
  p.historyClearedAt = now; // 早于这个时间的记录不会再被旧快照带回来
  p.matchHistory = [];
  p.lastApiWins = undefined;
  p.lastApiLosses = undefined;
  Object.values(p.decks || {}).forEach(d => {
    d.accumulatedWins = 0;
    d.accumulatedLosses = 0;
  });
  saveData();
  renderDeckStats();
  renderDeckSelector();
  renderDeckList();
  renderHistory();
  renderMatchupAnalysis();
  showToast('对局历史已清空');
}

// --- 个人板块局部渲染 ---

function renderDeckSelector() {
  const p = state.personal;
  const decks = p.decks || {};
  const totals = deckTotalsFromHistory(p);
  const sel = $('deckSelector');
  const ids = Object.keys(decks);
  if (ids.length === 0) {
    sel.innerHTML = '<option value="">-- 请先创建卡组 --</option>';
  } else {
    sel.innerHTML = ids.map(id => {
      const d = decks[id];
      const total = (totals[id] || {}).total || 0;
      return `<option value="${id}" ${id === p.currentDeckId ? 'selected' : ''}>${esc(d.name)} (${total}场)</option>`;
    }).join('');
  }
  sel.value = p.currentDeckId || '';
}

function renderDeckStats() {
  const p = state.personal;
  const cur = p.decks && p.decks[p.currentDeckId] ? p.decks[p.currentDeckId] : null;
  if (!cur) {
    $('deckWins').textContent = '0';
    $('deckLosses').textContent = '0';
    $('deckTotal').textContent = '0';
    $('deckWinRate').textContent = '--';
    return;
  }
  // 战绩 = 这个卡组的对局记录合计（手动记录，唯一事实来源）
  const t = deckTotalsFor(p, p.currentDeckId);
  $('deckWins').textContent = t.wins;
  $('deckLosses').textContent = t.losses;
  $('deckTotal').textContent = t.total;
  $('deckWinRate').textContent = winRateText(t.wins, t.losses);
}

function renderDeckList() {
  const p = state.personal;
  const decks = p.decks || {};
  const ids = Object.keys(decks);
  const container = $('deckList');
  if (ids.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">暂无卡组，在上方创建</div>';
    return;
  }
  container.innerHTML = ids.map(id => {
    const d = decks[id];
    const t = deckTotalsFor(p, id);
    const isActive = id === p.currentDeckId;
    return `<div class="deck-item ${isActive ? 'active' : ''}">
      <div class="deck-item-info">
        <span class="deck-item-name">${esc(d.name)}</span>
        <span class="deck-item-meta">${t.wins}胜 ${t.losses}败 · ${t.total}场 · 胜率${winRateText(t.wins, t.losses)}</span>
        ${isActive ? '<span style="font-size:11px;color:var(--accent);">● 当前</span>' : ''}
      </div>
      <div class="deck-item-actions">
        <button class="btn-deck-action" onclick="startRenameDeck('${id}')" title="重命名">✏</button>
        <button class="btn-deck-action danger" onclick="deleteDeck('${id}')" title="删除">🗑</button>
      </div>
    </div>`;
  });
}

function startRenameDeck(id) {
  const d = state.personal.decks[id];
  if (!d) return;
  const container = $('deckList');
  // 找到对应的 deck-item 并替换为输入框
  const items = container.querySelectorAll('.deck-item');
  for (const item of items) {
    const btn = item.querySelector('.btn-deck-action');
    if (btn && btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`startRenameDeck('${id}')`)) {
      item.innerHTML = `<div class="deck-item-info" style="flex:1;">
        <input class="deck-item-edit-input" id="deckEditInput_${id}" value="${esc(d.name)}" maxlength="30"
          onkeydown="if(event.key==='Enter') renameDeck('${id}'); else if(event.key==='Escape') renderDeckList();">
      </div>
      <div class="deck-item-actions">
        <button class="btn-deck-action" onclick="renameDeck('${id}')" title="确认">✓</button>
        <button class="btn-deck-action danger" onclick="renderDeckList()" title="取消">✕</button>
      </div>`;
      setTimeout(() => {
        const inp = document.getElementById('deckEditInput_' + id);
        if (inp) { inp.focus(); inp.select(); }
      }, 50);
      break;
    }
  }
}

function renderDeckListIconGrid(selectedIcons) {
  const icons = selectedIcons || [];
  const term = (deckIconSearchTerm || '').toLowerCase().trim();
  const filtered = term
    ? DECK_ICONS.filter(i => i.name.toLowerCase().includes(term) || i.id.toLowerCase().includes(term))
    : DECK_ICONS;

  return `<div class="pokemon-icon-grid">${filtered.map(i => {
    const isSel = icons.includes(i.id);
    const disabled = !isSel && icons.length >= 2;
    return `<button class="pokemon-icon-btn${isSel ? ' selected' : ''}${disabled ? ' disabled' : ''}"
      onclick="toggleDeckListIcon('${i.id}')" title="${esc(i.name)}">
      <img src="${i.url}" alt="${esc(i.name)}" loading="lazy" style="width:28px;height:28px;object-fit:contain;">
      <span class="icon-name">${esc(i.name)}</span>
    </button>`;
  }).join('')}</div>`;
}

function renderDeckListIcons(selectedIcons) {
  // 输入框已移至 index.html，此处只渲染图标网格
  return renderDeckListIconGrid(selectedIcons);
}

function filterDeckIcons(term) {
  deckIconSearchTerm = term;
  const picker = $('deckListIconPicker');
  if (picker) picker.innerHTML = renderDeckListIconGrid(selectedDeckListIcons);
}

function toggleDeckListIcon(iconId) {
  const idx = selectedDeckListIcons.indexOf(iconId);
  if (idx >= 0) {
    selectedDeckListIcons.splice(idx, 1);
  } else if (selectedDeckListIcons.length < 2) {
    selectedDeckListIcons.push(iconId);
  }
  $('deckListIconPicker').innerHTML = renderDeckListIcons(selectedDeckListIcons);
  $('deckListSelectedIcons').innerHTML = selectedDeckListIcons.length > 0
    ? '已选: ' + renderDeckIcons(selectedDeckListIcons, 20)
    : '未选择图标';
}

function addDeckToList() {
  const input = $('newDeckListInput');
  const name = input.value.trim();
  if (!name) { showToast('请输入卡组名称', 'error'); return; }
  if (!state.personal.deckList) state.personal.deckList = [];
  if (state.personal.deckList.some(d => d.name === name)) {
    showToast('卡组名称已存在', 'error'); return;
  }
  state.personal.deckList.push({
    id: uuid(),
    name,
    icons: [...selectedDeckListIcons],
  });
  saveData();
  input.value = '';
  selectedDeckListIcons = [];
  lastSuggestedDeckIcons = [];
  deckIconSearchTerm = '';
  const searchInput = $('deckIconSearch');
  if (searchInput) searchInput.value = '';
  $('deckListIconPicker').innerHTML = renderDeckListIconGrid([]);
  $('deckListSelectedIcons').textContent = '未选择图标';
  renderDeckListManage();
  renderHistory();
  showToast('卡组 "' + name + '" 已添加到图鉴', 'success');
}

function batchAddDeckToList() {
  const textarea = $('batchDeckListInput');
  const raw = textarea.value.trim();
  if (!raw) { showToast('请输入卡组名称', 'error'); return; }
  if (!state.personal.deckList) state.personal.deckList = [];

  const lines = raw.split(/[\n,，]+/).map(s => s.trim()).filter(Boolean);
  let added = 0, skipped = 0;

  lines.forEach(name => {
    if (state.personal.deckList.some(d => d.name === name)) {
      skipped++;
      return;
    }
    const icons = suggestDeckIconsByName(name);
    state.personal.deckList.push({ id: uuid(), name, icons });
    added++;
  });

  saveData();
  textarea.value = '';
  renderDeckListManage();
  renderHistory();

  const msg = $('batchImportResult');
  if (msg) {
    if (added > 0) msg.textContent = '成功添加 ' + added + ' 个卡组';
    if (skipped > 0) msg.textContent += '，跳过 ' + skipped + ' 个（已存在）';
    if (added === 0) msg.textContent = '所有卡组都已存在，无需重复添加';
    setTimeout(() => { msg.textContent = ''; }, 3000);
  }
  showToast('成功添加 ' + added + ' 个卡组' + (skipped > 0 ? '，' + skipped + ' 个已跳过' : ''), 'success');
}

function removeDeckFromList(id) {
  const entry = (state.personal.deckList || []).find(d => d.id === id);
  if (!entry) return;
  if (!confirm('确定从图鉴中删除 "' + entry.name + '" 吗？\n已有对局记录的对手信息不会丢失。')) return;
  state.personal.deckList = (state.personal.deckList || []).filter(d => d.id !== id);
  saveData();
  renderDeckListManage();
  renderHistory();
  showToast('已删除', 'success');
}

function startEditDeckList(id) {
  editingDeckListId = id;
  deckEditIconSearchTerm = '';
  renderDeckListManage();
}

function saveEditDeckList(id) {
  const input = document.getElementById('deckListEditInput_' + id);
  if (!input) { editingDeckListId = null; renderDeckListManage(); return; }
  const newName = input.value.trim();
  if (!newName) { showToast('名称不能为空', 'error'); return; }
  const entry = (state.personal.deckList || []).find(d => d.id === id);
  if (!entry) { editingDeckListId = null; renderDeckListManage(); return; }
  // 检查重名
  if (state.personal.deckList.some(d => d.id !== id && d.name === newName)) {
    showToast('卡组名称已存在', 'error'); return;
  }
  const oldName = entry.name;
  entry.name = newName;
  // 同步更新对局历史中的对手卡组名称
  (state.personal.matchHistory || []).forEach(h => {
    if (h.opponentDeck === oldName) h.opponentDeck = newName;
  });
  saveData();
  editingDeckListId = null;
  deckEditIconSearchTerm = '';
  renderDeckListManage();
  renderHistory();
  showToast('已更新', 'success');
}

function cancelEditDeckList() {
  editingDeckListId = null;
  deckEditIconSearchTerm = '';
  renderDeckListManage();
}

function toggleDeckListEditIcon(deckId, iconId) {
  const entry = (state.personal.deckList || []).find(d => d.id === deckId);
  if (!entry) return;
  if (!entry.icons) entry.icons = [];
  const idx = entry.icons.indexOf(iconId);
  if (idx >= 0) {
    entry.icons.splice(idx, 1);
  } else if (entry.icons.length < 2) {
    entry.icons.push(iconId);
  }
  saveData();
  renderDeckListManage();
}

let deckEditIconSearchTerm = '';

function filterDeckEditIcons(term) {
  deckEditIconSearchTerm = term;
  const grid = editingDeckListId ? document.getElementById(`deckEditIconGrid_${editingDeckListId}`) : null;
  if (grid) {
    grid.outerHTML = renderDeckEditIconGridOnly(editingDeckListId);
  } else {
    renderDeckListManage();
  }
}

function renderDeckEditIconGridOnly(deckId) {
  const entry = (state.personal.deckList || []).find(d => d.id === deckId);
  const selectedIcons = entry ? (entry.icons || []) : [];
  const term = (deckEditIconSearchTerm || '').toLowerCase().trim();
  const filtered = term
    ? DECK_ICONS.filter(i => i.name.toLowerCase().includes(term) || i.id.toLowerCase().includes(term))
    : DECK_ICONS;

  return `<div class="pokemon-icon-grid" id="deckEditIconGrid_${deckId}">${filtered.map(i => {
    const isSel = selectedIcons.includes(i.id);
    const disabled = !isSel && selectedIcons.length >= 2;
    return `<button class="pokemon-icon-btn${isSel ? ' selected' : ''}${disabled ? ' disabled' : ''}"
      onclick="toggleDeckListEditIcon('${deckId}','${i.id}')" title="${esc(i.name)}">
      <img src="${i.url}" alt="${esc(i.name)}" loading="lazy" style="width:28px;height:28px;object-fit:contain;">
      <span class="icon-name">${esc(i.name)}</span>
    </button>`;
  }).join('')}</div>`;
}

function renderDeckEditIconGrid(deckId) {
  return `<div class="deck-icon-search" style="margin-bottom:8px;">
    <input type="text" id="deckEditIconSearch_${deckId}" class="deck-icon-search-input" placeholder="搜索宝可梦图标..." value="${esc(deckEditIconSearchTerm || '')}"
      oninput="filterDeckEditIcons(this.value)" onclick="event.stopPropagation()">
  </div>` + renderDeckEditIconGridOnly(deckId);
}

function renderDeckListManage() {
  const deckList = state.personal.deckList || [];
  const container = $('deckListEntries');
  if (deckList.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:13px;">暂无对手卡组，在上方添加后，对局历史将可选对手卡组</div>';
    $('deckListCount').textContent = '';
    return;
  }
  container.innerHTML = deckList.map(d => {
    const iconsHtml = renderDeckIcons(d.icons, 20);

    if (editingDeckListId === d.id) {
      return `<div class="deck-list-entry deck-list-entry-editing" style="flex-direction:column;align-items:stretch;border-color:var(--info);background:rgba(59,109,233,0.04);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            ${iconsHtml || '<span style="color:var(--text-muted);font-size:13px;">—</span>'}
            <input class="deck-item-edit-input" id="deckListEditInput_${d.id}" value="${esc(d.name)}" maxlength="30"
              style="width:180px;"
              onkeydown="if(event.key==='Enter'){event.preventDefault();saveEditDeckList('${d.id}');}else if(event.key==='Escape'){cancelEditDeckList();}">
          </div>
          <div class="deck-list-entry-actions">
            <button class="btn-deck-action" onclick="saveEditDeckList('${d.id}')" title="保存">✓</button>
            <button class="btn-deck-action danger" onclick="cancelEditDeckList()" title="取消">✕</button>
          </div>
        </div>
        <div class="deck-list-edit-icons">
          ${renderDeckEditIconGrid(d.id)}
        </div>
      </div>`;
    }

    return `<div class="deck-list-entry">
      <div class="deck-list-entry-info">
        <span class="deck-list-entry-icons">${iconsHtml || '—'}</span>
        <span class="deck-list-entry-name">${esc(d.name)}</span>
      </div>
      <div class="deck-list-entry-actions">
        <button class="btn-deck-action" onclick="startEditDeckList('${d.id}')" title="编辑">✏</button>
        <button class="btn-deck-action danger" onclick="removeDeckFromList('${d.id}')" title="删除">🗑</button>
      </div>
    </div>`;
  }).join('');
  $('deckListCount').textContent = '共 ' + deckList.length + ' 个卡组';
}

function renderMatchupAnalysis() {
  const p = state.personal;
  const curId = p.currentDeckId;
  const el = $('matchupAnalysis');
  const tbody = $('matchupTableBody');

  if (!curId) { el.style.display = 'none'; return; }

  // 收集当前卡组所有有对手信息的对局记录
  const history = (p.matchHistory || []).filter(h => h.deckId === curId && h.opponentDeck);
  if (history.length === 0) { el.style.display = 'none'; return; }

  // 按对手卡组聚合
  const matchup = {};
  history.forEach(h => {
    const opp = h.opponentDeck;
    if (!matchup[opp]) matchup[opp] = { wins: 0, losses: 0 };
    matchup[opp].wins += entryWins(h);
    matchup[opp].losses += entryLosses(h);
  });

  const rows = Object.entries(matchup)
    .map(([name, data]) => {
      const total = data.wins + data.losses;
      const wr = total > 0 ? (data.wins / total * 100) : 0;
      return { name, wins: data.wins, losses: data.losses, total, wr };
    })
    .sort((a, b) => b.total - a.total);

  if (rows.length === 0) { el.style.display = 'none'; return; }

  el.style.display = 'block';
  tbody.innerHTML = rows.map(r => {
    const deckEntry = (p.deckList || []).find(d => d.name === r.name);
    const iconsHtml = deckEntry && deckEntry.icons ? renderDeckIcons(deckEntry.icons, 16) : '';
    const wrColor = r.wr >= 60 ? 'var(--accent)' : r.wr >= 40 ? 'var(--warning)' : 'var(--danger)';
    return `<tr>
      <td><span class="matchup-opp-name">${iconsHtml ? '<span style="font-size:14px;">' + iconsHtml + '</span>' : ''}${esc(r.name)}</span></td>
      <td class="matchup-total">${r.total}</td>
      <td class="matchup-win">${r.wins}</td>
      <td class="matchup-loss">${r.losses}</td>
      <td>
        <div class="matchup-wr-bar">
          <div class="matchup-wr-track"><div class="matchup-wr-fill" style="width:${Math.min(100, r.wr)}%;background:${wrColor}"></div></div>
          <span style="font-weight:700;color:${wrColor};">${r.wr.toFixed(1)}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ============================================================
// 手动记录对局（记录卡 + 对局列表）
// ============================================================

// 这条记录的胜负方向（'win' / 'loss' / null 表示还没填）
function resultOfEntry(e) {
  const w = entryWins(e);
  const l = entryLosses(e);
  if (w > 0 && w >= l) return 'win';
  if (l > 0 && l >= w) return 'loss';
  return null;
}

function formatEntryTime(e) {
  const t = entryTime(e);
  if (!t) return '';
  const d = new Date(t);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 记录卡表单：存在存储里（沿用 draftMatch 字段），刷新、悬浮窗、换标签页都不会丢
function ensureRecordForm() {
  const p = state.personal;
  if (!p.draftMatch || typeof p.draftMatch !== 'object') {
    p.draftMatch = { deckId: null, firstMove: null, opponentDeck: '' };
    saveData();
  }
  const f = p.draftMatch;
  if (f.deckId === undefined) f.deckId = null;
  if (f.firstMove === undefined) f.firstMove = null;
  if (f.opponentDeck === undefined) f.opponentDeck = '';
  return f;
}

// 这一局记到哪个卡组：表单里选了就用它，没选就跟随「当前卡组」
function recordTargetDeckId() {
  const p = state.personal;
  const f = ensureRecordForm();
  if (f.deckId && p.decks && p.decks[f.deckId]) return f.deckId;
  return p.currentDeckId;
}

function renderRecordCard(form, deckList, decks) {
  const ids = Object.keys(decks || {});
  if (ids.length === 0) {
    return `<div class="history-item record-card">
      <span class="draft-tag">记</span>
      <span style="font-size:13px;color:var(--text-muted);">先在上方「⚙ 管理」里建一个卡组，之后就能在这里记录对局了</span>
    </div>`;
  }

  const targetId = (form.deckId && decks[form.deckId]) ? form.deckId : (state.personal.currentDeckId || '');
  const deckOptions = ids.map(id => {
    const sel = id === targetId ? ' selected' : '';
    return `<option value="${esc(id)}"${sel}>${esc(decks[id].name)}</option>`;
  }).join('');

  const opp = form.opponentDeck || '';
  const oppOptions = (deckList || []).map(dl => {
    const sel = dl.name === opp ? ' selected' : '';
    return `<option value="${esc(dl.name)}"${sel}>${esc(dl.name)}</option>`;
  }).join('');

  const turnBtn = (turn, label, cls) => {
    const active = form.firstMove === turn;
    return `<button class="btn-turn ${active ? cls : 'gray'}" onclick="setRecordTurn('${turn}')" title="再点一次取消">${label}</button>`;
  };

  return `<div class="history-item record-card">
    <div class="record-fields">
      <span class="draft-tag" title="手动记录">记</span>
      <span class="record-label">我方</span>
      <select class="history-opponent-select" id="recordDeckSelect" onchange="setRecordDeck(this.value)" title="这一局用的卡组">${deckOptions}</select>
      <span class="record-sep"></span>
      <span class="record-label">先后手</span>
      <span class="history-turn">${turnBtn('first', '先', 'active')}${turnBtn('second', '后', 'active second')}</span>
      <span class="record-sep"></span>
      <span class="record-label">对手</span>
      <select class="history-opponent-select" id="recordOpponentSelect" onchange="setRecordOpponent(this.value)" title="对手用的卡组，可留空">
        <option value="">${opp ? '-- 清空 --' : '+ 选择对手卡组'}</option>
        ${oppOptions}
      </select>
    </div>
    <div class="record-buttons">
      <button class="btn-result win" onclick="recordMatch('win')">胜</button>
      <button class="btn-result loss" onclick="recordMatch('loss')">负</button>
      <button class="btn-history-action danger" onclick="resetRecordForm()" title="清空上面选的内容">✕</button>
    </div>
  </div>`;
}

// 记一局：点「胜」或「负」落一条记录，战绩立刻重算
function recordMatch(result) {
  const p = state.personal;
  const form = ensureRecordForm();
  const deckId = recordTargetDeckId();
  const deck = deckId ? (p.decks || {})[deckId] : null;
  if (!deck) { showToast('请先创建并选择一个卡组', 'error'); return; }

  const entry = {
    id: uuid(),
    deckId,
    deckName: deck.name,
    deltaWins: result === 'win' ? 1 : 0,
    deltaLosses: result === 'loss' ? 1 : 0,
    result,
    manual: true,
    time: new Date().toISOString(),
  };
  if (form.firstMove) entry.firstMove = form.firstMove;
  if (form.opponentDeck) entry.opponentDeck = form.opponentDeck;

  if (!p.matchHistory) p.matchHistory = [];
  p.matchHistory.push(entry);
  // 对手每局都不一样，记完就清掉，免得下一局误带上；先后手保留（同一轮多半一致）
  form.opponentDeck = '';

  saveData();
  renderDeckStats();
  renderDeckSelector();
  renderDeckList();
  renderMatchupAnalysis();
  renderHistory();

  const list = $('historyList');
  if (list) list.scrollTop = 0;
  const t = deckTotalsFor(state.personal, deckId);
  showToast(`已记录：${deck.name} ${result === 'win' ? '胜' : '负'} · 现${t.wins}胜${t.losses}败`, 'success');
}

function setRecordTurn(turn) {
  const f = ensureRecordForm();
  f.firstMove = f.firstMove === turn ? null : turn; // 再点一次＝取消
  saveData();
  renderHistory();
}

// 下面两个只改选择、不重画列表：重画会把刚选好的下拉框重建掉
function setRecordDeck(val) {
  ensureRecordForm().deckId = val || null;
  saveData();
}

function setRecordOpponent(val) {
  ensureRecordForm().opponentDeck = val || '';
  saveData();
}

function resetRecordForm() {
  state.personal.draftMatch = { deckId: null, firstMove: null, opponentDeck: '' };
  saveData();
  renderHistory();
}

// 从「记一局对局」按钮滚到记录卡
function focusRecordCard() {
  const card = $('personalHistory');
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.classList.remove('flash');
  void card.offsetWidth; // 重启动画
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1400);
  const list = $('historyList');
  if (list) list.scrollTop = 0;
}

function historyTurnBadges(id, firstMove) {
  const firstCls = firstMove === 'first' ? 'btn-turn active' : (firstMove ? 'btn-turn gray' : 'btn-turn');
  const secondCls = firstMove === 'second' ? 'btn-turn active second' : (firstMove ? 'btn-turn gray' : 'btn-turn second');
  return `<button class="${firstCls}" onclick="editHistoryEntry('${esc(id)}')" title="点击修改先后手">先</button>` +
         `<button class="${secondCls}" onclick="editHistoryEntry('${esc(id)}')" title="点击修改先后手">后</button>`;
}

function renderHistoryItem(h, deckList, cum) {
  const timeStr = formatEntryTime(h);
  const result = resultOfEntry(h);
  const resultClass = result === 'win' ? 'win' : (result === 'loss' ? 'loss' : '');
  const resultText = result === 'win' ? '胜' : (result === 'loss' ? '负' : '-');
  const cumHtml = cum
    ? `<span class="history-cumulative">累计 ${cum.wins}胜 ${cum.losses}败</span>`
    : '<span class="history-cumulative">旧版记录</span>';

  // 编辑态：改动先进缓冲区，点 ✓ 才落盘
  if (editingHistoryId === h.id && historyEditBuffer) {
    const buf = historyEditBuffer;
    const oppOptions = (deckList || []).map(dl => {
      const sel = dl.name === buf.opponentDeck ? ' selected' : '';
      return `<option value="${esc(dl.name)}"${sel}>${esc(dl.name)}</option>`;
    }).join('');
    return `<div class="history-item history-item-editing">
      <div class="history-left">
        <span class="history-deck-name">${esc(h.deckName)}</span>
        <span class="history-turn">
          <button class="btn-turn ${buf.firstMove === 'first' ? 'active' : 'gray'}" onclick="editSetTurn('first')" title="设为先手（再点一次取消）">先</button>
          <button class="btn-turn ${buf.firstMove === 'second' ? 'active second' : 'gray'}" onclick="editSetTurn('second')" title="设为后手（再点一次取消）">后</button>
        </span>
        <span class="history-turn">
          <button class="btn-turn ${buf.result === 'win' ? 'active' : 'gray'}" onclick="editSetResult('win')" title="改成胜">胜</button>
          <button class="btn-turn ${buf.result === 'loss' ? 'active lose' : 'gray'}" onclick="editSetResult('loss')" title="改成负">负</button>
        </span>
        <select class="history-opponent-select" id="histEditSelect_${esc(h.id)}" onchange="editSetOpponent(this.value)">
          <option value="">-- 对手未知 --</option>
          ${oppOptions}
        </select>
        <span class="history-time">${timeStr}</span>
      </div>
      <div class="history-right">
        <button class="btn-history-action" onclick="commitHistoryEdit()" title="保存">✓</button>
        <button class="btn-history-action danger" onclick="cancelHistoryEdit()" title="取消">✕</button>
        <button class="btn-history-action danger" onclick="deleteHistoryEntry('${esc(h.id)}')" title="删除这条记录">🗑</button>
      </div>
    </div>`;
  }

  const opponentDeck = h.opponentDeck || '';
  const deckEntry = opponentDeck ? (deckList || []).find(dl => dl.name === opponentDeck) : null;
  const opponentIcons = deckEntry ? renderDeckIcons(deckEntry.icons, 18) : '';
  const opponentHtml = opponentDeck
    ? `<span class="history-opponent" onclick="editHistoryEntry('${esc(h.id)}')" style="cursor:pointer;" title="点击编辑这条记录">${opponentIcons} vs ${esc(opponentDeck)}</span>`
    : `<span class="history-opponent empty" onclick="editHistoryEntry('${esc(h.id)}')" title="点击编辑这条记录">+ 对手卡组</span>`;

  return `<div class="history-item">
    <div class="history-left">
      <span class="history-deck-name">${esc(h.deckName)}</span>
      <span class="history-turn">${historyTurnBadges(h.id, h.firstMove)}</span>
      <span class="history-result ${resultClass}" onclick="editHistoryEntry('${esc(h.id)}')" style="cursor:pointer;" title="点击修改这一局的胜负">${resultText}</span>
      ${cumHtml}
      <span class="history-time">${timeStr}</span>
    </div>
    <div class="history-right">
      ${opponentHtml}
      <button class="btn-history-action" onclick="editHistoryEntry('${esc(h.id)}')" title="编辑这条记录">✏</button>
      <button class="btn-history-action danger row-del" onclick="deleteHistoryEntry('${esc(h.id)}')" title="删除这条记录">🗑</button>
    </div>
  </div>`;
}

function renderHistory() {
  const p = state.personal;
  const history = p.matchHistory || [];
  const listContainer = $('historyList');
  const deckList = p.deckList || [];
  const cumById = cumulativeByEntry(history);

  // 记录卡永远排在列表最上面
  const recordHtml = renderRecordCard(ensureRecordForm(), deckList, p.decks || {});
  // 倒序显示（最新的在上面）
  const ordered = [...history].sort((a, b) => entryTime(b) - entryTime(a));
  listContainer.innerHTML = recordHtml + ordered.map(h => renderHistoryItem(h, deckList, cumById[h.id])).join('');

  const emptyEl = $('historyEmpty');
  if (emptyEl) emptyEl.style.display = 'none';
}

// ============================================================
// 编辑 / 删除一条对局记录
// ============================================================

// 编辑缓冲区：改先后手/胜负/对手都先记在这里，点 ✓ 才写进存储
let historyEditBuffer = null;

function editHistoryEntry(id) {
  const entry = (state.personal.matchHistory || []).find(h => h.id === id);
  if (!entry) return;
  editingHistoryId = id;
  historyEditBuffer = {
    id,
    firstMove: entry.firstMove || null,
    result: resultOfEntry(entry),
    opponentDeck: entry.opponentDeck || '',
  };
  renderHistory();
  const sel = document.getElementById('histEditSelect_' + id);
  if (sel) sel.focus();
}

function editSetTurn(turn) {
  if (!historyEditBuffer) return;
  historyEditBuffer.firstMove = historyEditBuffer.firstMove === turn ? null : turn;
  renderHistory();
}

function editSetResult(result) {
  if (!historyEditBuffer) return;
  historyEditBuffer.result = historyEditBuffer.result === result ? null : result;
  renderHistory();
}

// 改下拉框不重画：重画会把刚选好的 select 重建掉
function editSetOpponent(val) {
  if (historyEditBuffer) historyEditBuffer.opponentDeck = val || '';
}

function commitHistoryEdit() {
  const buf = historyEditBuffer;
  const entry = buf ? (state.personal.matchHistory || []).find(h => h.id === buf.id) : null;
  if (!buf || !entry) { cancelHistoryEdit(); return; }

  // 胜负方向没变就别动原有的数字：旧记录可能是 2 胜 0 负（一次记了两局）
  if (buf.result !== resultOfEntry(entry)) {
    if (buf.result === 'win') {
      entry.deltaWins = 1; entry.deltaLosses = 0; entry.result = 'win';
    } else if (buf.result === 'loss') {
      entry.deltaWins = 0; entry.deltaLosses = 1; entry.result = 'loss';
    } else {
      delete entry.deltaWins; delete entry.deltaLosses; delete entry.result;
    }
  } else if (buf.result) {
    entry.result = buf.result;
  }

  if (buf.firstMove) entry.firstMove = buf.firstMove; else delete entry.firstMove;
  if (buf.opponentDeck) entry.opponentDeck = buf.opponentDeck; else delete entry.opponentDeck;

  editingHistoryId = null;
  historyEditBuffer = null;
  saveData();
  renderDeckStats();
  renderDeckSelector();
  renderDeckList();
  renderMatchupAnalysis();
  renderHistory();
  showToast('记录已更新', 'success');
}

function cancelHistoryEdit() {
  editingHistoryId = null;
  historyEditBuffer = null;
  renderHistory();
}

function deleteHistoryEntry(id) {
  const p = state.personal;
  const entry = (p.matchHistory || []).find(h => h.id === id);
  if (!entry) return;
  const r = resultOfEntry(entry);
  const label = `${entry.deckName || ''} ${r === 'win' ? '胜' : (r === 'loss' ? '负' : '未填胜负')}`;
  if (!confirm(`删除这条记录吗？\n${label} · ${formatEntryTime(entry)}`)) return;

  p.matchHistory = (p.matchHistory || []).filter(h => h.id !== id);
  // 删除写墓碑：另一个还开着的窗口用旧快照保存时不会把它带回来
  if (!p.historyTombstones) p.historyTombstones = {};
  p.historyTombstones[id] = Date.now();
  if (editingHistoryId === id) { editingHistoryId = null; historyEditBuffer = null; }

  saveData();
  renderDeckStats();
  renderDeckSelector();
  renderDeckList();
  renderMatchupAnalysis();
  renderHistory();
  showToast('记录已删除');
}

function pad(n) { return String(n).padStart(2, '0'); }

function openDeckManage() {
  $('deckManagePanel').style.display = 'block';
  renderDeckList();
}

function closeDeckManage() {
  $('deckManagePanel').style.display = 'none';
}

// ============================================================
// 渲染
// ============================================================

function render() {
  $('lastUpdate').textContent = formatTime(state.lastUpdate);

  const watchlist = state.watchlist;
  const players = state.players;

  if (watchlist.length === 0) {
    emptyState.style.display = 'block';
    tableContainer.style.display = 'none';
    if (mobileList) mobileList.style.display = 'none';
    statsSection.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';

  // 收集玩家数据
  let rows = watchlist.map(name => {
    const p = players[name];
    if (!p) return { name, key: name, pending: true };
    return { ...p, key: name };
  });

  // 搜索过滤
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    rows = rows.filter(r => {
      const name = r.name.toLowerCase();
      const note = (state.notes[r.key] || '').toLowerCase();
      return name.includes(term) || note.includes(term);
    });
  }

  // 排序
  rows.sort((a, b) => {
    if (a.pending && !b.pending) return 1;
    if (!a.pending && b.pending) return -1;
    if (a.pending && b.pending) return a.name.localeCompare(b.name);

    const aBad = a.notFound || a.error;
    const bBad = b.notFound || b.error;
    if (aBad && !bBad) return 1;
    if (!aBad && bBad) return -1;

    switch (currentSort) {
      case 'exp': return (b.exp || 0) - (a.exp || 0);
      case 'winRate': return (b.winRate || 0) - (a.winRate || 0);
      case 'winTotal': return (b.winTotal || 0) - (a.winTotal || 0);
      case 'rank':
        if (a.rank && b.rank) return a.rank - b.rank;
        if (a.rank) return -1;
        if (b.rank) return 1;
        return 0;
      case 'name': return a.name.localeCompare(b.name);
      default: return 0;
    }
  });

  if (mobileList && isMobileView()) {
    tableContainer.style.display = 'none';
    mobileList.style.display = 'flex';
    mobileList.innerHTML = rows.map(row => renderMobileRow(row)).join('');
  } else {
    if (mobileList) mobileList.style.display = 'none';
    tableContainer.style.display = 'block';
    playerTableBody.innerHTML = rows.map(row => renderRow(row)).join('');
  }
  renderStats(rows);
}

function renderRow(row) {
  if (row.pending) {
    return `<tr class="row-pending">
      <td class="col-rank"><span class="rank-badge rank-none">-</span></td>
      <td class="col-name"><span class="player-name">${esc(row.name)}</span></td>
      <td class="col-note">${renderNoteCell(row.key)}</td>
      <td colspan="6" style="color:var(--text-muted);font-size:13px;">点击"更新数据"获取玩家信息</td>
    </tr>`;
  }

  if (row.notFound) {
    return `<tr class="row-notfound">
      <td class="col-rank"><span class="rank-badge rank-none">-</span></td>
      <td class="col-name"><span class="player-name">${esc(row.name)}</span></td>
      <td class="col-note">${renderNoteCell(row.key)}</td>
      <td colspan="5"><span class="status-badge badge-notfound">未找到该玩家（可能未进行排位赛）</span></td>
      <td class="col-action">${deleteBtn(row.key)}</td>
    </tr>`;
  }

  if (row.error) {
    return `<tr class="row-error">
      <td class="col-rank"><span class="rank-badge rank-none">-</span></td>
      <td class="col-name"><span class="player-name">${esc(row.name)}</span></td>
      <td class="col-note">${renderNoteCell(row.key)}</td>
      <td colspan="5"><span class="status-badge badge-error">查询失败: ${esc(row.error)}</span></td>
      <td class="col-action">${deleteBtn(row.key)}</td>
    </tr>`;
  }

  // 正常数据
  const rank = row.rank;
  let rankHtml;
  if (rank === 1) rankHtml = `<span class="rank-badge rank-1">1</span>`;
  else if (rank === 2) rankHtml = `<span class="rank-badge rank-2">2</span>`;
  else if (rank === 3) rankHtml = `<span class="rank-badge rank-3">3</span>`;
  else if (rank) rankHtml = `<span class="rank-badge rank-other">${rank}</span>`;
  else rankHtml = `<span class="rank-badge rank-none">未上榜</span>`;

  const wr = row.winRate;
  const wrCls = winRateClass(wr);
  const wrColor = winRateColor(wr);

  // 连胜/连败
  let streakHtml;
  if (row.winTemp > 0) {
    streakHtml = `<span class="streak-win">🔥${row.winTemp}连胜</span><span class="streak-max">(最高${row.winMax})</span>`;
  } else if (row.loseTemp > 0) {
    streakHtml = `<span class="streak-lose">💧${row.loseTemp}连败</span><span class="streak-max">(最高${row.loseMax})</span>`;
  } else {
    streakHtml = `<span class="streak-zero">-</span>`;
  }

  return `<tr>
    <td class="col-rank">${rankHtml}</td>
    <td class="col-name"><span class="player-name">${esc(row.name)}</span></td>
    <td class="col-note">${renderNoteCell(row.key)}</td>
    <td class="col-exp">
      <span class="exp-value">${row.exp}</span>
      <span class="exp-highest">最高 ${row.highestExp}</span>
    </td>
    <td class="col-win"><span class="win-count">${row.winTotal}</span></td>
    <td class="col-lose"><span class="lose-count">${row.loseTotal}</span></td>
    <td class="col-rate">
      <div class="winrate-bar">
        <div class="winrate-track"><div class="winrate-fill" style="width:${wr}%;background:${wrColor}"></div></div>
        <span class="winrate-text ${wrCls}">${wr}%</span>
      </div>
    </td>
    <td class="col-games"><span class="games-count">${row.totalGames}</span></td>
    <td class="col-streak"><div class="streak-display">${streakHtml}</div></td>
    <td class="col-action">${deleteBtn(row.key)}</td>
  </tr>`;
}

// 移动端视图判断（窄屏时用卡片列表替代表格）
const mobileMedia = window.matchMedia('(max-width: 768px)');
function isMobileView() {
  return mobileMedia.matches;
}

function mobileRankHtml(row) {
  const rank = row.rank;
  if (rank === 1) return `<span class="rank-badge rank-1">1</span>`;
  if (rank === 2) return `<span class="rank-badge rank-2">2</span>`;
  if (rank === 3) return `<span class="rank-badge rank-3">3</span>`;
  if (rank) return `<span class="rank-badge rank-other">${rank}</span>`;
  return `<span class="rank-badge rank-none">未上榜</span>`;
}

function renderMobileRow(row) {
  const top = `<div class="mpc-top">
      <div class="mpc-rank">${mobileRankHtml(row)}</div>
      <div class="mpc-name"><span class="player-name">${esc(row.name)}</span></div>
      <div class="mpc-delete">${deleteBtn(row.key)}</div>
    </div>`;

  if (row.pending) {
    return `<div class="mobile-player-card row-pending">${top}<div class="mpc-status">点击"更新数据"获取玩家信息</div></div>`;
  }
  if (row.notFound) {
    return `<div class="mobile-player-card row-notfound">${top}<div class="mpc-status"><span class="status-badge badge-notfound">未找到该玩家（可能未进行排位赛）</span></div></div>`;
  }
  if (row.error) {
    return `<div class="mobile-player-card row-error">${top}<div class="mpc-status"><span class="status-badge badge-error">查询失败: ${esc(row.error)}</span></div></div>`;
  }

  const wr = row.winRate;
  const wrCls = winRateClass(wr);
  const wrColor = winRateColor(wr);

  let streakHtml;
  if (row.winTemp > 0) {
    streakHtml = `<span class="streak-win">🔥${row.winTemp}连胜</span><span class="streak-max">(最高${row.winMax})</span>`;
  } else if (row.loseTemp > 0) {
    streakHtml = `<span class="streak-lose">💧${row.loseTemp}连败</span><span class="streak-max">(最高${row.loseMax})</span>`;
  } else {
    streakHtml = `<span class="streak-zero">-</span>`;
  }

  return `<div class="mobile-player-card">
    ${top}
    <div class="mpc-meta">
      <div class="meta-item"><span class="meta-label">积分</span><span><span class="exp-value">${row.exp}</span> <span class="exp-highest">最高 ${row.highestExp}</span></span></div>
      <div class="meta-item"><span class="meta-label">胜场</span><span class="win-count">${row.winTotal}</span></div>
      <div class="meta-item"><span class="meta-label">败场</span><span class="lose-count">${row.loseTotal}</span></div>
      <div class="meta-item"><span class="meta-label">总场数</span><span class="games-count">${row.totalGames}</span></div>
      <div class="meta-item"><span class="meta-label">胜率</span><span class="winrate-bar"><span class="winrate-track"><span class="winrate-fill" style="width:${wr}%;background:${wrColor}"></span></span><span class="winrate-text ${wrCls}">${wr}%</span></span></div>
    </div>
    <div class="mpc-note">${renderNoteCell(row.key)}</div>
    <div class="mpc-streak">${streakHtml}</div>
  </div>`;
}

function deleteBtn(name) {
  return `<button class="btn-delete" onclick="removePlayer('${esc(name)}')" title="删除">✕</button>`;
}

function renderNoteCell(name) {
  const note = state.notes[name] || '';
  if (editingNote === name) {
    return `<input class="note-input" id="noteInput" value="${esc(note)}" onkeydown="noteKeydown(event,'${esc(name)}')" onblur="saveNote('${esc(name)}')" placeholder="输入备注..." maxlength="100">`;
  }
  if (note) {
    return `<span class="note-text" onclick="editNote('${esc(name)}')" title="点击编辑">${esc(note)}</span>`;
  }
  return `<span class="note-empty" onclick="editNote('${esc(name)}')">＋备注</span>`;
}

function renderStats(rows) {
  const valid = rows.filter(r => r.exp !== undefined && !r.notFound && !r.error);
  statsSection.style.display = valid.length > 0 ? 'grid' : 'none';
  if (valid.length === 0) return;

  const totalWins = valid.reduce((s, r) => s + r.winTotal, 0);
  const totalLosses = valid.reduce((s, r) => s + r.loseTotal, 0);
  const avgWr = valid.length > 0
    ? (valid.reduce((s, r) => s + r.winRate, 0) / valid.length).toFixed(1)
    : '--';

  $('statTotal').textContent = rows.length;
  $('statAvgWinRate').textContent = avgWr + '%';
  $('statTotalWins').textContent = totalWins;
  $('statTotalLosses').textContent = totalLosses;
}

// ============================================================
// 工具函数
// ============================================================

function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// 个人战绩上方的状态提示（中转故障 / 玩家不存在时给出明确原因）
function setApiHint(msg, type) {
  const el = $('apiHint');
  if (!el) return;
  if (!msg) { el.style.display = 'none'; el.textContent = ''; el.className = 'api-hint'; return; }
  el.textContent = msg;
  el.className = 'api-hint ' + (type || 'warn');
  el.style.display = 'block';
}

function showLoading(text) {
  loadingText.textContent = text;
  loadingOverlay.style.display = 'flex';
}

function hideLoading() {
  loadingOverlay.style.display = 'none';
}

function formatTime(iso) {
  if (!iso) return '尚未更新';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function winRateClass(rate) {
  if (rate >= 60) return 'wr-high';
  if (rate >= 50) return 'wr-mid';
  return 'wr-low';
}

function winRateColor(rate) {
  if (rate >= 60) return '#4ecca3';
  if (rate >= 50) return '#f5a623';
  return '#e74c3c';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// 事件绑定
// ============================================================

refreshBtn.addEventListener('click', refreshData);
addBtn.addEventListener('click', addPlayers);
playerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    addPlayers();
  }
});
sortBy.addEventListener('change', () => {
  currentSort = sortBy.value;
  render();
});
searchInput.addEventListener('input', (e) => {
  searchTerm = e.target.value.trim();
  render();
});

// 个人板块事件
$('personalSetPlayerBtn').addEventListener('click', setPersonalPlayer);
$('personalPlayerInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); setPersonalPlayer(); }
});
$('personalRefreshApiBtn').addEventListener('click', refreshApiOverview);
$('goRecordBtn').addEventListener('click', focusRecordCard);
$('deckSelector').addEventListener('change', selectDeck);
$('manageDecksBtn').addEventListener('click', openDeckManage);
$('closeDeckManageBtn').addEventListener('click', closeDeckManage);
$('addDeckBtn').addEventListener('click', createDeck);
$('newDeckInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); createDeck(); }
});
$('clearHistoryBtn').addEventListener('click', clearHistory);
$('addDeckListBtn').addEventListener('click', addDeckToList);
$('toggleDeckListBtn').addEventListener('click', () => {
  const body = $('deckListEntriesBody');
  const btn = $('toggleDeckListBtn');
  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    btn.textContent = '收起 ▲';
  } else {
    body.classList.add('collapsed');
    btn.textContent = '展开 ▼';
  }
});
$('batchAddDeckListBtn').addEventListener('click', batchAddDeckToList);
$('newDeckListInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addDeckToList(); }
});
$('newDeckListInput').addEventListener('input', (e) => {
  const name = e.target.value;
  const suggestions = suggestDeckIconsByName(name);

  // 仅在用户未手动调整选择时自动应用推荐
  const currentKey = JSON.stringify([...selectedDeckListIcons].sort());
  const lastKey = JSON.stringify([...lastSuggestedDeckIcons].sort());
  if (selectedDeckListIcons.length === 0 || currentKey === lastKey) {
    selectedDeckListIcons = [...suggestions];
  }
  lastSuggestedDeckIcons = [...suggestions];

  $('deckListIconPicker').innerHTML = renderDeckListIconGrid(selectedDeckListIcons);
  $('deckListSelectedIcons').innerHTML = selectedDeckListIcons.length > 0
    ? '已选: ' + renderDeckIcons(selectedDeckListIcons, 20)
    : '未选择图标';
});

// 暴露全局函数（onclick 调用）
window.removePlayer = removePlayer;
window.editNote = function (name) {
  editingNote = name;
  render();
  const input = document.getElementById('noteInput');
  if (input) { input.focus(); input.select(); }
};
window.noteKeydown = function (e, name) {
  if (e.key === 'Enter') { e.preventDefault(); saveNote(name); }
  else if (e.key === 'Escape') { editingNote = null; render(); }
};
window.saveNote = saveNote;

// 个人板块全局函数
window.deleteDeck = deleteDeck;
window.renameDeck = renameDeck;
window.startRenameDeck = startRenameDeck;
window.renderDeckList = renderDeckList;
// 对局记录：手动记录 + 编辑/删除
window.recordMatch = recordMatch;
window.setRecordTurn = setRecordTurn;
window.setRecordDeck = setRecordDeck;
window.setRecordOpponent = setRecordOpponent;
window.resetRecordForm = resetRecordForm;
window.editHistoryEntry = editHistoryEntry;
window.editSetTurn = editSetTurn;
window.editSetResult = editSetResult;
window.editSetOpponent = editSetOpponent;
window.commitHistoryEdit = commitHistoryEdit;
window.cancelHistoryEdit = cancelHistoryEdit;
window.deleteHistoryEntry = deleteHistoryEntry;
window.toggleDeckListIcon = toggleDeckListIcon;
window.removeDeckFromList = removeDeckFromList;
window.startEditDeckList = startEditDeckList;
window.saveEditDeckList = saveEditDeckList;
window.cancelEditDeckList = cancelEditDeckList;
window.toggleDeckListEditIcon = toggleDeckListEditIcon;

// 菜单
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  menuDropdown.style.display = menuDropdown.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', () => {
  menuDropdown.style.display = 'none';
});
menuDropdown.addEventListener('click', (e) => e.stopPropagation());

$('autoRefreshToggle').addEventListener('click', toggleAutoRefresh);
$('clearBtn').addEventListener('click', () => {
  menuDropdown.style.display = 'none';
  clearAllData();
});

// ============================================================
// 数据中转：设置自建中转 + 一键检测
// ============================================================

function renderRelayList(items, results) {
  const box = $('relayList');
  if (!box) return;
  box.innerHTML = items.map((p) => {
    let status = '<span class="relay-status unknown">未检测</span>';
    const r = results && results[p.id];
    if (r) {
      status = r.ok
        ? `<span class="relay-status ok">✓ ${r.ms}ms</span>`
        : `<span class="relay-status fail" title="${esc(r.err || '')}">✕ ${esc(String(r.err || '失败').slice(0, 24))}</span>`;
    }
    return `<div class="relay-row"><span class="relay-name">${esc(p.name)}${p.id === 'custom' ? '（自建）' : ''}</span>${status}</div>`;
  }).join('');
}

function openRelayModal() {
  $('customRelayInput').value = getCustomRelay();
  $('relayMsg').textContent = '';
  $('relayMsg').className = 'paste-msg';
  renderRelayList(activeProxies(), null);
  $('relayModal').style.display = 'flex';
}

function closeRelayModal() {
  $('relayModal').style.display = 'none';
}

function saveCustomRelay() {
  const v = $('customRelayInput').value.trim();
  try {
    if (v) localStorage.setItem(RELAY_STORAGE_KEY, v);
    else localStorage.removeItem(RELAY_STORAGE_KEY);
    localStorage.removeItem(RELAY_OK_KEY); // 换过中转，之前记住的成功记录作废
  } catch (e) {
    /* localStorage 不可用时忽略 */
  }
  lastWorkingRelayId = '';
  renderRelayList(activeProxies(), null);
  $('relayMsg').textContent = v ? '已保存，将优先使用这个中转' : '已清空，使用默认中转列表';
  $('relayMsg').className = 'paste-msg success';
}

async function testRelays() {
  const items = activeProxies();
  const results = {};
  const url = `${PTCG_BASE}/api/rank/player/tops`;
  $('relayTestBtn').disabled = true;
  $('relayMsg').textContent = `检测中…（每个中转最多等待 ${Math.round(RELAY_TIMEOUT_MS / 1000)} 秒）`;
  $('relayMsg').className = 'paste-msg';

  for (const p of items) {
    renderRelayList(items, results);
    const t0 = Date.now();
    const r = await tryOneRelay(p, url, {}, new AbortController());
    results[p.id] = r.kind === 'data'
      ? { ok: true, ms: Date.now() - t0 }
      : { ok: false, err: String(r.reason || '失败').replace(p.name + ': ', '') };
  }
  renderRelayList(items, results);

  const okList = items.filter((p) => results[p.id] && results[p.id].ok);
  if (okList.length) {
    $('relayMsg').textContent = `可用中转 ${okList.length} 个：${okList.map((p) => p.name).join('、')}（刷新排位数据时它们会同时发起，谁快用谁）`;
    $('relayMsg').className = 'paste-msg success';
  } else {
    $('relayMsg').textContent = '公共中转全部不可用。建议按 RELAY.md 自建一个中转后填在上方；若这里能连上而刷新排位数据仍失败，多半是浏览器插件或代理挡住了这些域名。';
    $('relayMsg').className = 'paste-msg error';
  }
  $('relayTestBtn').disabled = false;
}

$('relayMenuBtn').addEventListener('click', () => {
  menuDropdown.style.display = 'none';
  openRelayModal();
});
$('relayModalClose').addEventListener('click', closeRelayModal);
$('relayTestBtn').addEventListener('click', testRelays);
$('relaySaveBtn').addEventListener('click', saveCustomRelay);
$('relayModal').addEventListener('click', (e) => {
  if (e.target === $('relayModal')) closeRelayModal();
});

// 启动时把「上次成功的中转」显示在菜单徽标上，一眼就能看出当前在用哪个
(function showLastRelayOnStart() {
  const badge = $('relayStatus');
  const id = preferredRelayId();
  if (!badge || !id) return;
  const target = activeProxies().find((p) => p.id === id);
  if (target) badge.textContent = target.name;
})();

// 悬浮窗
// ============================================================

let popupWindow = null;
const syncChannel = new BroadcastChannel('ptcg-sync');

// 打开悬浮窗（优先使用 PiP 强制置顶，不支持时回退到普通窗口）
$('popupBtn').addEventListener('click', async () => {
  // 关闭旧窗口，确保下次打开时加载最新代码
  if (popupWindow && !popupWindow.closed) {
    popupWindow.close();
    popupWindow = null;
  }

  // 每次用时间戳参数，彻底绕过浏览器缓存
  const popupUrl = 'popup.html?v=' + Date.now();
  const miniPopup = localStorage.getItem('ptcg-popup-mode') !== 'detail';
  const popupWidth = miniPopup ? 200 : 400;
  const popupHeight = miniPopup ? 200 : 620;

  // 优先：Document Picture-in-Picture API — 始终置顶于所有窗口之上
  if ('documentPictureInPicture' in window) {
    try {
      const pipWindow = await documentPictureInPicture.requestWindow({
        width: popupWidth,
        height: popupHeight,
      });

      // 将 popup.html 内容写入 PiP 窗口
      const resp = await fetch(popupUrl);
      let html = await resp.text();
      // 注入 <base> 修复相对路径（PiP 窗口的 base URL 是 about:blank）
      html = html.replace('</head>', '<base href="' + location.href.replace(/\/[^/]*$/, '/') + '"></head>');
      pipWindow.document.write(html);
      pipWindow.document.close();

      // 应用当前主题到 PiP 窗口
      const currentTheme = getTheme();
      pipWindow.document.documentElement.setAttribute('data-theme', currentTheme);

      popupWindow = pipWindow;

      pipWindow.addEventListener('pagehide', () => {
        popupWindow = null;
      });

      showToast('悬浮窗已置顶打开', 'success');
      return;
    } catch (e) {
      console.warn('PiP 打开失败，回退到普通窗口:', e);
    }
  }

  // 回退：普通浏览器窗口（不置顶）
  popupWindow = window.open(popupUrl, 'ptcg-popup',
    'width=' + popupWidth + ',height=' + popupHeight + ',left=' + (screen.width - popupWidth - 20) + ',top=100');
  if (popupWindow) {
    const checkClosed = setInterval(() => {
      if (popupWindow.closed) { popupWindow = null; clearInterval(checkClosed); }
    }, 500);
  }
});

// 监听 popup 的刷新请求和主题切换
syncChannel.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'refresh-request') {
    refreshApiOverview();
  }
  if (e.data && e.data.type === 'deck-changed') {
    // Popup 切换了卡组，重新加载数据以同步
    loadData();
    renderPersonalSection();
  }
  if (e.data && e.data.type === 'theme-changed') {
    // Popup 切了主题，主页面同步
    setTheme(e.data.theme);
  }
});

// 数据更新后通知 popup
function notifyPopupDataUpdated() {
  syncChannel.postMessage({ type: 'data-updated' });
}

// 心跳：每 10 秒发送一次，让 popup 知道主页面还活着
setInterval(() => {
  syncChannel.postMessage({ type: 'heartbeat' });
}, 10000);

// 监听其他窗口（如 popup）对 localStorage 的修改
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) {
    loadData();
    renderPersonalSection();
  }
  if (e.key === 'ptcg-theme') {
    const theme = e.newValue || 'light';
    setTheme(theme);
  }
});

// ============================================================
// 主题切换
// ============================================================

const THEME_KEY = 'ptcg-theme';

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('themeBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀' : '🌙';
}

function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  syncChannel.postMessage({ type: 'theme-changed', theme: next });
}

$('themeBtn').addEventListener('click', toggleTheme);

// 初始化主题
applyTheme(getTheme());

// 在 saveData 后通知 popup（本地窗口 storage 事件不会触发，用 BroadcastChannel 补上）
const _originalSaveData = saveData;
saveData = function () {
  _originalSaveData.apply(null, arguments);
  notifyPopupDataUpdated();
};

// 在 refreshApiOverview 成功后弹出 toast 前也通知 popup
const _originalRefreshApiOverview = refreshApiOverview;
refreshApiOverview = async function () {
  await _originalRefreshApiOverview.apply(null, arguments); // 透传 {silent, skipTops}
  // notifyPopupDataUpdated 已在 saveData 中调用
};

// ============================================================
// 屏幕宽度变化时切换表格 / 卡片列表
let mobileResizeTimer = null;
mobileMedia.addEventListener('change', () => {
  clearTimeout(mobileResizeTimer);
  mobileResizeTimer = setTimeout(() => render(), 150);
});

// ============================================================
// 初始化
// ============================================================

loadData();
render();
renderPersonalSection();
// 对局记录由玩家手动添加；云端同步由 cloud.js 管理。
