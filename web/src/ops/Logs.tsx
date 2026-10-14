import { useEffect, useState } from 'react';
import { api } from '../api';
import { AnswerText, Breakdown, DecisionTag, Empty, ErrorBox, Icon, Loading, go, useAsync } from '../ui/kit';
import { CATEGORY_LABEL, CHECK_LABEL, DECISIONS, DECISION_LABEL, MODE_LABEL, SEVERITY_LABEL, STAGE_LABEL, fmtTime } from '../ui/labels';
import { PageHead } from './OpsApp';

export function LogsPage({ query }: { query: URLSearchParams }) {
  const [decision, setDecision] = useState(query.get('decision') ?? '');
  const [q, setQ] = useState(query.get('q') ?? '');
  const [qDeb, setQDeb] = useState(q);
  useEffect(() => { const t = setTimeout(() => setQDeb(q), 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useAsync(() => api.logs({ decision, q: qDeb, limit: 200 }), [decision, qDeb]);

  return (
    <div className="page">
      <PageHead title="问答追溯" desc="每次回答的决策、置信度、合规命中与检索过程" actions={<button className="btn sm" onClick={reload}><Icon name="refresh" size={14} /> 刷新</button>} />
      <div className="filters">
        <select className="input" value={decision} onChange={(e) => setDecision(e.target.value)} aria-label="按决策筛选">
          <option value="">全部决策</option>
          {DECISIONS.map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
        </select>
        <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索问题或日志 ID" aria-label="搜索" />
      </div>
      {error ? <ErrorBox msg={error} onRetry={reload} /> : loading && !data ? <Loading rows={8} /> : !data?.length ? (
        <Empty title="没有匹配的问答">去用户端提一个问题，这里会出现完整追溯。<br /><a href="#/app">打开用户端</a></Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl clickable">
            <thead><tr><th>时间</th><th>问题</th><th>决策</th><th className="r">置信度</th><th>等级</th><th>模式</th><th>版本</th><th className="r">耗时</th><th>反馈</th></tr></thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id} onClick={() => go(`/ops/logs/${encodeURIComponent(l.id)}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(`/ops/logs/${encodeURIComponent(l.id)}`)}>
                  <td className="nowrap muted num">{fmtTime(l.ts)}</td>
                  <td className="q-cell">{l.question}</td>
                  <td><DecisionTag d={l.decision} compact /></td>
                  <td className="num r">{l.confidence.toFixed(2)}</td>
                  <td className="num">{l.userRisk}</td>
                  <td className="nowrap">{MODE_LABEL[l.mode] ?? l.mode}</td>
                  <td className="num">{l.kbRelease}</td>
                  <td className="num r nowrap">{l.latencyMs} ms</td>
                  <td>{l.feedback === 1 ? <span className="pill tone-green">有用</span> : l.feedback === -1 ? <span className="pill tone-red" title={l.feedbackNote ?? ''}>差评</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function LogDetailPage({ id }: { id: string }) {
  const { data: l, error, loading, reload } = useAsync(() => api.log(id), [id]);
  const [cite, setCite] = useState<number | null>(null);
  const back = <a className="back" href="#/ops/logs"><Icon name="arrowLeft" size={14} /> 问答追溯</a>;
  if (error) return <div className="page">{back}<ErrorBox msg={error} onRetry={reload} /></div>;
  if (loading || !l) return <div className="page">{back}<Loading rows={8} /></div>;
  const r = l.response;
  const maxScore = Math.max(0.0001, ...(r?.retrieval ?? []).map((x) => x.score));
  return (
    <div className="page">
      {back}
      <div className="detail-h">
        <h1 className="q-title">{l.question}</h1>
        <div className="detail-meta">
          <DecisionTag d={l.decision} />
          <span className="muted small num">{l.id}</span>
          <span className="muted small">{fmtTime(l.ts)}</span>
        </div>
      </div>
      <div className="detail-grid">
        <div className="col">
          <section className="panel">
            <h3>回答</h3>
            <AnswerText text={l.answer || r?.answer || ''} onCite={(n) => setCite((c) => (c === n ? null : n))} active={cite} />
            {r?.suitability && <div className={`notice ${r.suitability.matched ? 'tone-green' : 'tone-orange'}`}><b>适当性</b><span>{r.suitability.notice}</span></div>}
            {r?.handoff && <div className="notice tone-blue"><b>转人工</b><span>{r.handoff.reason}{r.handoff.ticketId && <>，工单 <a href={`#/ops/tickets?id=${encodeURIComponent(r.handoff.ticketId)}`}><code>{r.handoff.ticketId}</code></a></>}</span></div>}
            {r?.disclaimer && <p className="disclaimer">{r.disclaimer}</p>}
          </section>

          <section className="panel">
            <h3>引用 <span className="muted small">{r?.citations.length ?? 0}</span></h3>
            {r?.citations.length ? (
              <ol className="source-list flat">
                {r.citations.map((c) => (
                  <li key={c.n} className={cite === c.n ? 'on' : ''}>
                    <div className="src-head static"><span className="cite static">{c.n}</span><span className="src-title">{c.docTitle}</span><span className="muted small">v{c.version} § {c.heading}</span></div>
                    <blockquote>{c.snippet}</blockquote>
                    <div className="muted small num">{c.chunkId}</div>
                  </li>
                ))}
              </ol>
            ) : <p className="muted">本次回答无引用</p>}
          </section>

          <section className="panel">
            <h3>检索结果</h3>
            {r?.retrieval.length ? (
              <table className="tbl compact">
                <thead><tr><th>#</th><th>文档 / 小节</th><th className="r">分数</th></tr></thead>
                <tbody>
                  {r.retrieval.map((x, i) => (
                    <tr key={x.chunkId + i}>
                      <td className="num muted">{i + 1}</td>
                      <td><div>{x.docTitle}</div><div className="muted small">{x.heading} <span className="num">{x.chunkId}</span></div></td>
                      <td className="r score-cell"><span className="score-bar"><i style={{ width: `${(x.score / maxScore) * 100}%` }} /></span><span className="num">{x.score.toFixed(3)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">未检索（越界拒答或转人工时不进入检索）或无召回</p>}
          </section>
        </div>

        <div className="col">
          <section className="panel">
            <h3>运行信息</h3>
            <dl className="dl">
              <dt>知识版本</dt><dd className="num">{l.kbRelease || r?.kbRelease}</dd>
              <dt>模式</dt><dd>{MODE_LABEL[l.mode] ?? l.mode}</dd>
              <dt>模型</dt><dd className="num">{r?.model ?? '无（未调用大模型）'}</dd>
              <dt>耗时</dt><dd className="num">{l.latencyMs} ms</dd>
              <dt>用户等级</dt><dd className="num">{l.userRisk}</dd>
              <dt>会话</dt><dd className="num">{l.sessionId || '—'}</dd>
              <dt>用户反馈</dt><dd>{l.feedback === 1 ? '有用' : l.feedback === -1 ? `差评${l.feedbackNote ? '：' + l.feedbackNote : ''}` : '—'}</dd>
            </dl>
          </section>

          {r && (
            <section className="panel">
              <h3>置信度拆解</h3>
              <Breakdown b={r.confidenceBreakdown} total={r.confidence} />
            </section>
          )}

          <section className="panel">
            <h3>合规命中</h3>
            {r?.compliance.length ? (
              <ul className="hits">
                {r.compliance.map((h, i) => (
                  <li key={i}>
                    <span className={`pill tone-${h.severity === 'high' ? 'red' : h.severity === 'medium' ? 'orange' : 'gray'}`}>{SEVERITY_LABEL[h.severity]}</span>
                    <b>{CATEGORY_LABEL[h.category] ?? h.category}</b>
                    <span className="muted small">{STAGE_LABEL[h.stage]}阶段</span>
                    <mark>{h.matched}</mark>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">无命中</p>}
          </section>

          <section className="panel">
            <h3>校验步骤</h3>
            {r?.checks.length ? (
              <ol className="timeline">
                {r.checks.map((c, i) => (
                  <li key={i} className={c.pass ? 'pass' : 'fail'}>
                    <span className="tl-dot" aria-label={c.pass ? '通过' : '未通过'}>{c.pass ? <Icon name="check" size={11} /> : <Icon name="x" size={11} />}</span>
                    <div><b>{CHECK_LABEL[c.name] ?? c.name}</b> <span className="muted small num">{c.name}</span><div className="tl-detail">{c.detail}</div></div>
                  </li>
                ))}
              </ol>
            ) : <p className="muted">无记录</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
