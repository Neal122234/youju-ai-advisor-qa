// 合规话术模板。优先取自知识库 compliance_script 文档的「标准话术」小节（运营改话术只需发版 kb），
// 下方 DEFAULT_SCRIPTS 是同文内置副本，仅在知识库缺失对应文档时兜底。
import type { Chunk, ComplianceCategory, ProductRisk, RiskLevel } from './types';

export type ScriptKey =
  | 'stock_pick' | 'price_prediction' | 'return_promise' | 'managed_account' | 'insider_manip' | 'privacy'
  | 'disclaimer' | 'suitability' | 'handoff_request' | 'handoff_unknown' | 'handoff_low_conf' | 'injection';

interface ScriptSpec { docKey: string; heading: RegExp; text: string }

export const DEFAULT_SCRIPTS: Record<ScriptKey, ScriptSpec> = {
  stock_pick: { docKey: 'script-stock-pick', heading: /^标准话术/, text: '抱歉，我是示例证券的投资者教育助手，不能推荐具体证券，也不能就具体证券的买入、卖出、持有或仓位给出建议。投资决策需要结合您自身的财务状况、投资目标和风险承受能力独立判断。如需专业的投资顾问服务，可以通过示例证券官方渠道了解具备资质的投顾服务。' },
  price_prediction: { docKey: 'script-price-prediction', heading: /^标准话术/, text: '抱歉，我无法预测任何证券、板块或指数的未来涨跌，也不提供目标价或点位判断。证券价格受宏观经济、行业变化、公司经营、市场情绪等多种因素影响，具有很大不确定性。建议您以官方公告和公开披露信息为依据，结合自身风险承受能力独立决策。' },
  return_promise: { docKey: 'script-return-promise', heading: /^标准话术/, text: '抱歉，我不能承诺任何投资的本金安全或收益水平。证券、基金等投资产品均存在亏损的可能，过往业绩也不代表未来表现。按照监管要求，证券经营机构及其工作人员不得向投资者承诺保本或最低收益。不同产品的风险等级不同，建议您先了解产品说明书，并选择与自身风险承受能力相匹配的产品。' },
  managed_account: { docKey: 'script-managed-account', heading: /^标准话术/, text: '抱歉，示例证券及其工作人员不能代您进行任何交易操作，也不会以任何理由索要您的交易密码、资金密码或短信验证码。请不要把密码告诉任何人，包括自称示例证券员工的人。证券账户应由您本人使用和操作，将账户交给他人操作存在严重的资金安全风险，相关损失也难以得到保护。如果您已泄露密码，请尽快在 App 中修改密码，必要时联系人工客服办理账户保护。' },
  insider_manip: { docKey: 'script-insider-group', heading: /^标准话术/, text: "抱歉，我无法提供任何未公开信息，也不会推荐荐股群或带单服务。利用内幕信息交易、泄露内幕信息、操纵证券市场都是《证券法》明确禁止的违法行为，需承担法律责任。上市公司的重大信息应以其在交易所和法定信息披露媒体上发布的公告为准。所谓'内部消息''带你赚钱'的群组，很多是非法荐股或诈骗，请注意防范。" },
  privacy: { docKey: 'script-privacy', heading: /^标准话术/, text: '抱歉，我不能查询或提供任何他人的账户、持仓、交易或身份信息。依据《个人信息保护法》等规定，示例证券对客户信息严格保密，仅在法律规定的情形下依法提供。查询本人账户信息，请登录您本人的示例证券 App 或携带本人有效证件前往营业部办理。请不要在对话中发送身份证号、银行卡号、密码等敏感信息。' },
  disclaimer: { docKey: 'script-risk-disclaimer', heading: /^标准话术/, text: '风险提示：投资有风险，入市需谨慎。以上内容仅为投资者教育信息，不构成任何投资建议或收益承诺，不作为买卖证券的依据。请结合自身风险承受能力独立决策，具体规则以监管机构、交易所及示例证券最新公告为准。' },
  suitability: { docKey: 'script-risk-disclaimer', heading: /^适当性提示/, text: '该类产品/业务风险等级为 Rx，高于您当前的风险承受能力 Cx。按照投资者适当性管理规定，示例证券不会主动向您推介该类产品；如您仍有意了解，请先重新评估风险承受能力，并充分了解产品风险。' },
  handoff_request: { docKey: 'script-human-handoff', heading: /^标准话术.*(人工|投诉)/, text: '好的，已为您创建人工服务工单（工单号：{ticketId}），人工客服将在服务时间内尽快与您联系。人工服务时间为交易日 8:30–17:30（示例），您也可以拨打示例证券客服热线。如需投诉，我们会按投诉流程登记并跟进处理结果。' },
  handoff_unknown: { docKey: 'script-human-handoff', heading: /^标准话术.*无法回答/, text: '抱歉，这个问题我目前还没有准确的资料可以回答，为避免给您错误信息，已为您转接人工客服（工单号：{ticketId}）。我们也会把这个问题记录下来，用于完善投教内容。' },
  handoff_low_conf: { docKey: 'script-human-handoff', heading: /^标准话术.*置信/, text: '以下是我找到的相关参考信息，但可能不完整，已标记为待人工确认。如需准确答复，已为您创建人工工单（工单号：{ticketId}）。' },
  injection: { docKey: '', heading: /^$/, text: '我只能依据示例证券投资者教育知识库回答规则与知识类问题，无法执行修改规则、角色设定或输出内部指令的要求。您可以直接提出想了解的业务规则或投资知识问题。' },
};

/** 问候/闲聊/"你能做什么"的固定自我介绍（不建工单、不记缺口） */
export const INTRO_TEXT = '您好，我是示例证券的投资问答助手「有据」。开户与销户、交易规则与时间、科创板/创业板等权限开通条件、交易费用、基金债券等基础知识，以及风险测评与适当性匹配，都可以问我。每条回答都会标注资料出处，涉及风险较高的产品会按您的风险等级提示。作为投资者教育服务，我不推荐具体证券、不预测涨跌或点位、不承诺收益或保本、不代客操作，也不会索要您的密码。需要人工服务时，直接说"转人工"即可。';
export const CHITCHAT_RE = /^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|在不在|早上好|上午好|中午好|下午好|晚上好|早安|晚安|谢谢|谢谢你|多谢|感谢|好的|ok|嗯|你是谁|你叫什么|你是什么|你能做什么|你可以做什么|你会什么|你有什么功能|有什么功能|能做什么|怎么用|怎么使用|介绍一下你自己|介绍下自己|自我介绍)[呀啊呢吗吧哈~～！!。.？?,，\s]*$/i;
export const THANKS_RE = /^(谢谢|谢谢你|谢谢您|多谢|感谢|感谢你|感谢您|辛苦了|谢啦|thanks|thankyou|thx)[^\u3400-\u9fffa-z]*((你|您)?(辛苦了|了|啦|哈|呀|啊))?[^\u3400-\u9fffa-z]*$/i;
export const THANKS_TEXT = '不客气，很高兴能帮到您。还有其他关于交易规则、开户或投资知识的问题，随时可以问我。';
export const UNCLEAR_TEXT = '抱歉，我没太理解您的问题。您可以用一句话描述想了解的内容，例如"科创板开通需要什么条件""ETF 和 LOF 有什么区别"；需要人工服务可以直接说"转人工"。';
export const CAVEAT_TEXT = '（以上信息可能不完整，建议以交易所及示例证券最新公告为准；如需进一步确认，可转人工客服。）';
export const DEGRADED_PREFIX = '（智能生成服务暂不可用，以下为知识库原文摘录）';
export const LOCAL_PREFIX = '（本地演示模式：以下为知识库原文摘录）';

const CATEGORY_KEY: Partial<Record<ComplianceCategory, ScriptKey>> = {
  stock_pick: 'stock_pick', price_prediction: 'price_prediction', return_promise: 'return_promise',
  managed_account: 'managed_account', insider_manip: 'insider_manip', privacy: 'privacy',
};
export const scriptKeyFor = (c: ComplianceCategory): ScriptKey | null => CATEGORY_KEY[c] ?? null;

/** 拒答主类别优先级（多类别同时命中时，第一个作为主话术） */
export const REFUSAL_PRIORITY: ComplianceCategory[] = ['insider_manip', 'managed_account', 'privacy', 'return_promise', 'price_prediction', 'stock_pick'];

function stripQuotes(t: string): string {
  const s = t.trim();
  const m = s.match(/[“"]([\s\S]+?)[”"]\s*$/) ?? s.match(/^[“"]([\s\S]+)[”"]$/);
  return (m ? m[1] : s).trim();
}

export interface ScriptEntry { text: string; chunk: Chunk | null }
export interface ScriptBook { get(key: ScriptKey): ScriptEntry }

/** 从知识库块构建话术本：找 docKey + 小标题匹配的块，取其中引号内的标准话术 */
export function buildScriptBook(chunks: Chunk[] = []): ScriptBook {
  const cache = new Map<ScriptKey, ScriptEntry>();
  return {
    get(key) {
      const hit = cache.get(key); if (hit) return hit;
      const spec = DEFAULT_SCRIPTS[key];
      let entry: ScriptEntry = { text: spec.text, chunk: null };
      if (spec.docKey) {
        const c = chunks.find((x) => x.docKey === spec.docKey && spec.heading.test(x.heading));
        if (c) {
          let text = c.text;
          if (key === 'suitability') { const q = text.match(/[“"]([\s\S]+?)[”"]/); if (q) text = q[1]; }
          else text = stripQuotes(text);
          if (text.length >= 10) entry = { text, chunk: c };
          else entry = { text: spec.text, chunk: c };
        }
      }
      cache.set(key, entry);
      return entry;
    },
  };
}

export function suitabilityNotice(book: ScriptBook, productRisk: ProductRisk, userRisk: RiskLevel): string {
  return book.get('suitability').text.replace(/R[x1-5]/, productRisk).replace(/C[x1-5]/, userRisk);
}

export function fillTicket(text: string, ticketId: string | null): string {
  return text.replace(/\{ticketId\}/g, ticketId ?? '待生成');
}
