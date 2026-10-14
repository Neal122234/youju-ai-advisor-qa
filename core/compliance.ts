// 合规规则引擎（确定性，零依赖）。输入侧：词表+正则+启发式区分"教育性问题"与"越界请求"；输出侧：扫描违规表述（带否定/引用豁免）。
//
// 核心启发式（写在这里便于评审追溯）：
//  1) 个股实体/指代（6 位代码、常见股票名、"XX股份/集团/控股"、这只/该股/个股/我的股票、行业板块）
//     + 买卖/仓位动词 / 评价词（怎么样/值不值得/估值高吗）/ 涨跌动词 → 越界（stock_pick / price_prediction），教育句式也不豁免。
//     例外：实体 + 纯流程词（最少买多少股/怎么买/手续费）且无评价、无时点、无涨跌 → 按规则作答（不构成推荐）。
//  2) 大盘/指数/板块 + 预测性表述（会涨吗/走势/点位/明天…）→ price_prediction；"什么是牛市"这类教育句式豁免。
//  3) 无实体时：情态+交易动词（该不该/能不能/适合 + 买/卖/抄底/上车）需再满足"时点/盈亏条件/个人持仓/句末省略指代/黑话"之一才算越界；
//     "新手可以买基金吗""没开通权限能买科创板股票吗"属于规则/适当性科普 → 教育。
//  4) 纯概念问句（什么是/是什么意思/怎么理解/有什么风险/违法吗/如何识别/为什么不能）+ 无个股实体 → 教育，不命中。
//  5) 多子句问题逐句判定：既有越界子句、又有可作答的知识子句 → mixed（partial_refusal）；只有越界 → refuse。
import type { ComplianceCategory, ComplianceHit } from './types';
import { financeTermsIn, normalizeText } from './tokenize';

type Sev = ComplianceHit['severity'];

/* ---------------- 词表 ---------------- */
export const STOCK_NAMES = [
  '贵州茅台', '茅台', '五粮液', '泸州老窖', '山西汾酒', '汾酒', '洋河股份', '宁德时代', '宁德', '比亚迪', '隆基绿能', '隆基', '通威股份', '阳光电源',
  '中国平安', '平安银行', '招商银行', '招行', '工商银行', '工行', '建设银行', '建行', '农业银行', '农行', '中国银行', '交通银行', '兴业银行', '浦发银行',
  '民生银行', '宁波银行', '中信银行', '光大银行', '邮储银行', '中信证券', '东方财富', '东财', '华泰证券', '中金公司', '中芯国际', '寒武纪', '海光信息',
  '北方华创', '中微公司', '韦尔股份', '立讯精密', '京东方', '海康威视', '科大讯飞', '中兴通讯', '工业富联', '浪潮信息', '紫金矿业', '洛阳钼业', '中国神华',
  '长江电力', '中国石油', '中石油', '中国石化', '中石化', '中国移动', '中国电信', '中国联通', '万科', '保利发展', '格力电器', '格力', '美的集团', '海尔智家',
  '伊利股份', '伊利', '海天味业', '片仔癀', '恒瑞医药', '恒瑞', '迈瑞医疗', '迈瑞', '药明康德', '爱尔眼科', '智飞生物', '长春高新', '云南白药', '同仁堂',
  '中国中免', '牧原股份', '牧原', '温氏股份', '三一重工', '中国中车', '中国船舶', '中航沈飞', '航发动力', '赛力斯', '长城汽车', '长安汽车', '上汽集团',
  '小米集团', '小米', '腾讯控股', '腾讯', '阿里巴巴', '阿里', '美团', '京东', '拼多多', '百度', '网易', '快手', '苹果公司', '特斯拉', '英伟达', '微软',
  '谷歌', '亚马逊', '台积电', '中国人寿', '中国太保', '新华保险', '中国中铁', '中国建筑', '中国交建', '海螺水泥', '顺丰控股', '顺丰', '茅指数',
];
const US_TICKERS = /(?<![a-z])(aapl|tsla|nvda|msft|amzn|googl?|meta|baba|pdd|jd|bidu|nio|xpev|li)(?![a-z])/;

const NAME_RE = new RegExp(`(${[...STOCK_NAMES].sort((a, b) => b.length - a.length).join('|')})`);
const CORP_SUFFIX_RE = /[一-龥]{2,4}(股份|集团|控股|药业|制药|酒业|电器|矿业|新材)(?![一-龥]{0,2}(板块|行业|公司制|制度))/;
// 6 位证券代码（排除金额/数量：后接 元/万/股/份/人/年 等）
const CODE_RE = /(?<![\d.])(?:sh|sz|bj)?([0-9]{6})(?:\.(?:sh|sz|bj))?(?![\d.]|\s*(元|块|万|千|百|股|份|人|年|月|日|号|%|个|次|笔|手|分))/;
const SECRET_CTX = /(密码|验证码|手机|电话|身份证|卡号|银行卡|账号|证件号)/;
/** 指代用户自身持仓的短语：不是个股实体（不能据此判"个股+涨跌=预测"），但叠加买卖/止损等建议诉求时仍越界 */
const HOLDING_RE = /(我买的|我持有的|我拿的|我手里的?|我手上的?|手里的|手上的|我的(基金|股票|持仓|仓位|票|股))/;
const ANAPHORA_RE = /(某只票|某只股票?|某个股票|某股|这只|那只|这支|那支|该股|(?<!什么是)个股(?!期权)|这个股|这股|这票|这个票|那个票|这家公司|这只基金|该基金|这个基金|这个标的|该标的|自选股|某只股|龙头股)/;
const SECTOR_RE = /((银行|券商|保险|白酒|医药|医疗|创新药|新能源车?|光伏|锂电|储能|风电|芯片|半导体|军工|地产|房地产|消费|科技|ai|人工智能|算力|机器人|汽车|煤炭|石油|有色|稀土|黄金|白银|低空经济|游戏|传媒|电力|基建|中字头|高股息|红利|小盘|大盘|蓝筹|题材|概念)(股|板块|概念股|赛道|etf)|(黄金|白银|白酒|光伏|锂电|半导体|芯片|军工|算力|稀土|创新药))/;
const MARKET_RE = /(大盘|a股|沪指|上证(指数|综指)?|深证成指|深成指|创业板指|科创50|沪深300|中证500|中证1000|恒生指数|恒指|纳斯达克|纳指|道琼斯|标普|股市|市场|行情|指数|港股|美股|牛市|熊市|科创板|创业板|北交所|主板)/;
const GENERIC_RE = /(股票|基金|债券|国债|逆回购|可转债|科创板|创业板|北交所|港股|美股|新股|etf|lof|理财产品|理财|期权|期货|st股?|权证|b股|a股|r[1-5]|产品)/;

/* ---------------- 动词/句式 ---------------- */
const TRADE_RE = /(调到|换到|换成|转到|切到|买入|卖出|买|卖|加仓|减仓|补仓|清仓|满仓|半仓|建仓|抄底|逃顶|上车|下车|梭哈|all ?in|割肉|止损|止盈|持有|拿着|拿住|卖掉|抛|出手|入手|进场|入场|离场|接盘|追高|追涨|低吸|高抛|做t|定投|换仓|调仓|冲|跑|布局)/;
const EVAL_RE = /(怎么样|咋样|怎样|稳不稳|稳吗|靠不靠谱|行吗|好不好|好吗|值不值|值得|靠谱|行不行|能不能|可以吗|分析|诊断|评价|看法|前景|基本面|估值|高吗|低吗|贵吗|便宜|有没有机会|机会|看看|看一下|看下|推荐|潜力|投资价值|有戏|稳吗)/;
const PRED_STRONG = /(走势|后市|行情|前景|空间|目标价|点位|多少点|(能|会|可以|有望)(到|上|破|站上|回到)(\d{3,5}点?|多少|哪)|\d{3,5}点|涨到|跌到|涨至|跌至|见底|见顶|怎么走|怎么看|牛市|熊市|涨还是跌|涨跌(趋势|方向)|翻倍|几倍|预测|预计)/;
const PRED_WEAK = /(涨|跌|反弹|回调|涨停|跌停|上涨|下跌|暴涨|暴跌|大涨|大跌|拉升|起飞|突破|新高|新低)/;
const FUT_PRED = /(会|将|能|还能|还会|要|会不会|能不能|还有|有没有)(继续|再|大|暴|持续)?(涨|跌|上涨|下跌|反弹|回调|见底|见顶|突破|翻倍|涨停|跌停|崩|起飞|拉升|新高|新低)/;
const TIME_RE = /(现在|今天|明天|后天|最近|这周|本周|下周|下个?月|今年|明年|年底|年内|未来|接下来|近期|短期|目前|马上|当前|此时|这个位置|这个价|这个点|节后|周一|下半年|这时候|眼下|开盘|尾盘)/;
const PRICE_COND = /(跌了|涨了|亏了|赚了|高了|低了|回调|新高|新低|套了|被套|腰斩|亏损|浮亏|跌破|涨停了|跌停了|翻倍了|\d+(\.\d+)?%|\d+个点)/;
const PERSONAL_RE = /(我|我的|手里|手上|家里|我们家)/;
const SLANG_RE = /(抄底|上车|下车|梭哈|all ?in|满仓|割肉|追高|冲一波|冲不冲|能冲|还能追|干就完|翻身|起飞)/;
const QUESTION_TAIL = /(吗|么|不|呢|吧|没|\?|？)?$/;
const ADVICE_RE = /(该不该|应不应该|要不要|能不能|可不可以|适不适合|值不值得|是否(应该|可以|适合)?|应该|可以|适合|值得|还能|能|该|要|敢|建议)(现在|今天|马上|立刻|继续|再|全部|一次性|赶紧|先)?(买入|卖出|买|卖|加仓|减仓|补仓|清仓|满仓|半仓|建仓|抄底|上车|下车|梭哈|割肉|止损|止盈|持有|拿着|卖掉|进场|入场|离场|追高|追涨|抛|冲|跑|入手|定投|all ?in)/;
const PROCEDURAL_RE = /(最少|最低|至少|多少股|一手|手续费|佣金|印花税|怎么买|如何买|在哪买|哪里买|在哪里买|流程|步骤|交易规则|规则|交易时间|几点|开通|权限|怎么交易|如何交易)/;

/** 行情查询：问已发生的价格事实（"腾讯股价今天多少""茅台昨天收盘多少"）——不是越界，但本助手不提供行情数据 */
// 强行情词：单独出现即是问行情（"昨天股价多少"）；弱行情词（价格/市值/成交量…）需同时有时间词
const MARKET_FACT_STRONG = /(收了多少点|收在多少点|点位是多少|股价|收盘价|开盘价|收盘多少|开盘多少|收在多少|现价|最新价|报价|多少钱一股|几块钱一股|报几块|涨了多少|跌了多少|涨了几|跌了几|涨停了|跌停了|收涨|收跌)/;
const MARKET_FACT_WEAK = /(价格|价位|市值|成交量|成交额|换手率|涨幅|跌幅|涨了吗|跌了吗)/;
const MARKET_TIME = /(今天|昨天|前天|现在|刚才|刚刚|最近|目前|当前|今日|昨日|这会儿|此刻|上周|本周|这周|上个月|今年以来)/;
const MARKET_EXCLUDE = /(涨跌幅|涨跌停|首日|第一天|上市|新股|前5|前五|打新|申购|买|卖|会涨|会跌|还能|能涨|能跌|将|上车|目标价|明天|后天|下周|下个月|未来|将来|预测|预计|后市|走势|抄底|建议|值得|该不该|要不要|能不能|可以|限制|规则|制度|怎么|如何|为什么|为何|原因|影响|是什么|什么意思|含义|定义|需要|条件|门槛)/;
/** 问已发生涨跌的原因（"腾讯今天为什么跌了"）：过去时 + 涨/跌了 + 没有未来时点——不是预测 */
const PAST_MOVE = /(今天|昨天|前天|刚才|刚刚|最近|上周|这周|本周|这几天|近期)[^。？?！!]{0,10}(涨|跌|大涨|大跌|暴涨|暴跌|拉升|跳水)了/;
const FUTURE_MARK = /(明天|后天|下周|下个月|将|还会|会不会|能不能|还能|接下来|未来|以后|后面|目标)/;
export function isPastMoveQuery(s: string): boolean {
  const t = normalizeForRules(s);
  return PAST_MOVE.test(t) && !FUTURE_MARK.test(t) && !/(买|卖|抄底|上车|加仓|减仓|该不该|要不要)/.test(t);
}
/** 证券基本信息（代码、全称、上市交易所/时间）：不越界，也不是行情；本助手不提供个股资料 */
const SECURITY_INFO = /(股票代码|证券代码|基金代码|代码是多少|代码多少|全称是|简称是|在哪(个|家)?(交易所|证券交易所)?上市|哪个交易所(上市)?|上市地点|什么时候上市|哪年上市|上市时间)/;
export function isSecurityInfoQuery(s: string): boolean {
  const t = normalizeForRules(s);
  return SECURITY_INFO.test(t) && !/(买|卖|会涨|会跌|还能|能涨|上车|抄底|建议|值得|规则|条件|门槛|流程|怎么开|如何开)/.test(t);
}
export function isMarketDataQuery(s: string): boolean {
  const t = normalizeForRules(s);
  if (isPastMoveQuery(t)) return true;
  return (MARKET_FACT_STRONG.test(t) || (MARKET_FACT_WEAK.test(t) && MARKET_TIME.test(t))) && !MARKET_EXCLUDE.test(t);
}

/** 交易规则类问法（T+1、到账时间），不是买卖建议 */
const RULE_Q = /((当天|今天|当日)买(入)?的.{0,6}(当天|今天|当日|明天)?(能|可以|能不能)卖|t\+[01n]|什么时候(能|可以)?(卖|取|到账|转出)|(规则|限制|制度)(是|有))/;
/** 反诈/识别类问法：整句为识别骗局，且越界子句不是第一人称请求 → 教育 */
const FRAUD_EDU = /((怎么|如何)(判断|识别|辨别|防范|分辨|避免)|是不是(骗局|诈骗|杀猪盘|骗子|真的|违法)|杀猪盘|骗局|诈骗|被骗|可信吗|合法吗|违法吗)/;
const SELF_REQUEST = /(推荐|给我|帮我|带我|我想(加|进|要|找|跟)|有没有|拉我|求|我要)/;

/** 教育/概念句式（无实体时豁免） */
const EDU_RE = /(什么是|是什么|什么叫|啥是|啥叫|何为|何谓|含义|定义|概念|什么意思|啥意思|是指|怎么理解|如何理解|指的是|区别|有什么不同|原理|如何计算|怎么计算|怎么算|计算公式|有哪些(类型|种类|方式|风险|特点|规定|要求|条件|方法)|有什么(风险|后果|处罚|危害|影响|规定|要求|区别)|风险(大吗|有哪些|是什么)|为什么|为何|如何(识别|防范|避免|辨别|举报|应对|保护|判断真假)|怎么(识别|防范|避免|辨别|举报|应对|保护)|违法|违规|合法|合规|处罚|法律责任|骗局|诈骗|陷阱|是真的吗|可信吗|靠谱吗|科普|讲讲|解释|了解|还存在吗|是否存在|存在吗|怎么判断|如何判断)/;

/* ---------------- 各类别模式 ---------------- */
const STOCK_EXPLICIT: RegExp[] = [
  /(推荐|荐|介绍|给我|来|挑|选)(一|几|两|三|五|个)?(只|支|个|些|款)?.{0,8}?(股票|牛股|基金|标的|板块|个股|理财产品|产品|票|股)(?!市|东|权|息|价|份制|票型)/,
  /(买|选|投|入)(什么|哪|啥)(只|支|个|些|种|款)?(股票|股|基金|板块|标的|产品|etf)/,
  /(买|选|投)(什么|哪个|啥)(好|比较好|最好|赚钱|合适|能赚)/,
  /(哪|什么)(只|支|个|些|款)(股票|股|基金|板块|标的|etf|产品)?.{0,4}?(好|最好|比较好|能涨|会涨|值得|靠谱|赚钱|收益高|推荐)/,
  /(牛股|妖股|金股|黑马股?|十倍股)/,
  /(给|发|报)(我)?(个|几个|一个)?(股票)?代码/,
  /(有|有没有|有啥|有什么)(好的?|推荐的?|值得买的?|能涨的?|靠谱的?|收益高的?)(股票|股|基金|标的|理财产品|理财|产品)/,
  /(选股|诊股|荐个股|帮我选|帮我挑)/,
  /(买|卖|入)(什么|啥|哪只|哪个|哪些)(股|票|好)?(吗|呢|\?|？)?$/,
];
const PRED_EXPLICIT: RegExp[] = [
  /(能|会|可以|还能|还会)?(涨到|跌到)多少/, /能涨多少/, /目标价/, /多少点/, /涨还是跌/,
  /什么时候(能|会|才)?(涨|跌|反弹|见底|见顶|解套|回本|牛市|启动)/, /会不会(涨|跌|暴跌|崩|继续跌|继续涨)/,
  /明天.{0,4}(涨|跌)/, /(能|会|可以|有望)(到|上|破|站上|跌破|回到)\d{3,5}点/, /(哪|什么)(只|支|个|些)(股票?|基金|板块|票).{0,6}(会|能|要|将)(涨|涨停|翻倍|大涨|起飞|拉升)/, /预测.{0,6}(走势|涨跌|行情|点位)/, /(能|会)翻倍/, /翻几倍/,
];
const RETURN_STRONG = /(稳赚|稳赚不赔|只赚不赔|包赚|躺赚|保本保息|保本保收益|保证收益|保证.{0,4}(赚|收益|不亏|回本|翻倍)|承诺.{0,4}(收益|保本|不亏)|零风险|无风险(收益|理财|产品|投资)?|稳稳的?收益|高收益.{0,4}(低风险|无风险|零风险)|收益(有|能)保障|保底收益|刚性兑付|刚兑|一定(能)?赚|肯定(能)?赚|不会亏|不亏钱|稳定翻倍|日赚|月入\d|月入过万|月入上万|月赚\d|日赚\d|稳定(盈利|赚钱|获利|收益)|躺赚|暴富|快速(赚钱|致富|翻倍)|一夜翻身|保证年化|保证.{0,6}\d+(\.\d+)?%|保本.{0,6}(拿|赚|收益|年化)|(每年|每月|年化)(稳定)?(拿|赚)\d+(\.\d+)?%)/;
const RETURN_SOFT = /(保本|保收益|保息)/;
const RETURN_ASK = /(收益率?(能|会|可以)?(有|达到|到)?多少|年化(能|会)?(有|到)?多少|一年能赚多少|能赚多少|赚多少钱)/;
// 收益承诺"请求"语境：要产品/要承诺。只问"某产品是否保本/会不会亏"属于产品属性科普，不算越界
const REQUEST_FRAME = /(有没有|有吗|推荐|哪个|哪些|哪款|我想|想要|想买|给我|帮我找|找个|来个|保证|承诺|确保|要求|必须)/;
const MANAGED: RegExp[] = [
  /(代客理财|代客操作|代理炒股|代炒|代操盘|代操作)/,
  /(帮|替)(我|忙)(操作|炒股|炒|买入?|卖出?|下单|交易|管理|打理|理财|操盘|盯盘|挂单|申购|抢|做)/,
  /带(我|我们)(炒|赚|飞|玩|做|上车)/, /(带单|喊单|跟单)/, /你(来|帮我)(操作|操盘|做主|买|卖)/,
  /(全权(委托|代理|处理)|委托(你|您|你们)(操作|管理|买|卖|打理)?|托管给你|收益分成|利润分成|盈利分成)/,
  /(账户|账号)(给你|交给你|借给?你|你来管|让你管)/, /(账号|账户)和?密码/, /密码(给你|发你|告诉你|是多少|是\s*\d)/,
  /验证码(给你|发你)/, /把.{0,6}(账户|账号|密码|验证码)(给|发|交给|告诉)(你|您)/,
];
const INSIDER: RegExp[] = [
  /(内幕(消息|信息)|内部消息|内部信息|小道消息|独家消息)/, /提前(知道|拿到|得到).{0,6}(消息|利好|公告)/,
  /(庄家|坐庄|跟庄|控盘|老鼠仓|对倒)/, /主力(资金)?(要|会|在)?(拉升|出货|吸筹|洗盘|进场|建仓|动向)/, /(拉升|拉盘|砸盘)/,
  /操纵(股价|市场)/, /(群里|群友|老师|大v|博主|内部|朋友|有人|据说|听说)(说|讲|透露|爆料|消息)?.{0,12}(重组|利好|拉升|收购|并购|借壳|涨停|内幕)/, /(荐股群|带单群|牛股群|股票群|vip群|内部群|稳赚群|老师带)/, /(加|进)(个)?(群|微信|vx|qq|wx|电报群)/,
];
const PRIVACY: RegExp[] = [
  /(查|查询|查一下|查看|调取|告诉我|给我|看看|看下|透露|提供|帮我查)(一下)?.{0,8}(别人|他人|其他(人|客户|用户)|别的(客户|用户)|我(朋友|老婆|老公|同事|家人|爸|妈|父母|儿子|女儿|男朋友|女朋友)|某人|张三|李四|这个人|那个人|客户|股东)[\u4e00-\u9fa5]{0,3}的?.{0,10}(开户|账户|账号|持仓|身份证|手机号?|电话|住址|地址|资产|交易记录|流水|信息|收益|余额|资料)/,
  /(他|她|ta)的(持仓|账户|手机号|身份证|资产|交易记录|余额)/,
];
const PRIVACY_OWNER = /(别人|他人|其他(人|客户|用户)|别的(客户|用户)|客户经理|经理|员工|工作人员|同事|朋友|老婆|老公|家人|张三|李四|王[\u4e00-\u9fa5]{0,2}|某人|这个人|那个人|他|她)的?.{0,6}(身份证号?|住址|家庭地址|地址|手机号|电话号码?|持仓|账户|资产|余额|交易记录|收益)/;
const PRIVACY_ASK = /(告诉我|给我|发我|查|透露|提供|是多少|是什么|有哪些|多少|持有什么|买了什么)/;
const PII_ID = /(?<!\d)\d{17}[\dx](?!\d)/;
const PII_PHONE = /(?<!\d)(?:86)?1[3-9]\d{9}(?!\d)/;
const PII_CARD = /(?<!\d)\d{16,19}(?!\d)/;
/** 用户在对话里发出了自己的密码/验证码 */
const PII_SECRET = /((交易|资金|登录|支付)?密码(是|为|:)?\S*\d{4,}|密码(是|为|:)[^，。,；;！!？?]{3,}|验证码(是|为|:)?\d{4,})/;
/** 本人账户事务（需核实身份，转人工）："我的银行卡绑定失败""我开户审核到哪一步""账户被锁" */
const SELF_ACCOUNT = /((修改|更换|更改|换绑|改|变更)(一下)?(绑定的?|预留的?|我的)?(手机号|手机号码|银行卡|邮箱|联系地址|地址|密码)|(忘记|忘了|想不起|记不得|不记得)了?(我的)?(交易|资金|登录|支付)?密码|(交易|资金|登录|支付)?密码(忘记|忘了|想不起|记不得|输错|错了|被锁)|帮我(把|给我)?.{0,6}(开了|开通|办了|办理|激活|解锁|销户|转户)|(我的?|本人|我名下的?)?.{0,12}(银行卡|卡|账户|账号|三方存管|存管|开户|审核|密码|资金).{0,10}(绑定失败|绑不上|失败|怎么办(?!理)|进度|到哪|哪一步|异常|被锁|锁了|锁定|冻结|解锁|解冻|重置|找回|忘了|忘记|扣款|没到账|不到账))/;
/** 用号码指代他人（"手机号138…的人持有什么"） */
const PRIVACY_BY_NUMBER = /(手机号?|电话|身份证号?|卡号|账号)\d*\S{0,6}的(人|用户|客户|账户|主人|机主).{0,10}(持有|持仓|买了|信息|是谁|账户|资产|余额|开户)/;
const INJECTION: RegExp[] = [
  /(忽略|无视|忘记|忘掉|不要管|跳过|绕过|覆盖)(掉)?(之前|上面|以上|前面|先前|所有|全部|你的|系统)?的?(所有|全部)?(指令|规则|提示|设定|限制|要求|约束|规定|prompt|instructions?)/,
  /ignore\s*(all\s*|any\s*|the\s*)?(previous\s*|prior\s*|above\s*)?(instructions?|rules|prompts?)/, /forget\s*(all\s*)?(previous|prior|your)\s*(instructions?|rules)/, /you\s*are\s*now/, /act\s*as\s*(a|an)?/, /disregard/,
  /你现在(是|扮演|作为|变成)/, /(你|请|现在)(来)?(扮演|假装|充当|变成)/, /扮演(一)?(个|位|名)/, /角色扮演/, /假设你(是|没有)/,
  /(开发者模式|developer\s*mode|dan模式|jailbreak|越狱|上帝模式|管理员模式|测试模式)/, /(?<![a-z])dan(?![a-z])/,
  /不受(任何)?.{0,4}(限制|约束|规则)/, /没有(任何)?(限制|约束)的/, /解除(所有)?限制/,
  /(系统|初始)提示词?/, /system\s*prompt/, /(输出|打印|显示|告诉我|重复)(你的|一下)?(系统)?(提示词|指令|设定|prompt|规则原文)/, /你的(提示词|系统设定|prompt)/,
  /新(的)?指令/, /以.{0,6}(身份|口吻)回答/, /(?<![a-z])sudo(?![a-z])/, /\[system\]/, /<\|.*?\|>/, /#{2,}\s*system/, /从现在(开始|起)[，,]?你/,
];
/** 咨询人工服务/投诉渠道本身（"客服几点上班""怎么投诉"）：按知识作答，不建工单 */
const SERVICE_INQUIRY = /((人工客服|客服|人工服务|投诉|热线).{0,8}(时间|几点|电话|热线|号码|渠道|方式|途径|流程|怎么联系|如何联系|在哪|是多少|有哪些|上班)|(怎么|如何|在哪|去哪|哪里可以|通过什么)(投诉|联系客服|找客服|找人工|转人工))/;
/** 明确要求现在就转人工/投诉 */
const EXPLICIT_HANDOFF = /(^转人工|帮我转人工|给我转人工|转接人工|我要转人工|我要(找)?人工|找人工(处理|客服)?|要人工|接人工|我要投诉|要投诉你们|投诉你们|我要举报你们|真人客服|活人)/;
const COMPLAINT = /(转人工|人工客服|人工服务|人工坐席|找人工|要人工|接人工|(找|要|转|接)(个)?(真人|活人)|真人客服|客服(电话|热线)?|我要投诉|投诉|(找|联系|转|约|见)(一下)?(我的|你们的?|贵司的?|我们的)?客户经理|找你们(领导|经理|负责人)|12386|退钱|赔偿)/;

/** 预先遮蔽的"规则性名词"（避免"涨跌幅限制""涨停板制度"被当作预测） */
const MASK_RE = /(涨跌幅(限制|比例)?|涨跌停(板|价|制度|规则|限制)?|涨停板|跌停板|涨停价|跌停价|个股期权|价格涨跌|上涨下跌规则|止损单|止盈单|买卖规则|交易规则)/g;

/* ---------------- 工具 ---------------- */
export function normalizeForRules(s: string): string {
  return normalizeText(s).replace(/\s+/g, '').replace(/[“”"'‘’「」]/g, '');
}

/** 隐私脱敏（日志落库/展示/送入 LLM 前）。号码允许空格、连字符、+86 等分隔写法。 */
/** aggressive=true（用户输入）：只要提到密码/验证码，就把 4–8 位数字串一并遮蔽 */
const SEP = '[\\s\\-－—]?';
const RE_ID = new RegExp(`(?<![\\dA-Za-z])\\d(?:${SEP}\\d){16}${SEP}[\\dXx](?![\\dA-Za-z])`, 'g');
const RE_PHONE = new RegExp(`(?:(?:\\+|＋)?86${SEP})?(?<!\\d)1[3-9]\\d(?:${SEP}\\d){8}(?!\\d)`, 'g');
const RE_CARD = new RegExp(`(?<![\\dA-Za-z])\\d(?:${SEP}\\d){15,18}(?![\\dA-Za-z])`, 'g');
const keepEnds = (m: string, head: number, tail = 4) => {
  const digits = m.replace(/[^\dXx]/g, '');
  return digits.slice(0, head) + '*'.repeat(Math.max(4, digits.length - head - tail)) + digits.slice(-tail);
};
export function maskPII(s: string, aggressive = false): string {
  return (s || '')
    .replace(RE_ID, (m) => keepEnds(m, 6))
    .replace(RE_CARD, (m) => keepEnds(m, 4))
    .replace(RE_PHONE, (m) => keepEnds(m.replace(/^(?:\+|＋)?86/, ''), 3))
    // 密码/验证码语境：整串遮蔽（含符号），"密码是否…"不误伤
    .replace(/((?:交易|资金|登录|支付|取款)?密码\s*(?:是(?!否)|为|:|：)\s*)[^\s，。,；;！!？?、）)]{1,40}/g, '$1******')
    .replace(/(验证码\s*(?:是(?!否)|为|:|：)?\s*)[A-Za-z0-9]{4,8}/g, '$1****')
    .replace(/(?<![\dA-Za-z])\d{4,8}(?![\dA-Za-z])/g, (m, _off: number, all: string) => (aggressive && /密码|验证码/.test(all) ? '*'.repeat(m.length) : m));
}

export interface ClauseAnalysis { text: string; hits: ComplianceHit[]; educational: boolean; substantive: boolean; entities: string[] }
export interface ComplianceAnalysis {
  hits: ComplianceHit[];
  violations: ComplianceHit[];
  injection: boolean;
  complaint: boolean;
  verdict: 'clean' | 'refuse' | 'mixed' | 'handoff';
  clauses: ClauseAnalysis[];
  compliantText: string;   // 可作答部分（用于检索与生成）
  refusedText: string;     // 越界部分
  entities: string[];
  notes: string[];
  /** 反诈/识别类问法（怎么判断是不是骗局） */
  fraudEdu: boolean;
  /** 行情查询（问已发生的价格事实，非越界） */
  marketData: boolean;
  /** 证券基本信息（代码/全称/上市交易所） */
  securityInfo: boolean;
  /** 用户发送了本人敏感信息（身份证/卡号/手机号/密码） */
  selfPii: boolean;
  handoffReason: string;
}

const VIOLATION_CATS: ComplianceCategory[] = ['stock_pick', 'price_prediction', 'return_promise', 'managed_account', 'insider_manip', 'privacy'];
export const isViolation = (c: ComplianceCategory) => VIOLATION_CATS.includes(c);

function firstMatch(res: RegExp[], s: string): string | null {
  for (const r of res) { const m = s.match(r); if (m) return m[0]; }
  return null;
}

/** 文本中的个股/公司实体（名称、6 位代码、美股代码、"XX股份/集团/控股"），不含指代词与板块 */
export function stockEntitiesIn(text: string): string[] {
  const s = normalizeForRules(text);
  const out: string[] = [];
  const m1 = s.match(new RegExp(NAME_RE.source, 'g')); if (m1) out.push(...m1);
  const m2 = SECRET_CTX.test(s) ? null : s.match(CODE_RE); if (m2) out.push(m2[1]);
  const m3 = s.match(US_TICKERS); if (m3) out.push(m3[0]);
  const m4 = s.match(CORP_SUFFIX_RE); if (m4 && !/示例/.test(m4[0])) out.push(m4[0]);
  return [...new Set(out)];
}

function findEntities(s: string): { specific: string[]; market: string[] } {
  const specific: string[] = [];
  const m1 = s.match(NAME_RE); if (m1) specific.push(m1[0]);
  // 6 位数字出现在密码/验证码/手机号/身份证/卡号语境时不当作证券代码
  const m2 = SECRET_CTX.test(s) ? null : s.match(CODE_RE); if (m2) specific.push(m2[1]);
  const m3 = s.match(US_TICKERS); if (m3) specific.push(m3[0]);
  const m4 = s.match(CORP_SUFFIX_RE); if (m4 && !/示例/.test(m4[0])) specific.push(m4[0]);
  const m5 = s.match(ANAPHORA_RE); if (m5) specific.push(m5[0]);
  const m6 = s.match(SECTOR_RE); if (m6) specific.push(m6[0]);
  const market: string[] = [];
  const mk = s.match(MARKET_RE); if (mk) market.push(mk[0]);
  return { specific, market };
}

/** 子句切分：句末标点、逗号、连接词（另外/顺便/以及/此外…），以及"和/并 + 推荐/帮我/预测…" */
export function splitClauses(s: string): string[] {
  return s
    .split(/[。！？!?；;\n]+|[，,、]|另外|顺便|以及|此外|再问|另一个问题|还有个问题|同时|然后|(?:和|并且|并|还有|再)(?=(?:推荐|帮我|帮忙|告诉我|预测|给我|你觉得|能不能|该不该|要不要|说说))/)
    .map((x) => (x ?? '').trim())
    .filter(Boolean);
}

function hit(category: ComplianceCategory, severity: Sev, matched: string, stage: 'input' | 'output' = 'input'): ComplianceHit {
  return { category, severity, matched: matched.slice(0, 40), stage };
}

/** 单子句判定。carry = 前文出现的个股实体（指代省略时继承）。 */
function analyzeClause(raw: string, carry: string[]): ClauseAnalysis {
  const s = raw.replace(MASK_RE, '□');
  const hits: ComplianceHit[] = [];
  const add = (h: ComplianceHit) => { if (!hits.some((x) => x.category === h.category)) hits.push(h); };
  const { specific: ownSpecific, market } = findEntities(s);
  const specific = ownSpecific.length ? ownSpecific : carry;
  const edu = EDU_RE.test(s);
  const ent = specific[0];

  // —— 提示注入 / 投诉人工（与是否教育句式无关）
  const inj = firstMatch(INJECTION, s); if (inj) add(hit('prompt_injection', 'high', inj));
  const cm = SERVICE_INQUIRY.test(s) && !EXPLICIT_HANDOFF.test(s) ? null : s.match(COMPLAINT); if (cm && !/人工智能/.test(s.slice(Math.max(0, (cm.index ?? 0) - 0), (cm.index ?? 0) + 4))) add(hit('complaint_human', 'low', cm[0]));

  // —— 隐私
  const pv = firstMatch(PRIVACY, s) ?? (PRIVACY_ASK.test(s) ? s.match(PRIVACY_OWNER)?.[0] ?? null : null);
  if (pv && !edu) add(hit('privacy', 'high', pv));
  const pn = s.match(PRIVACY_BY_NUMBER); if (pn) add(hit('privacy', 'high', '以号码查询他人信息'));
  if (PII_SECRET.test(s)) add(hit('privacy', 'medium', '密码/验证码（已脱敏）'));
  if (PII_ID.test(s)) add(hit('privacy', 'medium', '身份证号（已脱敏）'));
  else if (PII_CARD.test(s)) add(hit('privacy', 'medium', '银行卡号（已脱敏）'));
  else if (PII_PHONE.test(s)) add(hit('privacy', 'medium', '手机号（已脱敏）'));

  // —— 代客理财 / 索要账户密码
  const mg = firstMatch(MANAGED, s);
  if (mg && !(edu && !/(密码|验证码)\s*(是|给|发)?\s*\d/.test(s) && /(代客理财|代客操作|代理炒股|代炒|带单|喊单|跟单|全权|委托|分成)/.test(mg))) add(hit('managed_account', 'high', /\d{4,}/.test(mg) ? mg.replace(/\d/g, '*') : mg));

  // —— 内幕/操纵/荐股群
  const ins = firstMatch(INSIDER, s);
  if (ins && (!edu || ownSpecific.length)) add(hit('insider_manip', 'high', ins));

  // —— 收益承诺
  const rs = s.match(RETURN_STRONG);
  // "打新稳赚吗""逆回购会亏吗"：问某类产品/行为的属性（是非问句、无索要/承诺语气）→ 教育
  const attrQ = !!rs && /(稳赚|稳赚不赔|保本|会亏|不会亏|无风险|零风险)(的)?(吗|么|嘛|不|没)[？?]?$/.test(s) && !/(有没有|推荐|哪|怎样才能|怎么才能|如何才能|保证|承诺|给我|帮我|我想|想要|你们)/.test(s);
  if (rs && !edu && !attrQ) add(hit('return_promise', 'high', rs[0]));
  else if (!edu) {
    const rsoft = s.match(RETURN_SOFT);
    if (rsoft && REQUEST_FRAME.test(s)) add(hit('return_promise', 'medium', rsoft[0]));
    else { const ra = s.match(RETURN_ASK); if (ra && (ent || REQUEST_FRAME.test(s))) add(hit('return_promise', 'medium', ra[0])); }
  }

  // —— 荐股：显式请求
  const se = firstMatch(STOCK_EXPLICIT, s);
  // "挑基金一般看哪些指标"：挑/选 + 方法词 → 问方法（教育），不是要推荐
  const methodQ = /(看哪些|看什么|怎么(挑|选|看)|如何(挑|选|看)|指标|方法|注意事项|标准|原则|技巧|要点|考虑哪些)/.test(s);
  if (se && !(edu && !ownSpecific.length) && !(methodQ && !ownSpecific.length)) add(hit('stock_pick', 'high', se));

  // —— 荐股/预测：个股实体组合
  if (ent) {
    const tv = s.match(TRADE_RE); const ev = s.match(EVAL_RE);
    const pv2 = s.match(PRED_STRONG) ?? s.match(PRED_WEAK);
    const adv = s.match(ADVICE_RE);
    // 数量/流程词（"最少能买多少股"）或渠道/权限词（"港股通能买腾讯吗""没开通权限能买吗"）在前：问规则，不是买卖建议
    const quantity = /(最少|至少|最多|多少股|几股|几手|一手|多少手|整数倍)/.test(s);
    const channel = /(港股通|沪股通|深股通|科创板|创业板|北交所|权限|普通账户|信用账户|没开通|开通了?|融资融券|两融)[^，,。？?]{0,4}(能|可以|能不能|可不可以)(买|交易|卖)/.test(s);
    const procedural = (PROCEDURAL_RE.test(s) || quantity || channel) && !ev && !pv2 && (!adv || quantity || channel) && !TIME_RE.test(s) && !SLANG_RE.test(s);
    // 问已发生的行情事实（"今天涨了多少"）不是预测
    if (pv2 && !isMarketDataQuery(s)) add(hit('price_prediction', 'high', `${ent}…${pv2[0]}`));
    if ((tv || ev || adv) && !procedural) add(hit('stock_pick', 'high', `${ent}…${(adv ?? tv ?? ev)![0]}`));
  }

  // —— 预测：大盘/指数/板块
  if (!hits.some((h) => h.category === 'price_prediction') && market.length && !edu && !isMarketDataQuery(s)) {
    const fp = s.match(FUT_PRED) ?? s.match(PRED_STRONG);
    const tw = TIME_RE.test(s) && s.match(PRED_WEAK);
    if (fp || tw) add(hit('price_prediction', 'high', `${market[0]}…${(fp ?? tw as RegExpMatchArray)[0]}`));
  }
  // —— 预测：无实体显式
  if (!hits.some((h) => h.category === 'price_prediction') && !edu && !isMarketDataQuery(s)) {
    const pe = firstMatch(PRED_EXPLICIT, s);
    const fp = s.match(FUT_PRED);
    if (pe) add(hit('price_prediction', 'high', pe));
    else if (fp && QUESTION_TAIL.test(s) && /(吗|么|不|呢|\?|？|多少|什么时候)/.test(s)) add(hit('price_prediction', 'high', fp[0]));
  }

  // —— 荐股：无实体的买卖/仓位建议
  if (!hits.some((h) => h.category === 'stock_pick') && !edu && !RULE_Q.test(s)) {
    const adv = s.match(ADVICE_RE);
    const generic = GENERIC_RE.test(s);
    if (adv) {
      const tail = new RegExp(adv[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(吗|么|不|呢|吧|没|\\?|？)?$').test(s);
      const timing = TIME_RE.test(s); const cond = PRICE_COND.test(s); const slang = SLANG_RE.test(s);
      const personal = (PERSONAL_RE.test(s) && !generic) || HOLDING_RE.test(s);
      if (timing || cond || slang || personal || (tail && !generic)) add(hit('stock_pick', 'high', adv[0]));
    }
    if (!hits.some((h) => h.category === 'stock_pick')) {
      const sl = s.match(SLANG_RE);
      if (sl && /(吗|么|不|呢|吧|\?|？|该|要|能|可以|适合|时候|现在|哪个|哪只|哪些|什么|啥)/.test(s)) add(hit('stock_pick', 'high', sl[0]));
    }
    // 个性化资产配置建议
    const alloc = s.match(/(我|我家|手里|手上).{0,6}(\d+万|\d+块|\d+元|闲钱|存款|积蓄|工资|奖金|年终奖).{0,10}(怎么|如何|该|应该)?(投|买|配置|理财|分配|安排)/);
    if (alloc && !hits.some((h) => h.category === 'stock_pick')) add(hit('stock_pick', 'medium', alloc[0]));
  }

  const viol = hits.filter((h) => isViolation(h.category));
  const entityWords = new Set([...ownSpecific]);
  const topical = financeTermsIn(raw).filter((w) => !entityWords.has(w));
  const substantive = !viol.length && !hits.some((h) => h.category === 'prompt_injection')
    && (topical.length > 0 || (/(什么|怎么|如何|为什么|哪些|多少|区别|意思|吗)/.test(s) && s.length >= 5));
  return { text: raw, hits, educational: edu && !viol.length, substantive, entities: ownSpecific };
}

/** 输入侧分析（stage=input） */
export function analyzeInput(question: string): ComplianceAnalysis {
  const s = normalizeForRules(question);
  const parts = splitClauses(s);
  const clauses: ClauseAnalysis[] = [];
  let carry: string[] = [];
  const fraudEdu = FRAUD_EDU.test(s);
  for (const p of parts.length ? parts : [s]) {
    const c = analyzeClause(p, carry);
    if (c.entities.length) carry = c.entities;
    // 反诈识别类：第三方描述（"群里老师带单荐股"）不算用户越界请求
    if (fraudEdu && !SELF_REQUEST.test(p) && !c.entities.length) {
      const before = c.hits.length;
      c.hits = c.hits.filter((h) => !['insider_manip', 'managed_account', 'stock_pick', 'return_promise'].includes(h.category));
      if (c.hits.length !== before) { c.educational = true; c.substantive = true; }
    }
    clauses.push(c);
  }
  // 全句兜底：跨子句的显式模式（如"推荐，一只股票"被逗号切开）
  const whole = analyzeClause(s, []);
  const hits: ComplianceHit[] = [];
  for (const h of [...clauses.flatMap((c) => c.hits), ...whole.hits.filter((h) => h.category === 'prompt_injection' || h.category === 'complaint_human')]) {
    const ex = hits.find((x) => x.category === h.category);
    if (!ex) hits.push(h);
    else if (sevRank(h.severity) > sevRank(ex.severity)) Object.assign(ex, h);
  }
  // 用户发出的"本人"敏感信息（severity=medium 的隐私命中）：记告警、提醒勿发，但不因此拒答正常问题
  const selfPii = hits.some((h) => h.category === 'privacy' && h.severity === 'medium');
  let violations = hits.filter((h) => isViolation(h.category) && !(h.category === 'privacy' && h.severity === 'medium'));
  const selfAccount = !violations.length && SELF_ACCOUNT.test(s);
  // 反诈问法 + 仅内幕/荐股群类命中（"群里说某票有重组消息，可信吗"）：仍记告警，但按"识别方法"科普作答（partial_refusal）
  // 泛化的产品推荐请求（"有什么好的理财推荐"，无具体证券）：记告警、不推荐产品，改为讲风险等级与适当性
  const productEdu = !entities0(clauses) && violations.length > 0 && violations.every((h) => h.category === 'stock_pick' && /(理财|基金|产品)/.test(h.matched) && !/(股票|股|票|标的|板块)$/.test(h.matched));
  const insiderEdu = fraudEdu && violations.length > 0 && violations.every((h) => h.category === 'insider_manip');
  const injection = hits.some((h) => h.category === 'prompt_injection');
  const complaint = hits.some((h) => h.category === 'complaint_human');
  const compliant = clauses.filter((c) => c.substantive);
  const notes: string[] = [];
  let verdict: ComplianceAnalysis['verdict'] = 'clean';
  if (complaint) verdict = 'handoff';
  else if (selfAccount && !violations.length) verdict = 'handoff';
  else if (selfPii && !violations.length && !compliant.length && !injection) verdict = 'refuse';
  else if (violations.length) verdict = compliant.length || insiderEdu || productEdu ? 'mixed' : 'refuse';
  else if (injection) verdict = compliant.length ? 'clean' : 'refuse';
  const entities = [...new Set(clauses.flatMap((c) => c.entities))];
  if (entities.length) notes.push(`识别到个股/板块实体：${maskPII(entities.join('、'), true)}`);
  if (clauses.some((c) => c.educational)) notes.push('含教育性/概念性问句');
  if (verdict === 'mixed') notes.push('混合问题：越界部分拒答，知识部分作答');
  if (injection) notes.push('检测到提示注入，已忽略注入指令');
  if (productEdu) notes.push('泛化产品推荐请求：不推荐具体产品，改为讲风险等级与适当性');
  if (selfPii) notes.push('用户发送了本人敏感信息：已脱敏，提醒勿在对话中发送');
  if (selfAccount && !complaint) notes.push('本人账户事务（需核实身份）→ 转人工');
  if (insiderEdu) notes.push('反诈识别类问法：不评价消息真假与个股，改为讲识别方法');
  for (const h of hits) h.matched = maskPII(h.matched, true).replace(/(?<!\d)\d{6}(?!\d)/g, (m) => (SECRET_CTX.test(s) ? '******' : m));
  return {
    hits, violations, injection, complaint, verdict, clauses, entities, notes, fraudEdu, selfPii,
    marketData: verdict === 'clean' && !violations.length && !injection && !complaint && isMarketDataQuery(s),
    securityInfo: verdict === 'clean' && !violations.length && !injection && !complaint && isSecurityInfoQuery(s),
    handoffReason: complaint ? '用户要求人工服务或投诉' : selfAccount ? '本人账户事务需核实身份' : '',
    compliantText: insiderEdu && !compliant.length ? '如何识别非法荐股群和虚假内幕消息、重组消息'
      : productEdu && !compliant.length ? '如何根据产品风险等级与自身风险承受能力选择理财产品，常见基金类型的风险等级'
      : (injection || violations.length ? compliant.map((c) => c.text).join('，') : s) || s,
    refusedText: clauses.filter((c) => c.hits.some((h) => isViolation(h.category) || h.category === 'prompt_injection')).map((c) => c.text).join('，'),
  };
}

const entities0 = (cs: ClauseAnalysis[]) => cs.some((c) => c.entities.length > 0);
const sevRank = (s: Sev) => (s === 'high' ? 3 : s === 'medium' ? 2 : 1);

/* ---------------- 输出侧 ---------------- */
const OUTPUT_RULES: { category: ComplianceCategory; severity: Sev; re: RegExp }[] = [
  { category: 'stock_pick', severity: 'high', re: /建议(您|你)?.{0,6}(买入|卖出|加仓|减仓|清仓|满仓|抄底|建仓|重仓|梭哈|上车)/g },
  { category: 'stock_pick', severity: 'high', re: /((可以|可|不妨|值得|应该|应当)(考虑|适当|逢低|逢高|分批){1,3}(买入|卖出|加仓|减仓|抄底|建仓|重仓|布局|上车)|(不妨|值得)(买入|加仓|抄底|建仓|重仓|布局|上车)|(您|你)(现在)?(可以|可|应该|应当)(买入|卖出|加仓|减仓|抄底|建仓|重仓|上车))/g },
  { category: 'stock_pick', severity: 'high', re: /(强烈推荐|重点推荐|推荐(买入|关注|配置|持有)|牛股|金股|买点|卖点)/g },
  { category: 'stock_pick', severity: 'high', re: /(?<!\d)[036]\d{5}(?!\d).{0,8}(买入|加仓|推荐|值得)/g },
  { category: 'price_prediction', severity: 'high', re: /(目标价|必涨|必跌|看涨|看多|看空|上涨空间|涨到\d|跌到\d|(将|会|有望)(大幅)?(上涨|下跌|涨到|跌到|突破|反弹|涨至|跌至)|(一定|肯定|必然|必将)(会)?(上涨|大涨|涨|跌|翻倍(?!时间|所需|需要)))/g },
  { category: 'return_promise', severity: 'high', re: /(稳赚|保证收益|保本保收益|保证本金|稳赚不赔|只赚不赔|零风险|保底收益|(一定|肯定|必然)(会)?(赚|盈利)|(保证|稳定|轻松|必然)翻倍)/g },
  { category: 'managed_account', severity: 'high', re: /(我(可以|来|帮您|帮你)(操作|下单|买入|卖出|代为)|把(账户|密码|验证码)(告诉|发给|交给)我)/g },
];
const NEG_BEFORE = /(不|无|没有|勿|禁止|不得|不能|不会|不可|严禁|并非|不是|切勿|谨防|警惕|拒绝|无法|不应|不构成|避免|不提供|不做|不推荐|不承诺|不保证|不存在|没有所谓|所谓|任何|防范|识别|宣称|声称|号称|打着|询问|要求|请求|索要|涉及|诸如|例如|比如|类似|复述)/;
const NEG_AFTER = /^.{0,6}(的说法|的宣传|的话术|的承诺|骗局|陷阱|都是|均为|属于违规|属于违法|是违规|是违法|不可信|要警惕|需警惕)/;

/** 输出侧扫描：带否定/引用语境豁免（"不承诺保本""警惕'稳赚不赔'宣传"不算越界） */
export function scanOutput(answer: string): ComplianceHit[] {
  const text = normalizeText(answer || '');
  const out: ComplianceHit[] = [];
  for (const r of OUTPUT_RULES) {
    r.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 10), m.index);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const quoted = /[“"「‘']$/.test(before) || /^[”"」’']/.test(after);
      // 只看本句内的前文
      const sentBefore = before.split(/[。！？!?；;\n]/).pop() ?? '';
      const sentFull = text.slice(0, m.index).split(/[。！？!?；;\n]/).pop() ?? '';
      const insideQuote = (sentFull.match(/"/g)?.length ?? 0) % 2 === 1 || (sentFull.match(/[“「]/g)?.length ?? 0) > (sentFull.match(/[”」]/g)?.length ?? 0);
      if (NEG_BEFORE.test(sentBefore) || NEG_AFTER.test(after) || quoted || insideQuote) continue;
      if (!out.some((h) => h.category === r.category)) out.push(hit(r.category, r.severity, m[0], 'output'));
      break;
    }
  }
  return out;
}

/** 便捷：输入侧 hits */
export function checkInput(question: string): ComplianceHit[] { return analyzeInput(question).hits; }
