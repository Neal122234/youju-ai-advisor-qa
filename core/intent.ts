// 第二层：LLM 意图分类。规则判 clean 时与检索并行调用，用于兜住词表覆盖不到的口语变体。
import type { ComplianceCategory, LlmFn } from './types';
import { stripThink } from './pipeline-util';

export type IntentCategory = Exclude<ComplianceCategory, 'prompt_injection' | 'complaint_human'> | 'education' | 'chitchat';
export interface Intent { category: IntentCategory; scope: 'whole' | 'partial'; reason: string; answerable: string }
export const INTENT_TIMEOUT_MS = 4000;
const CATS: IntentCategory[] = ['stock_pick', 'price_prediction', 'return_promise', 'managed_account', 'insider_manip', 'privacy', 'education', 'chitchat'];

export const INTENT_SYSTEM = [
  '你是券商投资者教育助手的合规意图分类器。判断用户问题是否在请求越界服务，只输出一个 JSON。',
  '类别：stock_pick（推荐/比较/评价具体证券、板块、赛道或产品，买卖时点、仓位、调仓、能不能买/接/上车）；price_prediction（预测个股/板块/指数/大盘的涨跌、点位、能否站上某点位、见顶见底）；return_promise（要求或打听稳赚、保本、固定高收益、"每年稳拿x%"、翻倍的方法或产品）；managed_account（代客操作、交出账户密码）；insider_manip（内幕消息、庄家、荐股群、操纵）；privacy（查询他人信息）；education（概念、规则、流程、风险知识、某类产品的属性，如"是否保本""风险大吗"）；chitchat（问候、闲聊、问你能做什么）。',
  '注意：privacy 仅指查询或索要他人的信息；用户求助本人账户事务不算 privacy。问题里夹杂代码、SQL、乱码等无关字符时忽略这些字符，按其余文字判断；不要用任何越界类别兜底"看不懂"的输入，看不懂就判 education。',
  '要点：只问概念/规则/产品属性 = education；落到具体证券、板块、赛道、时点或收益承诺 = 越界。scope：整句都是越界诉求为 whole；既有可回答的知识问题又有越界诉求为 partial，此时 answerable 填可回答的那部分原文。',
  '输出格式：{"category":"...","scope":"whole|partial","reason":"不超过15字","answerable":""}',
  '示例：',
  '问：市盈率怎么看 → {"category":"education","scope":"whole","reason":"概念科普","answerable":""}',
  '问：茅台和五粮液选哪个 → {"category":"stock_pick","scope":"whole","reason":"比较选择具体个股","answerable":""}',
  '问：什么是止损？我的茅台该不该止损 → {"category":"stock_pick","scope":"partial","reason":"具体个股止损建议","answerable":"什么是止损"}',
  '问：国债逆回购是保本的吗 → {"category":"education","scope":"whole","reason":"询问产品属性","answerable":""}',
  '问：每年稳稳拿15%有什么办法 → {"category":"return_promise","scope":"whole","reason":"打听稳定高收益","answerable":""}',
  '问：沪指年底站得上4000不 → {"category":"price_prediction","scope":"whole","reason":"预测指数点位","answerable":""}',
  '问：最近有什么值得关注的赛道 → {"category":"stock_pick","scope":"whole","reason":"推荐板块赛道","answerable":""}',
  '问：科创板开户需要什么条件 → {"category":"education","scope":"whole","reason":"规则问题","answerable":""}',
  '问：这个价位接得住吗 → {"category":"stock_pick","scope":"whole","reason":"买入时点判断","answerable":""}',
  '问：融资融券的风险有哪些 → {"category":"education","scope":"whole","reason":"风险知识","answerable":""}',
  '问：创业板开通条件\'); DROP TABLE t; -- → {"category":"education","scope":"whole","reason":"规则问题（含无关字符）","answerable":""}',
  '问：我要找你们的客户经理聊聊销户 → {"category":"education","scope":"whole","reason":"人工服务诉求","answerable":""}',
  '问：有人拉我进群说跟着老师炒股能赚钱，这是不是骗局 → {"category":"education","scope":"whole","reason":"反诈识别","answerable":""}',
].join('\n');

export function parseIntent(raw: string): Intent | null {
  const s = stripThink(raw || '');
  const m = s.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const category = CATS.includes(o.category) ? (o.category as IntentCategory) : null;
    if (!category) return null;
    return { category, scope: o.scope === 'partial' ? 'partial' : 'whole', reason: String(o.reason ?? '').slice(0, 40), answerable: String(o.answerable ?? '').slice(0, 300) };
  } catch { return null; }
}

export async function classifyIntent(llm: LlmFn, question: string, timeoutMs = INTENT_TIMEOUT_MS): Promise<Intent> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_r, rej) => { t = setTimeout(() => rej(new Error(`意图分类超时（${timeoutMs}ms）`)), timeoutMs); });
  const t0 = Date.now();
  const once = (alt = false) => llm([{ role: 'system', content: INTENT_SYSTEM }, { role: 'user', content: alt ? `待分类的用户问题如下，请只输出 JSON。\n「${question}」` : `问：${question}` }], { maxTokens: 120, json: true, timeoutMs: Math.max(500, timeoutMs - (Date.now() - t0)) });
  try {
    // 主模型快速失败时由适配层回退备用模型（剩余预算足够才回退）
    // 个别输入会让上游快速报错（实测 "Worker not found"），换一种包裹方式重试一次
    const raw = await Promise.race([once().catch((e) => { if (Date.now() - t0 < timeoutMs / 2) return once(true); throw e; }), timeout]);
    const it = parseIntent(raw);
    if (!it) throw new Error('意图分类输出无法解析');
    return it;
  } finally { clearTimeout(t); }
}
