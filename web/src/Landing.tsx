import type { ApiMode } from './api';
import { getHealth } from './api';
import { DecisionTag, Icon } from './ui/kit';
import { DECISIONS } from './ui/labels';

const SAMPLES: { q: string; d: string; side: 'in' | 'edge' | 'out' }[] = [
  { q: '科创板权限开通需要什么条件？', d: 'answered', side: 'in' },
  { q: '市盈率怎么看？', d: 'answered', side: 'in' },
  { q: '市盈率怎么看？茅台还能买吗', d: 'partial_refusal', side: 'edge' },
  { q: '基金赎回多久到账？（未收录）', d: 'handoff_unknown', side: 'edge' },
  { q: '宁德时代明天会涨吗？', d: 'refused', side: 'out' },
  { q: '推荐一只保本稳赚的股票', d: 'refused', side: 'out' },
];

const STEPS = [
  ['输入合规', '规则引擎识别荐股、预测、承诺收益、代客理财、注入'],
  ['检索', '关键词 + 向量混合召回，top 6'],
  ['覆盖判断', '召回分过低直接转人工，不让模型硬答'],
  ['生成', '只依据资料作答，每句标注出处 [n]'],
  ['输出合规', '答案再过一遍规则，越界即替换为合规话术'],
  ['引用与落地性', '校验角标合法、逐句比对原文重合度'],
  ['置信度与适当性', '四项加权打分；产品风险高于用户等级时提示'],
];

export function Landing({ mode }: { mode: ApiMode }) {
  const h = getHealth();
  return (
    <div className="landing">
      <header className="l-head">
        <a className="brand" href="#/"><span className="brand-mark" /><span><b>知界</b><small>合规投教助手 · 示例证券</small></span></a>
        <nav className="l-nav">
          <a href="#/app">用户端</a>
          <a href="#/ops">运营后台</a>
        </nav>
      </header>

      <section className="l-hero">
        <div className="l-hero-copy">
          <h1>答在边界之内，<br />越界的留痕拦下。</h1>
          <p className="lede">
            知界是券商 App 里的投教助手：只依据审核过的知识库回答，每句话都能点开出处；荐股、预测涨跌、承诺收益一律拦截并告警；
            答不了的转人工，同时把知识缺口交回运营，补齐、发布、回归验证，形成闭环。
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

        <figure className="boundary" aria-label="问题与合规边界示意">
          <div className="b-cols"><span>知识库之内：作答</span><span>越界请求：拒答</span></div>
          <div className="b-field">
            <div className="b-line" aria-hidden="true" />
            {SAMPLES.map((s) => (
              <div key={s.q} className={`b-q side-${s.side}`}>
                <span className="b-text">{s.q}</span>
                <DecisionTag d={s.d} compact />
              </div>
            ))}
          </div>
          <figcaption>同一个界面里，问题被分到边界两侧；落在边界上的，合规部分照答、越界部分拒答。</figcaption>
        </figure>
      </section>

      <section className="l-users">
        <div>
          <h2>给谁用</h2>
        </div>
        <div className="l-user">
          <h3><Icon name="user" /> App 里的普通投资者</h3>
          <p>尤其是新开户、对规则不熟的用户。问开户条件、交易规则、基础概念，得到带出处的回答；涉及高风险产品时，按其风险等级给出适当性提示。</p>
        </div>
        <div className="l-user">
          <h3><Icon name="grid" /> 知识运营、客服与合规岗</h3>
          <p>在后台看每一次回答的完整追溯，处理越界告警与人工工单，把用户问倒的问题补进知识库，按版本发布、回滚，并用评测集回归。</p>
        </div>
      </section>

      <section className="l-flow">
        <h2>一次回答经过的检查</h2>
        <ol className="flow">
          {STEPS.map(([t, d], i) => (
            <li key={t}><span className="flow-n num">{i + 1}</span><b>{t}</b><span>{d}</span></li>
          ))}
        </ol>
        <div className="flow-out">
          <div className="fo"><DecisionTag d="refused" /><span>越界 → 合规话术拒答，生成告警</span></div>
          <div className="fo"><DecisionTag d="handoff_unknown" /><span>未覆盖 / 低置信 → 转人工工单，记录知识缺口</span></div>
          <div className="fo loop"><span className="loop-steps">缺口 <Icon name="arrowRight" size={12} /> 起草知识 <Icon name="arrowRight" size={12} /> 发布新版本 <Icon name="arrowRight" size={12} /> 回归验证</span><span>闭环：同类问题再问时已能作答</span></div>
        </div>
        <div className="legend">
          <span className="legend-t">决策标签</span>
          {DECISIONS.map((d) => <DecisionTag key={d} d={d} compact />)}
        </div>
      </section>

      <footer className="l-foot">
        <p><b>本产品不构成投资建议。</b>示例证券为虚构机构，知识内容整理自公开监管规则，仅用于演示，具体以监管机构与交易所最新规则为准。市场有风险，投资需谨慎。</p>
      </footer>
    </div>
  );
}
