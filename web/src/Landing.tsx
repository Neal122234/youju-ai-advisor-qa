import type { ApiMode } from './api';
import { getHealth } from './api';
import { DecisionTag, Icon } from './ui/kit';
import { DECISIONS } from './ui/labels';

const STEPS = [
  ['理解问题', '先识别问题类型；荐股、预测涨跌、承诺收益等请求在这一步分流'],
  ['找出处', '关键词与语义双路检索知识库，取最相关的 6 段'],
  ['判断够不够', '资料覆盖不到就转人工，不让模型凭空作答'],
  ['作答', '只用找到的资料回答，每句话标注出处 [n]'],
  ['复核措辞', '答案发出前再过一遍合规规则'],
  ['核对引用', '检查每个角标都对得上原文'],
  ['风险提示', '综合打分；产品风险高于你的等级时附上提示'],
];

const OPS = [
  ['doc', '每次回答可追溯', '问题、命中的资料、每一步检查和最终答案都留有记录，可以逐条回看。'],
  ['gap', '问倒的问题自动成为知识缺口', '转人工、低置信和用户差评的问题自动汇总，按出现次数排序。'],
  ['refresh', '补知识、发版、回归验证', '起草新知识，发布为新版本，用评测集确认原来答对的题仍然答对，可回滚。'],
  ['shield', '风险请求自动告警', '荐股、预测、承诺收益、代客理财等请求自动生成告警，供合规岗处理。'],
] as const;

export function Landing({ mode }: { mode: ApiMode }) {
  const h = getHealth();
  return (
    <div className="landing">
      <header className="l-head">
        <a className="brand" href="#/"><span className="brand-mark" /><span><b>有据</b><small>有据可查的投资问答助手 · 示例证券</small></span></a>
        <nav className="l-nav">
          <a href="#/app">用户端</a>
          <a href="#/ops">运营后台</a>
        </nav>
      </header>

      <section className="l-hero">
        <div className="l-hero-copy">
          <h1>投资问题，<br />有据可答。</h1>
          <p className="lede">
            开户、交易规则、产品知识，在 App 里随问随答。每句回答都标着出处，点开就能看到原文；涉及风险较高的产品，按你的风险等级先给提示；资料里没有的问题，一键转人工客服。
          </p>
          <div className="l-cta">
            <a className="btn primary lg" href="#/app">体验用户端</a>
            <a className="btn lg" href="#/ops">进入运营后台</a>
          </div>
          <p className="l-status">
            {mode === 'remote'
              ? <>服务在线，知识库 {h?.kbRelease || "—"}，{h?.chunks ?? 0} 个知识块，大模型{h?.ai ? '可用' : '不可用（降级为原文摘录）'}</>
              : <>当前为本地演示模式：浏览器内运行同一套规则与检索，不调用大模型。</>}
          </p>
        </div>

        <figure className="answer-trace" aria-label="一个回答是怎么来的">
          <ol className="t-steps">
            <li className="t-row">
              <span className="t-k">问题</span>
              <div className="t-ask">科创板权限开通需要什么条件？</div>
            </li>
            <li className="t-row">
              <span className="t-k">出处</span>
              <div className="t-doc">
                <div className="t-doc-h"><span className="cite">1</span><b>科创板个人投资者权限开通条件</b></div>
                <p>开通前 20 个交易日，<mark>账户资产日均不低于 50 万元</mark>；<mark>参与证券交易 24 个月以上</mark>；
                  <mark>完成风险测评且结果匹配</mark>，签署风险揭示书。</p>
                <small>知识库 · 业务规则，2026-01-01 生效</small>
              </div>
            </li>
            <li className="t-row">
              <span className="t-k">作答</span>
              <div className="t-ans">
                <p>需同时满足三项：前 20 个交易日日均资产不低于 50 万元<span className="cite">1</span>；证券交易经验满 24 个月<span className="cite">1</span>；完成风险测评并签署风险揭示书。<span className="cite">1</span></p>
                <p className="t-risk"><Icon name="info" size={14} />科创板股票风险等级 R4，高于你当前的 C3，开通前需重新评估风险承受能力。</p>
              </div>
            </li>
          </ol>
          <p className="t-else"><Icon name="headset" size={14} /><span>资料里找不到的问题不会硬答：直接转人工客服，并记为待补充的知识。</span></p>
          <figcaption>示例出自知识库原文。产品里点角标 [1] 即可展开整段出处。</figcaption>
        </figure>
      </section>

      <section className="l-users">
        <div>
          <h2>给谁用</h2>
        </div>
        <div className="l-user">
          <h3><Icon name="user" /> App 里的投资者</h3>
          <p>尤其是刚开户、对规则还不熟的用户。开户条件、交易时间与费用、基金债券等基础知识，问一句就有带出处的回答，不必在公告和规则原文里翻找。</p>
        </div>
        <div className="l-user">
          <h3><Icon name="grid" /> 知识运营、客服与合规同事</h3>
          <ul className="l-ops">
            {OPS.map(([icon, t, d]) => (
              <li key={t}><Icon name={icon} size={15} /><span><b>{t}</b>{d}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="l-flow">
        <h2>一个回答背后的七步</h2>
        <ol className="flow">
          {STEPS.map(([t, d], i) => (
            <li key={t}><span className="flow-n num">{i + 1}</span><b>{t}</b><span>{d}</span></li>
          ))}
        </ol>
        <div className="flow-out">
          <div className="fo"><DecisionTag d="answered" /><span>资料充分 → 作答并标注出处，按风险等级附提示</span></div>
          <div className="fo"><DecisionTag d="handoff_unknown" /><span>资料不足 → 转人工工单，同时记为知识缺口</span></div>
          <div className="fo loop"><span className="loop-steps">缺口 <Icon name="arrowRight" size={12} /> 起草知识 <Icon name="arrowRight" size={12} /> 发布新版本 <Icon name="arrowRight" size={12} /> 回归验证</span><span>同类问题再有人问时，已经能答</span></div>
        </div>
        <div className="legend">
          <span className="legend-t">回答状态</span>
          {DECISIONS.map((d) => <DecisionTag key={d} d={d} compact />)}
        </div>
      </section>

      <section className="l-base">
        <h2>内置的专业底线</h2>
        <p>
          有据只做投资者教育，不推荐具体证券、不预测涨跌、不承诺收益、不代客理财。遇到这类请求，规则知识部分照常回答，越界部分说明原因并留痕告警；产品风险高于你的风险等级时，按适当性要求先作提示。这些规则在提问和作答两个环节各检查一次，运营后台可查看每一次触发记录。
        </p>
      </section>

      <footer className="l-foot">
        <p><b>本产品不构成投资建议。</b>示例证券为虚构机构，知识内容整理自公开监管规则，仅用于演示，具体以监管机构与交易所最新规则为准。市场有风险，投资需谨慎。</p>
      </footer>
    </div>
  );
}
