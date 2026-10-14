import { useEffect, useState } from 'react';
import { api } from '../api';
import { AnswerText, Breakdown, Crumbs, DecisionTag, Empty, ErrorBox, Icon, Loading, Pager, SortTh, TableSkeleton, go, lastListHref, rememberListPos, useAsync, useHashState, useRestoreListPos } from '../ui/kit';
import { CATEGORY_LABEL, CHECK_LABEL, DECISIONS, DECISION_LABEL, MODE_LABEL, SEVERITY_LABEL, STAGE_LABEL, fmtTime } from '../ui/labels';
import { PageHead } from './OpsApp';

export function SearchBox({ value, onChange, placeholder, label = '搜索' }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string }) {
  return (
    <div className="search">
      <Icon name="search" size={15} />
      <input className="input" data-search value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); } }} placeholder={placeholder} aria-label={label} />
      {!value && <span className="kbd" aria-hidden="true">/</span>}
    </div>
  );
}

const LIST_KEY = 'logs';
const PAGE = 20;
type SortKey = 'ts' | 'confidence' | 'latency' | 'risk';
export function LogsPage({ query: _q }: { query: URLSearchParams }) {
  const [decision, setDecision] = useHashState('decision');
  const [q, setQ] = useHashState('q');
  const [sort, setSort] = useHashState('sort', 'ts');
  const [dir, setDir] = useHashState('dir', 'desc');
  const [pageS, setPageS] = useHashState('page', '1');
  const page = Math.max(1, +pageS || 1);
  const [qDeb, setQDeb] = useState(q);
  useEffect(() => { const t = setTimeout(() => setQDeb(q), 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useAsync(
    () => api.logsPage({ decision, q: qDeb, limit: PAGE, offset: (page - 1) * PAGE, sort: sort as SortKey, dir: dir === 'asc' ? 'asc' : 'desc' }),
    [decision, qDeb, page, sort, dir],
  );
  useRestoreListPos(LIST_KEY, !!data);
  const open = (id: string) => { rememberListPos(LIST_KEY); go(`/ops/logs/${encodeURIComponent(id)}`); };
  const th = (key: SortKey, label: string, cls = '') => (
    <SortTh key={key} active={sort === key} dir={dir === 'asc' ? 'asc' : 'desc'} className={cls} onClick={() => {
      if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir('desc'); }
      setPageS('1');
    }}>{label}</SortTh>
  );
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const clear = () => { setDecision(''); setQ(''); setPageS('1'); };

  return (
    <div className="page">
      <PageHead title="问答追溯" desc="每次回答的决策、置信度、合规命中与检索过程" actions={<button className="btn sm" onClick={reload} disabled={loading}><Icon name="refresh" size={14} /> 刷新</button>} />
      <div className="filters">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPageS('1'); }} placeholder="搜索问题或日志 ID" />
        <select className="input" value={decision} onChange={(e) => { setDecision(e.target.value); setPageS('1'); }} aria-label="按决策筛选">
          <option value="">全部决策</option>
          {DECISIONS.map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
        </select>
        {(decision || q) && <button className="btn sm ghost" onClick={clear}>清除筛选</button>}
        {data && <span className="filter-n num">共 {total} 条</span>}
      </div>
      {error ? <ErrorBox msg={error} onRetry={reload} /> : !data ? <TableSkeleton cols={8} /> : !data.items.length ? (
        decision || q
          ? <Empty title="没有匹配的问答">换个关键词，或<button className="linkish" onClick={clear}>清除筛选</button>。</Empty>
          : page > 1 ? <Empty title="这一页没有记录"><button className="linkish" onClick={() => setPageS('1')}>回到第一页</button></Empty>
          : <Empty title="还没有问答记录">在用户端提一个问题，这里会出现完整追溯。<br /><a href="#/app">打开用户端</a></Empty>
      ) : (
        <>
          <div className={`tbl-wrap${loading ? ' is-loading' : ''}`} aria-busy={loading}>
            <table className="tbl clickable">
              <thead><tr>{th('ts', '时间')}<th>问题</th><th>决策</th>{th('confidence', '置信度', 'r')}{th('risk', '等级')}<th>模式</th><th>版本</th>{th('latency', '耗时', 'r')}<th>反馈</th></tr></thead>
              <tbody>
                {data.items.map((l) => (
                  <tr key={l.id} onClick={() => open(l.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(l.id)}>
                    <td className="nowrap muted num">{fmtTime(l.ts)}</td>
                    <td className="q-cell">{l.question}</td>
                    <td><DecisionTag d={l.decision} compact /></td>
                    <td className="num r">{l.confidence.toFixed(2)}</td>
                    <td className="num">{l.userRisk}</td>
                    <td className="nowrap muted">{MODE_LABEL[l.mode] ?? l.mode}</td>
                    <td className="num muted">{l.kbRelease}</td>
                    <td className="num r nowrap muted">{l.latencyMs} ms</td>
                    <td>{l.feedback === 1 ? <span className="pill tone-green">有用</span> : l.feedback === -1 ? <span className="pill tone-red" title={l.feedbackNote ?? ''}>差评</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages} total={total} size={PAGE} onPage={(n) => { setPageS(String(n)); document.querySelector('.ops-main')?.scrollTo({ top: 0 }); }} />
        </>
      )}
    </div>
  );
}

export function LogDetailPage({ id }: { id: string }) {
  const { data: l, error, loading, reload } = useAsync(() => api.log(id), [id]);
  const [cite, setCite] = useState<number | null>(null);
  const back = <Crumbs items={[{ label: '问答追溯', href: lastListHref(LIST_KEY, '#/ops/logs') }, { label: id }]} />;
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
            <AnswerText text={l.answer || r?.answer || ''} citations={r?.citations} onCite={(n) => setCite((c) => (c === n ? null : n))} active={cite} />
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
