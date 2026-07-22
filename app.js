// ============================================================
// PTCG 玩家追踪器 - 纯前端版
// 数据保存在 localStorage，API 通过 CORS 代理调用
// ============================================================

const PTCG_BASE = 'https://ptcg.mivm.cn';
// CORS 代理列表（按优先级尝试）
const CORS_PROXIES = [
  (url) => `https://proxy.cors.sh/${url}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

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

// --- 工具函数 ---
function uuid() {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16));
}

// --- 状态 ---
let state = {
  watchlist: [], lastUpdate: null, players: {}, notes: {},
  personal: { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] }
};
let currentSort = 'exp';
let editingNote = null;
let editingHistoryId = null;
let selectedDeckListIcons = [];
let editingDeckListId = null;
let deckIconSearchTerm = '';
let searchTerm = '';
let autoRefreshTimer = null;
let workingProxyIdx = 0; // 当前可用的代理索引

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

// ============================================================
// 数据持久化 (localStorage)
// ============================================================

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state = {
        watchlist: data.watchlist || [],
        lastUpdate: data.lastUpdate || null,
        players: data.players || {},
        notes: data.notes || {},
        personal: data.personal || { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] },
      };
      // 初始化 deckList
      if (!state.personal.deckList) state.personal.deckList = [];
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
        // 迁移旧版历史记录格式
        if (state.personal.matchHistory) {
          state.personal.matchHistory = state.personal.matchHistory.filter(h => {
            if (h.result !== undefined && h.deltaWins === undefined) {
              // 旧版手动记录无法迁移为差分格式，丢弃
              return false;
            }
            return true;
          });
        }
        if (migrated) saveData();
      }
    }
  } catch (e) {
    console.error('加载数据失败:', e);
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      watchlist: state.watchlist,
      lastUpdate: state.lastUpdate,
      players: state.players,
      notes: state.notes,
      personal: state.personal,
    }));
  } catch (e) {
    console.error('保存数据失败:', e);
    showToast('数据保存失败，可能存储空间不足', 'error');
  }
}

// ============================================================
// PTCG API 调用 (通过 CORS 代理)
// ============================================================

async function fetchViaProxy(targetUrl) {
  // 尝试从上次成功的代理开始
  const tried = new Set();
  for (let attempt = 0; attempt < CORS_PROXIES.length; attempt++) {
    const idx = (workingProxyIdx + attempt) % CORS_PROXIES.length;
    if (tried.has(idx)) continue;
    tried.add(idx);
    const proxyUrl = CORS_PROXIES[idx](targetUrl);
    try {
      const resp = await fetch(proxyUrl, {
        headers: { 'Accept': 'application/json' },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      workingProxyIdx = idx; // 记住可用的代理
      return data;
    } catch (e) {
      // 继续尝试下一个代理
      continue;
    }
  }
  throw new Error('所有代理均不可用，请稍后重试');
}

async function fetchPlayer(screenName) {
  const url = `${PTCG_BASE}/api/rank/player/query?screen_name=${encodeURIComponent(screenName)}`;
  try {
    const data = await fetchViaProxy(url);
    return data;
  } catch (e) {
    // 检查是否 404（玩家不存在）
    return { notFound: true, name: screenName };
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
    if (errors.length > 0) msg += `, ${errors.length} 个失败`;
    showToast(msg, 'success');
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
// 导入/导出
// ============================================================

function exportData() {
  const data = {
    watchlist: state.watchlist,
    lastUpdate: state.lastUpdate,
    players: state.players,
    notes: state.notes,
    personal: state.personal,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ptcg-tracker-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('数据已导出', 'success');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      applyImportedData(data);
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function applyImportedData(data) {
  if (!Array.isArray(data.watchlist)) throw new Error('文件格式不正确');
  state.watchlist = data.watchlist || [];
  state.lastUpdate = data.lastUpdate || null;
  state.players = data.players || {};
  state.notes = data.notes || {};
  state.personal = data.personal || { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] };
  if (!state.personal.deckList) state.personal.deckList = [];
  saveData();
  render();
  renderPersonalSection();
  showToast('数据导入成功', 'success');
}

// 粘贴导入
function openPasteModal() {
  $('pasteModal').style.display = 'flex';
  $('pasteInput').value = '';
  $('pasteMsg').textContent = '';
  $('pasteMsg').className = 'paste-msg';
  setTimeout(() => $('pasteInput').focus(), 100);
}

function closePasteModal() {
  $('pasteModal').style.display = 'none';
}

function confirmPasteImport() {
  const raw = $('pasteInput').value.trim();
  if (!raw) {
    $('pasteMsg').textContent = '请先粘贴数据';
    $('pasteMsg').className = 'paste-msg error';
    return;
  }
  try {
    let data;
    // 支持粘贴原始 localStorage JSON 字符串或已格式化的 JSON
    if (raw.startsWith('{')) {
      data = JSON.parse(raw);
    } else {
      // 可能是双重编码的字符串
      data = JSON.parse(JSON.parse(raw));
    }
    applyImportedData(data);
    closePasteModal();
  } catch (err) {
    $('pasteMsg').textContent = '数据格式错误，请确认完整粘贴: ' + err.message;
    $('pasteMsg').className = 'paste-msg error';
  }
}

function clearAllData() {
  if (!confirm('确定清空所有数据吗？此操作不可恢复！')) return;
  if (!confirm('再次确认：将删除所有关注玩家、战绩和备注。')) return;
  state = { watchlist: [], lastUpdate: null, players: {}, notes: {},
    personal: { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] } };
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

function renderPersonalSection() {
  const p = state.personal || { playerName: '', currentDeckId: null, decks: {}, matchHistory: [] };
  const hasPlayer = !!p.playerName;
  const decks = p.decks || {};
  const deckIds = Object.keys(decks);
  const curDeck = decks[p.currentDeckId];

  // 设置昵称区域
  $('personalSetupMsg').textContent = '';
  if (!hasPlayer) {
    $('personalApiOverview').style.display = 'none';
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

async function refreshApiOverview() {
  const p = state.personal || {};
  if (!p.playerName) return;
  $('personalApiOverview').style.display = 'flex';
  const defaults = () => {
    $('apiRank').textContent = '--'; $('apiExp').textContent = '--';
    $('apiTotalWin').textContent = '--'; $('apiTotalLose').textContent = '--';
    $('apiWinRate').textContent = '--'; $('apiTotalGames').textContent = '--';
  };
  defaults();
  try {
    const [data, tops] = await Promise.all([
      fetchPlayer(p.playerName),
      fetchTops().catch(() => []),
    ]);
    if (data && !data.notFound && !data.error) {
      // 排行榜排名
      let rank = null;
      if (Array.isArray(tops)) {
        tops.forEach((tp, i) => { if (tp.name === data.name) rank = i + 1; });
      }
      $('apiRank').textContent = rank || '-';
      $('apiExp').textContent = data.exp || '-';
      $('apiTotalWin').textContent = data.win_total_count || '0';
      $('apiTotalLose').textContent = data.lose_total_count || '0';
      const t = (data.win_total_count || 0) + (data.lose_total_count || 0);
      $('apiTotalGames').textContent = t;
      $('apiWinRate').textContent = t > 0 ? ((data.win_total_count / t) * 100).toFixed(1) + '%' : '--';

      // --- 差分追踪：计算本次 API 与上次的差额，分配给当前卡组 ---
      const apiWins = data.win_total_count || 0;
      const apiLosses = data.lose_total_count || 0;

      if (p.lastApiWins !== undefined) {
        const deltaWins = apiWins - p.lastApiWins;
        const deltaLosses = apiLosses - p.lastApiLosses;

        // 只在差额非负且有变化时记录
        if (deltaWins >= 0 && deltaLosses >= 0 && (deltaWins > 0 || deltaLosses > 0)) {
          const curDeck = p.decks && p.decks[p.currentDeckId];
          if (curDeck) {
            curDeck.accumulatedWins = (curDeck.accumulatedWins || 0) + deltaWins;
            curDeck.accumulatedLosses = (curDeck.accumulatedLosses || 0) + deltaLosses;
            curDeck.snapshotWins = apiWins;
            curDeck.snapshotLosses = apiLosses;

            if (!p.matchHistory) p.matchHistory = [];
            p.matchHistory.push({
              id: uuid(),
              deckId: p.currentDeckId,
              deckName: curDeck.name,
              deltaWins,
              deltaLosses,
              cumulativeWins: curDeck.accumulatedWins,
              cumulativeLosses: curDeck.accumulatedLosses,
              time: new Date().toISOString(),
            });
          }
        } else if (deltaWins < 0 || deltaLosses < 0) {
          // 数据回退（如跨赛季），只更新快照不累加
          console.warn('API 数据回退，跳过差额记录');
        }
      }

      // 更新最后 API 值
      p.lastApiWins = apiWins;
      p.lastApiLosses = apiLosses;
      saveData();
      renderDeckStats();
      renderDeckSelector();
      renderHistory();
      renderMatchupAnalysis();
      showToast('战绩已获取，已自动分配差额', 'success');
    }
  } catch (e) {
    console.warn('获取个人 API 数据失败:', e);
    showToast('获取数据失败: ' + e.message, 'error');
  }
}

function setPersonalPlayer() {
  const input = $('personalPlayerInput');
  const name = input.value.trim();
  if (!name) {
    $('personalSetupMsg').textContent = '请输入游戏昵称';
    $('personalSetupMsg').className = 'add-result error';
    return;
  }
  state.personal.playerName = name;
  if (!state.personal.decks) state.personal.decks = {};
  if (!state.personal.matchHistory) state.personal.matchHistory = [];
  saveData();
  renderPersonalSection();
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
  const p = state.personal;
  state.personal.decks[id] = {
    name,
    accumulatedWins: 0, accumulatedLosses: 0,
    snapshotWins: p.lastApiWins ?? 0,
    snapshotLosses: p.lastApiLosses ?? 0,
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

  // 结算旧卡组：将最后一次 API 到当前的差额计入旧卡组
  settleCurrentDeck();

  // 切换并给新卡组拍快照
  p.currentDeckId = val;
  const newDeck = p.decks[val];
  if (newDeck) {
    newDeck.snapshotWins = p.lastApiWins ?? 0;
    newDeck.snapshotLosses = p.lastApiLosses ?? 0;
  }

  saveData();
  renderDeckSelector();
  renderDeckStats();
  renderHistory();
  renderMatchupAnalysis();
  showToast('已切换到卡组: ' + (newDeck ? newDeck.name : ''), 'success');
}

// 结算当前卡组：将 lastApi - snapshot 的差额累加到 accumulated
function settleCurrentDeck() {
  const p = state.personal;
  if (!p.currentDeckId) return;
  const deck = p.decks[p.currentDeckId];
  if (!deck) return;
  if (p.lastApiWins === undefined && p.lastApiLosses === undefined) return;

  const apiW = p.lastApiWins || 0;
  const apiL = p.lastApiLosses || 0;
  const snapW = deck.snapshotWins || 0;
  const snapL = deck.snapshotLosses || 0;

  const deltaW = apiW - snapW;
  const deltaL = apiL - snapL;

  if (deltaW > 0 || deltaL > 0) {
    deck.accumulatedWins = (deck.accumulatedWins || 0) + Math.max(0, deltaW);
    deck.accumulatedLosses = (deck.accumulatedLosses || 0) + Math.max(0, deltaL);
  }
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
  delete state.personal.decks[id];
  state.personal.matchHistory = (state.personal.matchHistory || []).filter(m => m.deckId !== id);
  if (state.personal.currentDeckId === id) {
    const remaining = Object.keys(state.personal.decks);
    state.personal.currentDeckId = remaining.length > 0 ? remaining[0] : null;
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
  p.matchHistory = [];
  p.lastApiWins = undefined;
  p.lastApiLosses = undefined;
  Object.values(p.decks || {}).forEach(d => {
    d.accumulatedWins = 0;
    d.accumulatedLosses = 0;
    d.snapshotWins = 0;
    d.snapshotLosses = 0;
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
  const sel = $('deckSelector');
  const ids = Object.keys(decks);
  if (ids.length === 0) {
    sel.innerHTML = '<option value="">-- 请先创建卡组 --</option>';
  } else {
    sel.innerHTML = ids.map(id => {
      const d = decks[id];
      const accW = d.accumulatedWins || 0;
      const accL = d.accumulatedLosses || 0;
      const total = accW + accL;
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
  // 当前实时战绩 = 累计 + (最近一次API - 快照)
  const accW = cur.accumulatedWins || 0;
  const accL = cur.accumulatedLosses || 0;
  const apiW = p.lastApiWins ?? (cur.snapshotWins ?? 0);
  const apiL = p.lastApiLosses ?? (cur.snapshotLosses ?? 0);
  const snapW = cur.snapshotWins || 0;
  const snapL = cur.snapshotLosses || 0;

  const currentW = accW + Math.max(0, apiW - snapW);
  const currentL = accL + Math.max(0, apiL - snapL);

  $('deckWins').textContent = currentW;
  $('deckLosses').textContent = currentL;
  $('deckTotal').textContent = currentW + currentL;
  $('deckWinRate').textContent = (currentW + currentL) > 0 ? (currentW / (currentW + currentL) * 100).toFixed(1) + '%' : '--';
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
    const accW = d.accumulatedWins || 0;
    const accL = d.accumulatedLosses || 0;
    const total = accW + accL;
    const wr = total > 0 ? (accW / total * 100).toFixed(1) : '--';
    const isActive = id === p.currentDeckId;
    return `<div class="deck-item ${isActive ? 'active' : ''}">
      <div class="deck-item-info">
        <span class="deck-item-name">${esc(d.name)}</span>
        <span class="deck-item-meta">${accW}胜 ${accL}败 · ${total}场 · 胜率${wr}%</span>
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

function renderDeckListIcons(selectedIcons) {
  const icons = selectedIcons || [];
  const term = (deckIconSearchTerm || '').toLowerCase().trim();
  const filtered = term
    ? DECK_ICONS.filter(i => i.name.toLowerCase().includes(term) || i.id.toLowerCase().includes(term))
    : DECK_ICONS;

  let html = `<div class="deck-icon-search">
    <input type="text" id="deckIconSearch" class="deck-icon-search-input" placeholder="搜索宝可梦图标..." value="${esc(deckIconSearchTerm || '')}"
      oninput="filterDeckIcons(this.value)" onclick="event.stopPropagation()">
  </div>`;

  html += `<div class="pokemon-icon-grid">${filtered.map(i => {
    const isSel = icons.includes(i.id);
    const disabled = !isSel && icons.length >= 2;
    return `<button class="pokemon-icon-btn${isSel ? ' selected' : ''}${disabled ? ' disabled' : ''}"
      onclick="toggleDeckListIcon('${i.id}')" title="${esc(i.name)}">
      <img src="${i.url}" alt="${esc(i.name)}" loading="lazy" style="width:28px;height:28px;object-fit:contain;">
      <span class="icon-name">${esc(i.name)}</span>
    </button>`;
  }).join('')}</div>`;

  return html;
}

function filterDeckIcons(term) {
  deckIconSearchTerm = term;
  $('deckListIconPicker').innerHTML = renderDeckListIcons(selectedDeckListIcons);
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
  deckIconSearchTerm = '';
  $('deckListIconPicker').innerHTML = renderDeckListIcons([]);
  $('deckListSelectedIcons').textContent = '未选择图标';
  renderDeckListManage();
  renderHistory();
  showToast('卡组 "' + name + '" 已添加到图鉴', 'success');
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
  renderDeckListManage();
}

function renderDeckEditIconGrid(deckId) {
  const entry = (state.personal.deckList || []).find(d => d.id === deckId);
  const selectedIcons = entry ? (entry.icons || []) : [];
  const term = (deckEditIconSearchTerm || '').toLowerCase().trim();
  const filtered = term
    ? DECK_ICONS.filter(i => i.name.toLowerCase().includes(term) || i.id.toLowerCase().includes(term))
    : DECK_ICONS;

  let html = `<div class="deck-icon-search" style="margin-bottom:8px;">
    <input type="text" id="deckEditIconSearch_${deckId}" class="deck-icon-search-input" placeholder="搜索宝可梦图标..." value="${esc(deckEditIconSearchTerm || '')}"
      oninput="filterDeckEditIcons(this.value)" onclick="event.stopPropagation()">
  </div>`;

  html += `<div class="pokemon-icon-grid">${filtered.map(i => {
    const isSel = selectedIcons.includes(i.id);
    const disabled = !isSel && selectedIcons.length >= 2;
    return `<button class="pokemon-icon-btn${isSel ? ' selected' : ''}${disabled ? ' disabled' : ''}"
      onclick="toggleDeckListEditIcon('${deckId}','${i.id}')" title="${esc(i.name)}">
      <img src="${i.url}" alt="${esc(i.name)}" loading="lazy" style="width:28px;height:28px;object-fit:contain;">
      <span class="icon-name">${esc(i.name)}</span>
    </button>`;
  }).join('')}</div>`;

  return html;
}

function renderDeckListManage() {
  const deckList = state.personal.deckList || [];
  const container = $('deckListEntries');
  if (deckList.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:13px;">暂无对手卡组，在上方添加后，对局历史将可选对手卡组</div>';
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
    matchup[opp].wins += (h.deltaWins || 0);
    matchup[opp].losses += (h.deltaLosses || 0);
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

function renderHistory() {
  const p = state.personal;
  const history = p.matchHistory || [];
  const listContainer = $('historyList');
  const emptyEl = $('historyEmpty');
  const deckList = p.deckList || [];

  if (history.length === 0) {
    listContainer.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';

  // 倒序显示（最新的在上面）
  const reversed = [...history].reverse();
  listContainer.innerHTML = reversed.map(h => {
    const d = new Date(h.time);
    const timeStr = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const opponentDeck = h.opponentDeck || '';

    // 下拉选项（select 不支持图片，仅显示名称）
    const selectOptions = deckList.map(dl => {
      const sel = dl.name === opponentDeck ? ' selected' : '';
      return `<option value="${esc(dl.name)}"${sel}>${esc(dl.name)}</option>`;
    }).join('');

    // 编辑模式
    if (editingHistoryId === h.id) {
      return `<div class="history-item history-item-editing">
        <div class="history-left">
          <span class="history-deck-name">${esc(h.deckName)}</span>
          <span class="history-delta">+${h.deltaWins || 0}胜 +${h.deltaLosses || 0}败</span>
          <span class="history-cumulative">→ 累计 ${h.cumulativeWins || 0}胜 ${h.cumulativeLosses || 0}败</span>
          <span class="history-time">${timeStr}</span>
        </div>
        <div class="history-right">
          <select class="history-opponent-select" id="histEditSelect_${esc(h.id)}">
            <option value="">-- 未设置 --</option>
            ${selectOptions}
          </select>
          <button class="btn-history-action" onclick="saveHistoryOpponent('${esc(h.id)}')" title="保存">✓</button>
          <button class="btn-history-action danger" onclick="cancelEditHistory()" title="取消">✕</button>
        </div>
      </div>`;
    }

    // 正常显示模式
    const deckEntry = opponentDeck ? (deckList.find(dl => dl.name === opponentDeck)) : null;
    const opponentIcons = deckEntry ? renderDeckIcons(deckEntry.icons, 18) : '';
    const opponentHtml = opponentDeck
      ? `<span class="history-opponent" onclick="editHistoryOpponent('${esc(h.id)}')" style="cursor:pointer;" title="点击修改">${opponentIcons} vs ${esc(opponentDeck)}</span>`
      : `<span class="history-opponent empty" onclick="editHistoryOpponent('${esc(h.id)}')">+ 对手卡组</span>`;

    return `<div class="history-item">
      <div class="history-left">
        <span class="history-deck-name">${esc(h.deckName)}</span>
        <span class="history-delta">+${h.deltaWins || 0}胜 +${h.deltaLosses || 0}败</span>
        <span class="history-cumulative">→ 累计 ${h.cumulativeWins || 0}胜 ${h.cumulativeLosses || 0}败</span>
        <span class="history-time">${timeStr}</span>
      </div>
      <div class="history-right">
        ${opponentHtml}
      </div>
    </div>`;
  }).join('');
}

function editHistoryOpponent(id) {
  editingHistoryId = id;
  renderHistory();
  const sel = document.getElementById('histEditSelect_' + id);
  if (sel) sel.focus();
}

function cancelEditHistory() {
  editingHistoryId = null;
  editingDeckListId = null;
  renderHistory();
  renderDeckListManage();
}

function saveHistoryOpponent(id) {
  const sel = document.getElementById('histEditSelect_' + id);
  if (!sel) { editingHistoryId = null; renderHistory(); return; }
  const val = sel.value;
  const history = state.personal.matchHistory || [];
  const entry = history.find(h => h.id === id);
  if (entry) {
    if (val) {
      entry.opponentDeck = val;
    } else {
      delete entry.opponentDeck;
    }
    saveData();
    showToast('对手卡组已更新', 'success');
  }
  editingHistoryId = null;
  renderHistory();
  renderMatchupAnalysis();
}

function exportHistory() {
  const history = state.personal.matchHistory || [];
  if (history.length === 0) {
    showToast('暂无对局历史可导出', 'error');
    return;
  }

  const headers = ['时间', '使用卡组', '胜场增量', '败场增量', '累计胜场', '累计败场', '对手卡组'];
  const rows = history.map(h => {
    const d = new Date(h.time);
    const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return [
      timeStr,
      h.deckName || '',
      h.deltaWins || 0,
      h.deltaLosses || 0,
      h.cumulativeWins || 0,
      h.cumulativeLosses || 0,
      h.opponentDeck || '',
    ];
  });

  // CSV with BOM for Excel Chinese support
  const csv = '\uFEFF' + [headers, ...rows].map(r =>
    r.map(cell => {
      const s = String(cell);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ptcg-对局历史-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`已导出 ${history.length} 条对局历史`, 'success');
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
    statsSection.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  tableContainer.style.display = 'block';

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

  playerTableBody.innerHTML = rows.map(row => renderRow(row)).join('');
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
$('personalFetchBtn').addEventListener('click', refreshApiOverview);
$('deckSelector').addEventListener('change', selectDeck);
$('manageDecksBtn').addEventListener('click', openDeckManage);
$('closeDeckManageBtn').addEventListener('click', closeDeckManage);
$('addDeckBtn').addEventListener('click', createDeck);
$('newDeckInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); createDeck(); }
});
$('clearHistoryBtn').addEventListener('click', clearHistory);
$('exportHistoryBtn').addEventListener('click', () => {
  exportHistory();
});
$('addDeckListBtn').addEventListener('click', addDeckToList);
$('newDeckListInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addDeckToList(); }
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
window.editHistoryOpponent = editHistoryOpponent;
window.saveHistoryOpponent = saveHistoryOpponent;
window.cancelEditHistory = cancelEditHistory;
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
$('exportBtn').addEventListener('click', () => {
  menuDropdown.style.display = 'none';
  exportData();
});
$('importBtn').addEventListener('click', () => {
  menuDropdown.style.display = 'none';
  openPasteModal();
});
$('clearBtn').addEventListener('click', () => {
  menuDropdown.style.display = 'none';
  clearAllData();
});

// 头部直接可见的导出/导入按钮
$('exportBtn2').addEventListener('click', exportData);
$('importBtn2').addEventListener('click', openPasteModal);

// 个人战绩模块导出/导入按钮
$('exportAllBtn').addEventListener('click', exportData);
$('importAllBtn').addEventListener('click', openPasteModal);
$('importFile').addEventListener('change', (e) => {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = '';
});

// 粘贴导入弹窗事件
$('pasteModalClose').addEventListener('click', closePasteModal);
$('pasteCancelBtn').addEventListener('click', closePasteModal);
$('pasteConfirmBtn').addEventListener('click', confirmPasteImport);
$('pasteModal').addEventListener('click', (e) => {
  if (e.target === $('pasteModal')) closePasteModal();
});
$('pasteInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) confirmPasteImport();
});

// ============================================================
// 悬浮窗
// ============================================================

let popupWindow = null;
const syncChannel = new BroadcastChannel('ptcg-sync');

// 打开悬浮窗（优先使用 PiP 强制置顶，不支持时回退到普通窗口）
$('popupBtn').addEventListener('click', async () => {
  if (popupWindow && !popupWindow.closed) {
    popupWindow.focus();
    return;
  }

  // 优先：Document Picture-in-Picture API — 始终置顶于所有窗口之上
  if ('documentPictureInPicture' in window) {
    try {
      const pipWindow = await documentPictureInPicture.requestWindow({
        width: 400,
        height: 560,
      });

      // 将 popup.html 内容写入 PiP 窗口
      const resp = await fetch('popup.html');
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
  popupWindow = window.open('popup.html', 'ptcg-popup',
    'width=380,height=520,left=' + (screen.width - 400) + ',top=100');
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
  _originalSaveData();
  notifyPopupDataUpdated();
};

// 在 refreshApiOverview 成功后弹出 toast 前也通知 popup
const _originalRefreshApiOverview = refreshApiOverview;
refreshApiOverview = async function () {
  await _originalRefreshApiOverview();
  // notifyPopupDataUpdated 已在 saveData 中调用
};

// ============================================================
// 初始化
// ============================================================

loadData();
render();
renderPersonalSection();
