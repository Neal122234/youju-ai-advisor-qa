import { useState } from 'react';
import { api } from '../api';
import type { EvalRun } from '../apiTypes';
import { DecisionTag, Empty, ErrorBox, Icon, Pager, useTable } from '../ui/kit';
import { CATEGORY_LABEL, DECISION_LABEL, EVAL_TYPE_LABEL, pct } from '../ui/labels';
import { PageHead } from './OpsApp';

export function EvalPage() {
  const [run, setRun] = useState<EvalRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [onlyFail, setOnlyFail] = useState(false);
  const [type, setType] = useState('');
  const [t0, setT0] = useState(0);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);

  async function start(ids?: string[]) {
    setBusy(true); setErr(null); setT0(Date.now()); setProg(null);
    try {
      const r = await api.runEval(ids, (done, total, partial) => { setProg({ done, total }); if (!ids) setRun(partial); });
      if (ids && run) {
        const m = new Map(r.results.map((x) => [x.id, x]));
        const results = run.results.map((x) => m.get(x.id) ?? x);
        const passed = results.filter((x) => x.pass).length;
        const bt = new Map<string, { type: string; total: number; passed: number }>();
        results.forEach((x) => { const e = bt.get(x.type) ?? { type: x.type, total: 0, passed: 0 }; e.total++; if (x.pass) e.passed++; bt.set(x.type, e); });
        setRun({ ...run, results, passed, passRate: passed / results.length, byType: [...bt.values()], kbRelease: r.kbRelease });
      } else setRun(r);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); setProg(null); }
  }

  const rows = (run?.results ?? []).filter((r) => (!onlyFail || !r.pass) && (!type || r.type === type));
  const fails = run?.results.filter((r) => !r.pass) ?? [];
  const t = useTable(rows, { id: (r) => r.id, type: (r) => r.type, pass: (r) => (r.pass ? 1 : 0) }, { defaultSort: '', pageSize: 30 });
  return (
    <div className="page">
      <PageHead
        title="评测"
        desc="用固定评测集回归：正常、混合、越界、未知、注入、适当性、人工七类问题"
        actions={<>
          {fails.length > 0 && <button className="btn sm" disabled={busy} onClick={() => start(fails.map((f) => f.id))}>重跑失败项 {fails.length}</button>}
          <button className="btn sm primary" disabled={busy} onClick={() => start()}>{busy ? '评测中…' : run ? '重新运行' : '运行评测集'}</button>
        </>}
      />
      {err && <ErrorBox msg={err} onRetry={() => start()} />}
      {busy && <div className="progress"><span /><span className="muted small">正在分批运行（每批 8 题）{prog ? `：已完成 ${prog.done}/${prog.total}` : '…'}，线上模式约 2–4 分钟（开始于 {new Date(t0).toLocaleTimeString()}）</span></div>}
      {!run && !busy && !err && <Empty art="doc" title="还没有评测结果">点击「运行评测集」，逐题对比期望决策、必须引用、禁用词与告警类别。</Empty>}
      {run && (
        <>
          <div className="eval-sum">
            <div className="kpi big">
              <span className="kpi-k">通过率</span>
              <span className="kpi-v num">{pct(run.passRate, 1)}</span>
              <span className="kpi-sub num">{run.passed} / {run.total}，知识版本 {run.kbRelease || '—'}</span>
            </div>
            <div className="bytype">
              {run.byType.map((b) => (
                <button key={b.type} className={`bt${type === b.type ? ' on' : ''}`} onClick={() => { setType((x) => (x === b.type ? '' : b.type)); t.resetPage(); }}>
                  <span>{EVAL_TYPE_LABEL[b.type] ?? b.type}</span>
                  <span className="bt-track"><i className={b.passed === b.total ? 'tone-green' : 'tone-orange'} style={{ width: pct(b.total ? b.passed / b.total : 0) }} /></span>
                  <span className="num small">{b.passed}/{b.total}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="filters">
            <label className="check"><input type="checkbox" checked={onlyFail} onChange={(e) => { setOnlyFail(e.target.checked); t.resetPage(); }} /> 只看失败（{fails.length}）</label>
            {type && <button className="btn sm ghost" onClick={() => setType('')}>清除类型筛选：{EVAL_TYPE_LABEL[type] ?? type} <Icon name="x" size={12} /></button>}
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>{t.th('id', 'ID')}{t.th('type', '类型')}<th>问题</th><th>期望</th><th>实际</th>{t.th('pass', '结果')}</tr></thead>
              <tbody>
                {t.view.map((r) => (
                  <tr key={r.id} className={r.pass ? '' : 'row-fail'}>
                    <td className="num nowrap">{r.id}</td>
                    <td className="nowrap">{EVAL_TYPE_LABEL[r.type] ?? r.type}</td>
                    <td className="q-cell">{r.question}<div className="muted small">用户等级 {r.userRisk}</div></td>
                    <td className="small">
                      {r.expect.decisionIn?.length ? <div>{r.expect.decisionIn.map((d) => DECISION_LABEL[d] ?? d).join(' / ')}</div> : null}
                      {r.expect.mustCiteDocKeys?.length ? <div className="muted num">引用 {r.expect.mustCiteDocKeys.join(', ')}</div> : null}
                      {r.expect.alert ? <div className="muted">告警 {CATEGORY_LABEL[r.expect.alert] ?? r.expect.alert}</div> : null}
                      {r.expect.mustNotContain?.length ? <div className="muted">不含 {r.expect.mustNotContain.join('、')}</div> : null}
                    </td>
                    <td className="small">
                      {r.actual.decision && <DecisionTag d={r.actual.decision} compact />}
                      {r.actual.citedDocKeys.length > 0 && <div className="muted num">{r.actual.citedDocKeys.join(', ')}</div>}
                      {r.actual.alerts.length > 0 && <div className="muted">{r.actual.alerts.map((a) => CATEGORY_LABEL[a] ?? a).join('、')}</div>}
                    </td>
                    <td className="nowrap">
                      {r.pass ? <span className="pill tone-green">通过</span> : <span className="pill tone-red">未通过</span>}
                      {!r.pass && r.reasons.length > 0 && <div className="fail-reasons small">{r.reasons.map((x, i) => <div key={i}>{x}</div>)}</div>}
                      {r.qaId && <div><a className="small" href={`#/ops/logs/${encodeURIComponent(r.qaId)}`}>查看日志</a></div>}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="muted">没有符合条件的题目</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={t.page} pages={t.pages} total={t.total} size={t.size} onPage={t.setPage} />
        </>
      )}
    </div>
  );
}
