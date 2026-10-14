import type { Adapters, Chunk, Retrieved } from '../../core/types';
import { chunkDocument } from '../../core/chunk';
import { createKeywordRetriever } from '../../core/retrieve';

export function fixtureChunks(): Chunk[] {
  const md1 = `---\ndoc_key: rule-star\ntitle: 科创板权限开通条件\ncategory: product_rule\nproduct_risk: R4\ntags: [科创板]\n---\n## 开通条件\n个人投资者开通科创板权限需满足：申请前 20 个交易日日均资产不低于 50 万元；参与证券交易满 24 个月；完成风险测评。\n\n## 交易单位\n科创板股票单笔申报数量不得少于 200 股，超过部分可按 1 股递增。\n`;
  const md2 = `---\ndoc_key: edu-pe\ntitle: 市盈率怎么理解\ncategory: investor_edu\nproduct_risk: null\ntags: [市盈率]\n---\n## 市盈率的含义\n市盈率等于股价除以每股收益，反映投资者为每一元盈利支付的价格。市盈率高低需要结合行业和成长性判断，不能单独作为买卖依据。\n`;
  const md3 = `---\ndoc_key: script-stock-pick\ntitle: 合规话术：个股推荐\ncategory: compliance_script\nproduct_risk: null\ntags: []\n---\n## 标准话术\n"抱歉，我不能推荐具体证券（测试版话术）。"\n`;
  return [...chunkDocument(md1), ...chunkDocument(md2), ...chunkDocument(md3)];
}

let n = 0;
export function makeAdapters(over: Partial<Adapters> = {}, chunks = fixtureChunks()): Adapters & { calls: string[][] } {
  const calls: string[][] = [];
  const kw = createKeywordRetriever(chunks);
  return {
    retrieve: kw, llm: null, kbRelease: 'vT', newId: () => `id-${++n}`,
    scripts: () => chunks.filter((c) => c.category === 'compliance_script'),
    calls, ...over,
  };
}

/** 一个"按资料[1]首句作答"的假 LLM，记录收到的消息 */
export function echoLlm(calls: string[][], transform?: (s: string) => string) {
  return async (msgs: { role: string; content: string }[]) => {
    if (msgs[0].content.includes('意图分类器')) return '{"category":"education","scope":"whole","reason":"测试","answerable":""}';
    calls.push(msgs.map((m) => m.content));
    const user = msgs[msgs.length - 1].content;
    const m = user.match(/\[1\][^\n]*\n([^\n]+)/);
    const first = (m?.[1] ?? '').split('。')[0];
    const answer = `${first}[1]。`;
    const out = `<think>思考</think>{"answer":${JSON.stringify(answer)},"used":[1],"covered":true}`;
    return transform ? transform(out) : out;
  };
}
export const hitsOf = (r: { hits: Retrieved[] }) => r.hits.map((h) => h.chunk.docKey);
