import { api } from '../api';
import { DecisionTag, ErrorBox, Icon, Loading, useAsync } from '../ui/kit';
import { CATEGORY_LABEL, DECISION_TONE, pct } from '../ui/labels';
import { PageHead } from './OpsApp';

export function Overview() {
  const { data: d, error, loading, reload } = useAsync(() => api.dashboard(), []);
  if (error) return <><PageHead title="总览" /><ErrorBox msg={error} onRetry={reload} /></>;
  if (loading && !d) return <><PageHead title="总览" /><Loading rows={6} /></>;
  if (!d) return null;
  const maxDay = Math.max(1, ...d.daily.map((x) => x.count));
  const totalDist = d.decisionDist.reduce((s, x) => s + x.count, 0) || 1;
  const maxViol = Math.max(1, ...d.topViolations.map((x) => x.count));
  const kpis: { k: string; v: string; sub?: string; href?: string; warn?: boolean }[] = [
    { k: '问答量', v: String(d.total), sub: '近 7 天', href: '#/ops/logs' },
    { k: '自动解决率', v: pct(d.autoResolveRate, 1), sub: '未转人工的占比' },
    { k: '转人工率', v: pct(d.handoffRate, 1), href: '#/ops/tickets' },
    { k: '越界拦截', v: String(d.blockedCount), sub: `待处理告警 ${d.openAlerts}`, href: '#/ops/alerts', warn: d.openAlerts > 0 },
    { k: '平均置信度', v: d.avgConfidence.toFixed(2) },
    { k: '开放缺口', v: String(d.openGaps), href: '#/ops/gaps', warn: d.openGaps > 0 },
  ];
  return (
    <div className="page">
      <PageHead title="总览" desc={`当前知识版本 ${d.kbRelease || '—'}`} actions={<button className="btn sm" onClick={reload}><Icon name="refresh" size={14} /> 刷新</button>} />
      <div className="kpis">
        {kpis.map((x) => {
          const inner = <><span className="kpi-k">{x.k}</span><span className="kpi-v num">{x.v}</span>{x.sub && <span className="kpi-sub">{x.sub}</span>}</>;
          return x.href ? <a key={x.k} className={`kpi${x.warn ? ' warn' : ''}`} href={x.href}>{inner}</a> : <div key={x.k} className="kpi">{inner}</div>;
        })}
      </div>

      <div className="grid-2">
        <section className="panel">
          <h3>决策分布</h3>
          <div className="stack" role="img" aria-label="决策分布">
            {d.decisionDist.map((x) => <span key={x.decision} className={`tone-${DECISION_TONE[x.decision] ?? 'gray'}`} style={{ flexGrow: x.count }} title={`${x.decision} ${x.count}`} />)}
          </div>
          <table className="tbl compact">
            <tbody>
              {d.decisionDist.map((x) => (
                <tr key={x.decision}>
                  <td><a href={`#/ops/logs?decision=${x.decision}`}><DecisionTag d={x.decision} compact /></a></td>
                  <td className="num r">{x.count}</td>
                  <td className="num r muted">{pct(x.count / totalDist, 1)}</td>
                </tr>
              ))}
              {!d.decisionDist.length && <tr><td className="muted">暂无问答</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <h3>近 7 天问答量</h3>
          <div className="bars">
            {d.daily.map((x) => (
              <div key={x.date} className="bar-col" title={`${x.date}：${x.count}`}>
                <span className="num small">{x.count}</span>
                <i style={{ height: `${(x.count / maxDay) * 100}%` }} />
                <span className="muted small">{x.date.slice(5)}</span>
              </div>
            ))}
            {!d.daily.length && <span className="muted">暂无数据</span>}
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-h"><h3>Top 未答问题</h3><a href="#/ops/gaps" className="small">全部缺口</a></div>
          <ol className="rank">
            {d.topUnanswered.map((x, i) => <li key={i}><span className="rank-q">{x.question}</span><span className="num muted">{x.count} 次</span></li>)}
            {!d.topUnanswered.length && <li className="muted">没有未答问题</li>}
          </ol>
        </section>
        <section className="panel">
          <div className="panel-h"><h3>Top 越界类别</h3><a href="#/ops/alerts" className="small">全部告警</a></div>
          <div className="hbars">
            {d.topViolations.map((x) => (
              <div key={x.category} className="hbar">
                <span>{CATEGORY_LABEL[x.category] ?? x.category}</span>
                <span className="hbar-t"><i style={{ width: `${(x.count / maxViol) * 100}%` }} /></span>
                <span className="num">{x.count}</span>
              </div>
            ))}
            {!d.topViolations.length && <span className="muted">暂无越界</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
