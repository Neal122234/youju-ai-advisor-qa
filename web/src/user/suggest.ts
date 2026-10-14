// 用户端问题建议：欢迎态分组常见问题 + 每条回答后的推荐追问。
// 2026-10-14 已用线上 /api/chat（C3）逐条实测：除有意保留的「我要投诉，转人工」外全部为 answered/answered_caveat、无合规命中。
// 注意：线上意图分类会把含「客服」的问法判为要人工（complaint_human），推荐语里避免出现「客服」「投诉」「还能买」「会涨吗」等词。
// 追问按命中文档（引用的 docKey）→ 同主题的相邻问题生成；不调用额外接口，问题均可由知识库作答。
import type { ChatResponse, ComplianceCategory } from '../apiTypes';

export interface FaqGroup { key: string; label: string; icon: string; questions: string[] }

export const FAQ_GROUPS: FaqGroup[] = [
  { key: 'account', label: '开户与交易', icon: 'wallet', questions: ['线上开户需要准备哪些材料？', 'A股每天几点开盘？集合竞价怎么进行？', '股票交易佣金和印花税怎么收？', '今天卖出股票的钱什么时候能取出？'] },
  { key: 'access', label: '产品与权限', icon: 'key', questions: ['科创板权限开通需要满足什么条件？', '创业板开通门槛是多少？', '我想做股票期权，开户条件是什么？', '融资融券怎么开通？需要什么条件？'] },
  { key: 'basics', label: '基础知识', icon: 'bulb', questions: ['市盈率怎么看？', 'ETF 和 LOF 有什么区别？', '国债逆回购是什么？怎么计息？', '什么是可转债的强制赎回？'] },
  { key: 'service', label: '人工服务', icon: 'headset', questions: ['服务热线的服务时间是什么时候？', '提交的工单一般多久有回复？', '非交易时间提交的问题什么时候处理？', '我要投诉，转人工'] },
];

/** 命中文档 → 同主题追问（教育式措辞，避免"还能买""会涨吗"等会被判为越界的口语） */
const BY_DOC: Record<string, string[]> = {
  'rule-star-market-access': ['创业板开通门槛是多少？', '北交所权限开通需要什么条件？', '风险测评的有效期是多久？'],
  'rule-chinext-access': ['科创板权限开通需要满足什么条件？', '创业板股票涨跌幅限制是多少？', '风险测评的有效期是多久？'],
  'rule-bse-access': ['科创板权限开通需要满足什么条件？', '北交所股票涨跌幅限制是多少？'],
  'rule-hk-connect-access': ['港股通交易有哪些特点？', '科创板权限开通需要满足什么条件？'],
  'rule-options-access': ['股票期权开户需要哪些交易经历？', '风险等级不匹配会有什么提示？', '融资融券怎么开通？需要什么条件？'],
  'rule-margin-trading-access': ['维持担保比例低了会怎样？', '杠杆投资有哪些风险？', '我想做股票期权，开户条件是什么？'],
  'rule-convertible-bond': ['什么是可转债的强制赎回？', '可转债转股溢价率怎么理解？'],
  'rule-account-opening': ['开户后为什么要做风险测评？', '股票交易佣金和印花税怎么收？', '怎么销户或转户？'],
  'rule-account-closing': ['线上开户需要准备哪些材料？', '银证转账怎么操作？'],
  'rule-trading-hours': ['什么是收盘集合竞价？', '今天卖出股票的钱什么时候能取出？', '涨跌幅限制是多少？'],
  'rule-trading-basics': ['A股每天几点开盘？集合竞价怎么进行？', '科创板最少买多少股？', '股票交易佣金和印花税怎么收？'],
  'rule-price-limit': ['ST 股票的涨跌幅是多少？', '科创板涨跌幅限制是多少？'],
  'rule-fees': ['最低佣金 5 元是什么意思？', '今天卖出股票的钱什么时候能取出？'],
  'rule-app-features': ['条件单怎么设置？', '模拟交易怎么用？'],
  'rule-human-service': ['服务热线的服务时间是什么时候？', '提交的工单一般多久有回复？'],
  'basics-convertible-bond': ['可转债交易需要什么权限？', '什么是回售条款？'],
  'basics-dividend-exright': ['什么是股权登记日？', '红利税怎么计算？'],
  'basics-etf-lof': ['什么是 ETF 的折溢价？', 'ETF 和 LOF 有什么区别？', '公募基金有哪些类型？'],
  'basics-fund-types': ['货币基金和债券基金有什么区别？', 'ETF 和 LOF 有什么区别？'],
  'basics-ipo-subscription': ['新股中签后怎么缴款？', '打新需要多少市值？'],
  'basics-reverse-repo': ['国债逆回购的计息天数怎么算？', '国债逆回购是什么？怎么计息？'],
  'basics-stock-index': ['沪深300 指数是什么？', '科创板和创业板有什么不同？'],
  'basics-suspension-st': ['ST 股票的涨跌幅是多少？', '退市整理期是什么？'],
  'edu-pe-pb': ['市净率怎么理解？', '滚动市盈率 TTM 是什么意思？', '什么是分散投资？'],
  'edu-stop-loss-diversify': ['止损有哪些常见方式？', '什么是资产配置？'],
  'edu-kline': ['阳线和阴线有什么区别？', 'K线的影线代表什么？'],
  'edu-leverage-risk': ['融资融券有哪些主要风险？', '什么是强制平仓？'],
  'edu-dca-compound-fees': ['基金定投是什么？', '基金管理费怎么收？'],
  'edu-fraud-identification': ['怎么识别非法荐股？', '承诺保本保收益的宣传可信吗？'],
  'edu-guaranteed-return': ['怎么识别非法荐股？', '风险测评的有效期是多久？'],
  'suit-risk-matching': ['风险测评的有效期是多久？', '风险等级不匹配会有什么提示？'],
  'suit-risk-assessment': ['风险等级和产品等级怎么匹配？', '投资者适当性管理是什么？'],
  'suit-measures-overview': ['风险等级和产品等级怎么匹配？', '风险测评的有效期是多久？'],
};

/** 越界类别 → 引导到可答的投教问题 */
const BY_CATEGORY: Partial<Record<ComplianceCategory, string[]>> = {
  stock_pick: ['市盈率怎么看？', '什么是分散投资？', '怎么识别非法荐股？'],
  price_prediction: ['阳线和阴线有什么区别？', '止损有哪些常见方式？', '市盈率怎么看？'],
  return_promise: ['承诺保本保收益的宣传可信吗？', '公募基金有哪些类型？', '国债逆回购是什么？怎么计息？'],
  managed_account: ['怎么识别非法荐股？', '服务热线的服务时间是什么时候？'],
  insider_manip: ['怎么识别非法荐股？', '承诺保本保收益的宣传可信吗？'],
  privacy: ['服务热线的服务时间是什么时候？'],
  prompt_injection: ['市盈率怎么看？', '科创板权限开通需要满足什么条件？'],
};

const DEFAULT = ['科创板权限开通需要满足什么条件？', '市盈率怎么看？', 'A股每天几点开盘？集合竞价怎么进行？'];

/** 全部建议问题（供回归脚本逐条实测） */
export const ALL_SUGGESTIONS = [...new Set([
  ...FAQ_GROUPS.flatMap((g) => g.questions), ...Object.values(BY_DOC).flat(), ...Object.values(BY_CATEGORY).flat(), ...DEFAULT, '服务热线的服务时间是什么时候？',
])];

const norm = (s: string) => s.replace(/[\s？?。，,！!]/g, '');

/** 生成 2–3 条推荐追问；排除本轮和已问过的问题 */
export function followUps(resp: ChatResponse, asked: string[]): string[] {
  if (resp.decision === 'handoff_request') return [];
  const seen = new Set(asked.map(norm));
  const pool: string[] = [];
  for (const c of resp.citations ?? []) pool.push(...(BY_DOC[c.docKey] ?? []));
  for (const h of resp.compliance ?? []) pool.push(...(BY_CATEGORY[h.category] ?? []));
  if (resp.decision.startsWith('handoff')) pool.push('服务热线的服务时间是什么时候？');
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

/**
 * 用户端引用编号：按正文中首次出现的顺序重新连续编号（1、2、3…），
 * 正文未引用的出处排在后面；来源抽屉与角标共用这份结果，保证一致。
 */
export function renumberCitations(resp: ChatResponse): ChatResponse {
  const cites = resp.citations ?? [];
  if (!cites.length) return resp;
  const order: number[] = [];
  for (const m of resp.answer.matchAll(/\[(\d+)\]/g)) {
    const n = +m[1];
    if (cites.some((c) => c.n === n) && !order.includes(n)) order.push(n);
  }
  for (const c of cites) if (!order.includes(c.n)) order.push(c.n);
  const map = new Map(order.map((n, i) => [n, i + 1]));
  if (order.every((n, i) => n === i + 1) && cites.every((c, i) => c.n === i + 1)) return resp;
  const answer = resp.answer.replace(/\[(\d+)\]/g, (s, d) => (map.has(+d) ? `[${map.get(+d)}]` : s));
  const citations = cites.map((c) => ({ ...c, n: map.get(c.n)! })).sort((a, b) => a.n - b.n);
  return { ...resp, answer, citations };
}
