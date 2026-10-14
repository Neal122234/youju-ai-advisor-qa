import type { Decision } from '../apiTypes';

export const DECISION_LABEL: Record<Decision, string> = {
  answered: '已作答',
  answered_caveat: '作答·建议核实',
  partial_refusal: '部分拒答',
  refused: '越界拒答',
  handoff_unknown: '转人工·知识未覆盖',
  handoff_low_conf: '转人工·置信不足',
  handoff_request: '转人工·用户要求',
  degraded: '降级作答',
};
export const DECISION_TONE: Record<string, string> = {
  answered: 'green', answered_caveat: 'yellow', partial_refusal: 'orange', refused: 'red',
  handoff_unknown: 'blue', handoff_low_conf: 'blue', handoff_request: 'blue', degraded: 'gray',
};
export const DECISIONS: Decision[] = ['answered', 'answered_caveat', 'partial_refusal', 'refused', 'handoff_unknown', 'handoff_low_conf', 'handoff_request', 'degraded'];

export const CATEGORY_LABEL: Record<string, string> = {
  stock_pick: '荐股/买卖点', price_prediction: '涨跌预测', return_promise: '收益承诺', managed_account: '代客理财',
  insider_manip: '内幕/操纵', privacy: '隐私', prompt_injection: '提示注入', complaint_human: '投诉/要人工',
};
export const SEVERITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
export const STAGE_LABEL: Record<string, string> = { input: '输入', output: '输出' };

export const GAP_TYPE_LABEL: Record<string, string> = { unknown: '知识未覆盖', low_conf: '置信不足', bad_feedback: '用户差评', wrong_answer: '答案错误' };
export const GAP_STATUS_LABEL: Record<string, string> = { open: '待处理', drafting: '起草中', resolved: '已解决', ignored: '已忽略' };
export const TICKET_STATUS_LABEL: Record<string, string> = { pending: '待处理', processing: '处理中', closed: '已关闭' };
export const DOC_CATEGORY_LABEL: Record<string, string> = {
  product_rule: '业务规则', market_basics: '市场基础', investor_edu: '投资者教育', compliance_script: '合规话术', suitability: '适当性',
};
export const VERSION_STATUS_LABEL: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' };
export const MODE_LABEL: Record<string, string> = { llm: '大模型', degraded: '降级', local: '本地演示' };
export const EVAL_TYPE_LABEL: Record<string, string> = {
  normal: '正常', mixed: '混合', out_of_scope: '越界', unknown: '未知', injection: '注入', suitability: '适当性', human: '人工',
};
export const CHECK_LABEL: Record<string, string> = {
  input: '输入校验', input_validation: '输入校验', compliance_input: '输入合规', input_compliance: '输入合规', retrieve: '检索', retrieval: '检索',
  coverage: '覆盖判断', generate: '生成', generation: '生成', llm: '生成', compliance_output: '输出合规', output_compliance: '输出合规',
  citation: '引用校验', citations: '引用校验', grounding: '落地性', confidence: '置信度', suitability: '适当性',
};

export const THRESHOLDS = { caveat: 0.45, answered: 0.62 };

export const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
export function fmtTime(s: string | null | undefined, withDate = true) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  const t = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return withDate ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ${t}` : t;
}
