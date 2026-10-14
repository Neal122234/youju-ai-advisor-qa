// 用户端问题建议：欢迎态分组常见问题 + 每条回答后的推荐追问。
// 追问按命中文档（引用的 docKey）→ 同主题的相邻问题生成；不调用额外接口，问题均可由知识库作答。
import type { ChatResponse, ComplianceCategory } from '../apiTypes';

export interface FaqGroup { key: string; label: string; icon: string; questions: string[] }

export const FAQ_GROUPS: FaqGroup[] = [
  { key: 'account', label: '开户与交易', icon: 'wallet', questions: ['线上开户需要准备哪些材料？', 'A股每天几点开盘？集合竞价怎么进行？', '股票交易佣金和印花税怎么收？', '今天卖出股票的钱什么时候能取出？'] },
  { key: 'access', label: '产品与权限', icon: 'key', questions: ['科创板权限开通需要满足什么条件？', '创业板开通门槛是多少？', '我想做股票期权，开户条件是什么？', '融资融券怎么开通？需要什么条件？'] },
  { key: 'basics', label: '基础知识', icon: 'bulb', questions: ['市盈率怎么看？', 'ETF 和 LOF 有什么区别？', '国债逆回购是什么？怎么计息？', '什么是可转债的强制赎回？'] },
  { key: 'service', label: '人工服务', icon: 'headset', questions: ['人工客服的服务时间是什么时候？', '怎么投诉？投诉渠道有哪些？', '我要投诉，转人工'] },
];

/** 命中文档 → 同主题追问 */
const BY_DOC: Record<string, string[]> = {
  'rule-star-market-access': ['创业板开通门槛是多少？', '北交所权限开通需要什么条件？', '风险测评的有效期是多久？'],
  'rule-chinext-access': ['科创板权限开通需要满足什么条件？', '创业板股票涨跌幅限制是多少？', '风险测评的有效期是多久？'],
  'rule-bse-access': ['科创板权限开通需要满足什么条件？', '北交所股票涨跌幅限制是多少？'],
  'rule-hk-connect-access': ['港股通交易有哪些特点？', '科创板权限开通需要满足什么条件？'],
  'rule-options-access': ['期权开户前要做模拟交易吗？', '我的风险等级和产品不匹配怎么办？', '融资融券怎么开通？需要什么条件？'],
  'rule-margin-trading-access': ['维持担保比例低了会怎样？', '杠杆投资有哪些风险？', '股票期权开户条件是什么？'],
  'rule-convertible-bond': ['什么是可转债的强制赎回？', '可转债转股溢价率怎么理解？'],
  'rule-account-opening': ['开户后为什么要做风险测评？', '股票交易佣金和印花税怎么收？', '怎么销户或转户？'],
  'rule-account-closing': ['线上开户需要准备哪些材料？', '三方存管是什么？'],
  'rule-trading-hours': ['什么是收盘集合竞价？', '今天卖出股票的钱什么时候能取出？', '涨跌幅限制是多少？'],
  'rule-trading-basics': ['A股每天几点开盘？集合竞价怎么进行？', '科创板最少买多少股？', '股票交易佣金和印花税怎么收？'],
  'rule-price-limit': ['ST 股票的涨跌幅是多少？', '新股上市首日有涨跌幅限制吗？'],
  'rule-fees': ['最低佣金 5 元是什么意思？', '今天卖出股票的钱什么时候能取出？'],
  'rule-app-features': ['条件单怎么设置？', '模拟交易怎么用？'],
  'rule-human-service': ['人工客服的服务时间是什么时候？', '怎么投诉？投诉渠道有哪些？'],
  'basics-convertible-bond': ['可转债交易需要什么权限？', '什么是回售条款？'],
  'basics-dividend-exright': ['什么是股权登记日？', '红利税怎么计算？'],
  'basics-etf-lof': ['什么是 ETF 的折溢价？', '指数基金的跟踪误差是什么？', '公募基金有哪些类型？'],
  'basics-fund-types': ['货币基金和债券基金有什么区别？', 'ETF 和 LOF 有什么区别？'],
  'basics-ipo-subscription': ['新股中签后怎么缴款？', '打新需要多少市值？'],
  'basics-reverse-repo': ['国债逆回购的计息天数怎么算？', '货币基金和逆回购有什么区别？'],
  'basics-stock-index': ['沪深300 指数是什么？', '科创板和创业板有什么不同？'],
  'basics-suspension-st': ['ST 股票的涨跌幅是多少？', '退市整理期是什么？'],
  'edu-pe-pb': ['市净率怎么理解？', '滚动市盈率 TTM 是什么意思？', '什么是分散投资？'],
  'edu-stop-loss-diversify': ['止损有哪些常见方式？', '什么是资产配置？'],
  'edu-kline': ['阳线和阴线有什么区别？', '成交量怎么看？'],
  'edu-leverage-risk': ['融资融券有哪些主要风险？', '什么是强制平仓？'],
  'edu-dca-compound-fees': ['定投适合什么样的人？', '基金管理费怎么收？'],
  'edu-fraud-identification': ['怎么识别非法荐股？', '承诺保本保收益可信吗？'],
  'edu-guaranteed-return': ['怎么识别非法荐股？', '我的风险等级是怎么评定的？'],
  'suit-risk-matching': ['风险测评的有效期是多久？', '风险等级不匹配还能买吗？'],
  'suit-risk-assessment': ['风险等级和产品等级怎么匹配？', '投资者适当性管理是什么？'],
  'suit-measures-overview': ['风险等级和产品等级怎么匹配？', '风险测评的有效期是多久？'],
};

/** 越界类别 → 引导到可答的投教问题 */
const BY_CATEGORY: Partial<Record<ComplianceCategory, string[]>> = {
  stock_pick: ['市盈率怎么看？', '什么是分散投资？', '怎么识别非法荐股？'],
  price_prediction: ['K线基础怎么看？', '止损有哪些常见方式？', '市盈率怎么看？'],
  return_promise: ['承诺保本保收益可信吗？', '公募基金有哪些类型？', '国债逆回购是什么？怎么计息？'],
  managed_account: ['怎么识别非法荐股？', '人工客服的服务时间是什么时候？'],
  insider_manip: ['怎么识别非法荐股？', '承诺保本保收益可信吗？'],
  privacy: ['人工客服的服务时间是什么时候？'],
  prompt_injection: ['市盈率怎么看？', '科创板权限开通需要满足什么条件？'],
};

const DEFAULT = ['科创板权限开通需要满足什么条件？', '市盈率怎么看？', 'A股每天几点开盘？集合竞价怎么进行？'];

const norm = (s: string) => s.replace(/[\s？?。，,！!]/g, '');

/** 生成 2–3 条推荐追问；排除本轮和已问过的问题 */
export function followUps(resp: ChatResponse, asked: string[]): string[] {
  if (resp.decision === 'handoff_request') return [];
  const seen = new Set(asked.map(norm));
  const pool: string[] = [];
  for (const c of resp.citations ?? []) pool.push(...(BY_DOC[c.docKey] ?? []));
  for (const h of resp.compliance ?? []) pool.push(...(BY_CATEGORY[h.category] ?? []));
  if (resp.decision.startsWith('handoff')) pool.push('人工客服的服务时间是什么时候？');
  if (!pool.length) pool.push(...DEFAULT);
  const out: string[] = [];
  for (const q of pool) {
    const k = norm(q);
    if (seen.has(k)) continue;
    seen.add(k); out.push(q);
    if (out.length === 3) break;
  }
  return out;
}
