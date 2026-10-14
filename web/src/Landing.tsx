import type { ApiMode } from './api';
import { getHealth } from './api';
import type { ChatResponse } from './apiTypes';
import { Icon } from './ui/kit';
import { AnswerCard } from './user/AnswerCard';

/** 首屏右侧的真实对话截面：用产品里的同一套组件渲染，内容取自知识库原文 */
const SAMPLE: ChatResponse = {
  id: 'landing-sample', decision: 'answered', mode: 'llm', confidence: 0.81, kbRelease: 'v1', latencyMs: 0, model: null,
  answer: '开通科创板股票交易权限需同时满足三项条件：申请前 20 个交易日，证券账户及资金账户内资产日均不低于人民币 50 万元[1]；参与证券交易 24 个月以上[1]；完成风险承受能力测评且结果匹配，并签署《科创板股票交易风险揭示书》[1]。在 App「业务办理—科创板权限」中提交，审核通过后一般下一个交易日生效[2]。',
  citations: [
    { n: 1, chunkId: 'rule-star-market-access@v1#0', docKey: 'rule-star-market-access', docTitle: '科创板个人投资者权限开通条件', version: 1, heading: '开通条件', snippet: '' },
    { n: 2, chunkId: 'rule-star-market-access@v1#1', docKey: 'rule-star-market-access', docTitle: '科创板个人投资者权限开通条件', version: 1, heading: '示例证券的办理方式', snippet: '' },
  ],
  confidenceBreakdown: { retrieval: 0.9, coverage: 1, grounding: 0.7, citation: 1 },
  handoff: null,
  suitability: { userRisk: 'C3', productRisk: 'R4', matched: false, notice: '科创板权限风险等级为 R4，高于您当前的风险承受能力 C3。如仍有意了解，请先重新评估风险承受能力。' },
  disclaimer: '投资有风险，入市需谨慎。以上内容仅为投资者教育信息，不构成投资建议。',
  compliance: [], checks: [], retrieval: [],
};

const FOR_USERS = [
  ['回答附出处', '点角标即可查看知识库原文，以及文档版本和所在小节。'],
  ['按风险等级提示', '产品风险高于你的测评结果时，先告知再作答。'],
  ['答不了就转人工', '资料覆盖不到的问题不硬答，直接生成工单，由人工客服在服务时间内回复。'],
] as const;
const FOR_OPS = [
  ['每次回答可追溯', '命中的资料、每一步校验和置信度拆解都有记录。'],
  ['问倒的问题归并为知识缺口', '补写知识、发布新版本、回归验证，在一处完成，可随时回滚。'],
  ['风险请求自动告警', '荐股、预测涨跌、承诺收益、代客理财等请求自动留痕，供合规处理。'],
] as const;

export function Landing({ mode }: { mode: ApiMode }) {
  const h = getHealth();
  return (
    <div className="landing">
      <header className="l-head">
        <a className="brand" href="#/"><span className="brand-mark" /><span><b>有据</b><small>有据可查的投资问答助手 · 示例证券</small></span></a>
        <nav className="l-nav">
          <a href="#/app">投资问答</a>
          <a href="#/ops">运营后台</a>
          <a className="btn sm primary" href="#/app">开始提问</a>
        </nav>
      </header>

      <section className="l-hero">
        <div className="l-hero-copy">
          <h1>投资问题，<br />有据可答。</h1>
          <p className="lede">开户、交易规则、产品知识随问随答。每条回答附知识库原文出处，涉及高风险产品时按你的风险等级提示，资料覆盖不到的问题直接转人工客服。</p>
          <div className="l-cta">
            <a className="btn primary lg" href="#/app">开始提问</a>
            <a className="btn lg" href="#/ops">运营后台</a>
          </div>
          <p className={`l-status${mode === 'remote' ? '' : ' off'}`}>
            <i aria-hidden="true" />
            {mode === 'remote'
              ? <>服务在线 · 知识库 {h?.kbRelease || '—'} · {h?.chunks ?? 0} 个知识块</>
              : <>本地演示模式 · 回答为知识库原文摘录</>}
          </p>
        </div>

        <div className="l-shot" aria-hidden="true">
          <div className="phone">
            <div className="phone-h">
              <span className="icon-btn"><Icon name="arrowLeft" /></span>
              <div className="phone-title"><b>有据 · 投资问答</b><small>示例证券</small></div>
              <span className="icon-btn"><Icon name="compose" size={17} /></span>
            </div>
            <div className="phone-body">
              <div className="phone-msgs">
                <div className="bubble-u">科创板权限开通需要满足什么条件？</div>
                <AnswerCard resp={SAMPLE} ts={new Date().setHours(9, 41, 0, 0)} animate={false} showTech={false} busy={false}
                  followUps={['创业板开通门槛是多少？', '风险测评的有效期是多久？']} onAsk={() => {}} onSources={() => {}} />
              </div>
            </div>
            <div className="phone-input">
              <div className="composer"><span className="composer-ta muted">输入你的问题</span><span className="send"><Icon name="send" /></span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="l-two">
        <div className="l-col">
          <h2>对投资者</h2>
          <p>在 App 里直接问，不用翻公告和规则原文。</p>
          <ul className="l-list">{FOR_USERS.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ul>
          <a className="btn" href="#/app">打开投资问答</a>
        </div>
        <div className="l-col">
          <h2>对运营与合规</h2>
          <p>知识运营、客服和合规同事共用一个后台。</p>
          <ul className="l-list">{FOR_OPS.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ul>
          <a className="btn" href="#/ops">进入运营后台</a>
        </div>
      </section>

      <footer className="l-foot">
        <p>内置合规底线：不推荐具体证券、不预测涨跌、不承诺收益、不代客理财，越界请求在提问和作答两个环节拦截并留痕。</p>
        <p>本产品不构成投资建议。示例证券为虚构机构，知识内容整理自公开监管规则，仅用于演示，具体以监管机构与交易所最新规则为准。市场有风险，投资需谨慎。</p>
      </footer>
    </div>
  );
}
