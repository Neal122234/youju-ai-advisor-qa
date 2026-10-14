import { useState } from 'react';
import { api } from '../api';
import { Empty, ErrorBox, Icon, Loading, toast, useAsync } from '../ui/kit';
import { CATEGORY_LABEL, SEVERITY_LABEL, STAGE_LABEL, fmtTime } from '../ui/labels';
import { PageHead } from './OpsApp';

function Highlight({ text, m }: { text: string; m: string }) {
  const i = m ? text.indexOf(m) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{m}</mark>{text.slice(i + m.length)}</>;
}

export function AlertsPage() {
  const [status, setStatus] = useState('open');
  const [cat, setCat] = useState('');
  const { data, error, loading, reload, setData } = useAsync(() => api.alerts(status || undefined), [status]);
  const list = (data ?? []).filter((a) => !cat || a.category === cat);
  async function ack(id: string) {
    try {
      await api.ackAlert(id);
      setData((d) => (d ?? []).map((a) => (a.id === id ? { ...a, status: 'ack' as const, handledAt: new Date().toISOString(), handledBy: a.handledBy ?? '运营' } : a)).filter((a) => !status || a.status === status));
      toast('已确认处理', 'green');
    } catch (e: any) { toast('操作失败：' + e.message, 'red'); }
  }
  return (
    <div className="page">
      <PageHead title="越界告警" desc="输入或输出命中合规规则的记录；确认处理后留痕" actions={<button className="btn sm" onClick={reload}><Icon name="refresh" size={14} /> 刷新</button>} />
      <div className="filters">
        <div className="seg" role="radiogroup" aria-label="状态">
          {[['open', '待处理'], ['ack', '已处理'], ['', '全部']].map(([v, l]) => <button key={v} role="radio" aria-checked={status === v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>{l}</button>)}
        </div>
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="类别">
          <option value="">全部类别</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error ? <ErrorBox msg={error} onRetry={reload} /> : loading && !data ? <Loading rows={6} /> : !list.length ? (
        <Empty title={status === 'open' ? '没有待处理的告警' : '没有告警'}>在用户端问「宁德时代明天会涨吗」这类问题会触发告警。</Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>时间</th><th>类别</th><th>严重度</th><th>阶段</th><th>问题与命中片段</th><th>状态</th><th /></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap muted num">{fmtTime(a.ts)}</td>
                  <td className="nowrap">{CATEGORY_LABEL[a.category] ?? a.category}</td>
                  <td><span className={`pill tone-${a.severity === 'high' ? 'red' : a.severity === 'medium' ? 'orange' : 'gray'}`}>{SEVERITY_LABEL[a.severity] ?? a.severity}</span></td>
                  <td className="nowrap">{STAGE_LABEL[a.stage] ?? a.stage}</td>
                  <td className="q-cell"><Highlight text={a.question} m={a.matched} />{a.question.indexOf(a.matched) < 0 && a.matched && <div className="muted small">命中：<mark>{a.matched}</mark></div>}</td>
                  <td className="nowrap">{a.status === 'ack' ? <span className="muted small">已处理{a.handledAt ? ` ${fmtTime(a.handledAt)}` : ''}</span> : <span className="pill tone-orange">待处理</span>}</td>
                  <td className="nowrap r">
                    {a.qaId && <a className="btn sm ghost" href={`#/ops/logs/${encodeURIComponent(a.qaId)}`}>追溯</a>}
                    {a.status !== 'ack' && <button className="btn sm" onClick={() => ack(a.id)}>确认处理</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
