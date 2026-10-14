import { useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Dashboard } from '../apiTypes';
import { DecisionTag, Empty, ErrorBox, Icon, Loading, Sparkline, useAsync } from '../ui/kit';
import { CATEGORY_LABEL, DECISION_TONE, pct } from '../ui/labels';
import { PageHead } from './OpsApp';

/** 补齐最近 7 天（接口可能缺无数据的日期） */
function last7(daily: Dashboard['daily']): Dashboard['daily'] {
  if (!daily.length) return [];
  const m = new Map(daily.map((d) => [d.date, d.count]));
  const end = new Date(daily.map((d) => d.date).sort().at(-1)! + 'T00:00:00');
  const out: Dashboard['daily'] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end); d.setDate(end.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ date: k, count: m.get(k) ?? 0 });
  }
  return out;
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return null;
  if (!prev) return <span className="delta up">新增</span>;
  const r = (cur - prev) / prev;
  const cls = Math.abs(r) < 0.005 ? 'flat' : r > 0 ? 'up' : 'down';
  return <span className={`delta ${cls}`}>{r > 0 ? '+' : ''}{(r * 100).toFixed(0)}%</span>;
}

function DailyChart({ data }: { data: Dashboard['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 180, pl = 28, pb = 22, pt = 10;
  const max = Math.max(1, ...data.map((d) => d.count));
  const nice = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const bw = (W - pl) / data.length;
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / nice);
  const h = hover != null ? data[hover] : null;
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`近 7 天问答量：${data.map((d) => `${d.date.slice(5)} ${d.count}`).join('，')}`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line className="ch-grid" x1={pl} x2={W} y1={y(nice * t)} y2={y(nice * t)} />
            <text className="ch-axis" x={pl - 6} y={y(nice * t) + 4} textAnchor="end">{nice * t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pl + i * bw + bw * 0.22, w = bw * 0.56;
          return (
            <g key={d.date}>
              <rect className={`ch-bar${hover != null && hover !== i ? ' dim' : ''}`} x={x} y={y(d.count)} width={w} height={Math.max(1, y(0) - y(d.count))} rx="3" />
              <text className="ch-axis" x={x + w / 2} y={H - 6} textAnchor="middle">{d.date.slice(5)}</text>
              <rect className="ch-hit" x={pl + i * bw} y={0} width={bw} height={H} onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {h && hover != null && (
        <div className="ch-tip" style={{ left: `${((pl + hover * bw + bw / 2) / W) * 100}%`, top: `${(y(h.count) / H) * 100}%` }}>
          <span className="muted">{h.date}</span><b className="num">{h.count} 次问答</b>
        </div>
      )}
    </div>
  );
}

export function Overview() {
  const { data: d, error, loading, reload } = useAsync(() => api.dashboard(), []);
  if (error) return <div className="page"><PageHead title="总览" /><ErrorBox msg={error} onRetry={reload} /></div>;
  if (loading && !d) return <div className="page"><PageHead title="总览" /><Loading rows={6} /></div>;
  if (!d) return null;
  const days = last7(d.daily);
  const today = days.at(-1)?.count ?? 0, yday = days.at(-2)?.count ?? 0;
  const totalDist = d.decisionDist.reduce((s, x) => s + x.count, 0) || 1;
  const maxViol = Math.max(1, ...d.topViolations.map((x) => x.count));
  const kpis: { k: string; v: string; sub?: ReactNode; href?: string; warn?: boolean; spark?: number[] }[] = [
    { k: '问答量', v: String(d.total), sub: days.length ? <>今日 {today} <Delta cur={today} prev={yday} /><span>较昨日</span></> : '近 7 天', href: '#/ops/logs', spark: days.map((x) => x.count) },
    { k: '自动解决率', v: pct(d.autoResolveRate, 1), sub: '未转人工的占比' },
    { k: '转人工率', v: pct(d.handoffRate, 1), sub: '生成人工工单', href: '#/ops/tickets' },
    { k: '越界拦截', v: String(d.blockedCount), sub: `待处理告警 ${d.openAlerts}`, href: '#/ops/alerts', warn: d.openAlerts > 0 },
    { k: '平均置信度', v: d.avgConfidence.toFixed(2), sub: '≥ 0.62 直接作答' },
    { k: '开放缺口', v: String(d.openGaps), sub: '待补充知识', href: '#/ops/gaps', warn: d.openGaps > 0 },
  ];
  return (
    <div className="page">
      <PageHead title="总览" desc={`近 7 天 · 当前知识版本 ${d.kbRelease || '—'}`} actions={<button className="btn sm" onClick={reload} disabled={loading}><Icon name="refresh" size={14} /> 刷新</button>} />
      <div className="kpis">
        {kpis.map((x) => {
          const inner = (
            <>
              <span className="kpi-k">{x.k}</span>
              <div className="kpi-row"><span className="kpi-v num">{x.v}</span>{x.spark && <Sparkline values={x.spark} />}</div>
              {x.sub && <span className="kpi-sub">{x.sub}</span>}
            </>
          );
          return x.href ? <a key={x.k} className={`kpi${x.warn ? ' warn' : ''}`} href={x.href}>{inner}</a> : <div key={x.k} className="kpi">{inner}</div>;
        })}
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-h"><h3>问答量</h3><span className="muted small">近 7 天 · 悬停查看当日</span></div>
          {days.length ? <DailyChart data={days} /> : <Empty compact title="暂无数据" />}
        </section>
        <section className="panel">
          <div className="panel-h"><h3>回答类型分布</h3><a href="#/ops/logs">全部问答</a></div>
          <div className="stack" role="img" aria-label="回答类型分布">
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
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-h"><h3>高频未答问题</h3><a href="#/ops/gaps">全部缺口</a></div>
          <ol className="rank">
            {d.topUnanswered.map((x, i) => <li key={i}><span className="rank-q">{x.question}</span><span className="num muted">{x.count} 次</span></li>)}
            {!d.topUnanswered.length && <li className="muted">没有未答问题</li>}
          </ol>
        </section>
        <section className="panel">
          <div className="panel-h"><h3>越界请求类别</h3><a href="#/ops/alerts">全部告警</a></div>
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
