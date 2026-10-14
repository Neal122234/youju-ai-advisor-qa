import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DocDetail, Gap, GapVerifyResult } from '../apiTypes';
import { DecisionTag, Empty, ErrorBox, Icon, Loading, go, toast, useAsync } from '../ui/kit';
import { GAP_STATUS_LABEL, GAP_TYPE_LABEL, fmtTime } from '../ui/labels';
import { PageHead } from './OpsApp';

const STATUS_TONE: Record<string, string> = { open: 'orange', drafting: 'yellow', resolved: 'green', ignored: 'gray' };

export function GapsPage({ query }: { query: URLSearchParams }) {
  const [status, setStatus] = useState(query.get('status') ?? '');
  const [type, setType] = useState('');
  const [sel, setSel] = useState<string | null>(query.get('id'));
  const { data, error, loading, reload } = useAsync(() => api.gaps(status || undefined), [status]);
  const list = (data ?? []).filter((g) => !type || g.type === type);
  const gap = list.find((g) => g.id === sel) ?? (data ?? []).find((g) => g.id === sel) ?? null;
  useEffect(() => { if (!sel && list.length && window.innerWidth > 900) setSel(list[0].id); }, [data]); // eslint-disable-line

  return (
    <div className="page">
      <PageHead title="知识缺口" desc="用户问倒的问题在这里归并；补知识、发布、回归验证后关闭" actions={<button className="btn sm" onClick={reload}><Icon name="refresh" size={14} /> 刷新</button>} />
      <div className="filters">
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="状态">
          <option value="">全部状态</option>
          {Object.entries(GAP_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="类型">
          <option value="">全部类型</option>
          {Object.entries(GAP_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error ? <ErrorBox msg={error} onRetry={reload} /> : loading && !data ? <Loading rows={6} /> : !list.length ? (
        <Empty title="没有缺口">用户端问一个知识库没覆盖的问题（如港股通交易时间），会在这里生成缺口。</Empty>
      ) : (
        <div className="master-detail">
          <div className="md-list">
            {list.map((g) => (
              <button key={g.id} className={`md-item${sel === g.id ? ' on' : ''}`} onClick={() => setSel(g.id)}>
                <div className="md-item-t">{g.sampleQuestion}</div>
                <div className="md-item-m">
                  <span className={`pill tone-${STATUS_TONE[g.status]}`}>{GAP_STATUS_LABEL[g.status]}</span>
                  <span className="muted small">{GAP_TYPE_LABEL[g.type] ?? g.type}</span>
                  <span className="num small">{g.count} 次</span>
                  <span className="muted small num">{fmtTime(g.lastSeen)}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="md-detail">
            {gap ? <GapDetail key={gap.id} gap={gap} onChanged={reload} onClose={() => setSel(null)} /> : <Empty title="选择一个缺口查看处理流程" />}
          </div>
        </div>
      )}
    </div>
  );
}

function GapDetail({ gap, onChanged, onClose }: { gap: Gap; onChanged: () => void; onClose: () => void }) {
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<GapVerifyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (gap.docKey) api.doc(gap.docKey).then(setDoc).catch(() => setDoc(null));
  }, [gap.docKey, gap.status]);

  const versions = doc?.versions ?? [];
  const gapVersions = versions.filter((v) => v.gapId === gap.id || v.id === gap.draftVersionId);
  const latestDraft = versions.find((v) => v.status === 'draft' && (v.gapId === gap.id || v.id === gap.draftVersionId)) ?? versions.find((v) => v.status === 'draft');
  const published = gapVersions.find((v) => v.status === 'published' || (v.status === 'archived' && v.publishedAt));
  const ignored = gap.status === 'ignored';
  const resolved = gap.status === 'resolved';
  // 步骤：0 发现 → 1 起草 → 2 发布 → 3 回归验证
  const stage = resolved ? 4 : published ? 3 : gap.status === 'drafting' || latestDraft ? 2 : 1;

  async function draft() {
    setBusy(true); setErr(null);
    try {
      const r = await api.gapAction(gap.id, 'draft');
      toast('已生成草稿，进入编辑器补充答案', 'green');
      onChanged();
      const q = new URLSearchParams({ gap: gap.id });
      if (r?.docVersionId) q.set('version', r.docVersionId);
      if (r?.docKey) q.set('doc', r.docKey);
      go(`/ops/kb/edit?${q}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function ignore() {
    setBusy(true);
    try { await api.gapAction(gap.id, 'ignore'); toast('已忽略'); onChanged(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function runVerify() {
    setBusy(true); setErr(null);
    try {
      const r = await api.gapVerify(gap.id);
      setVerify(r);
      toast(r.resolved ? `回归通过，缺口已在 ${r.release} 解决` : '回归未通过：仍有问题转人工', r.resolved ? 'green' : 'orange');
      onChanged();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const steps = [
    { t: '发现缺口', d: `${GAP_TYPE_LABEL[gap.type] ?? gap.type}，累计 ${gap.count} 次` },
    { t: '起草知识', d: published ? `已起草 ${published.docKey}` : latestDraft ? `草稿 ${latestDraft.docKey} v${latestDraft.version}` : gap.docKey ? `文档 ${gap.docKey}` : '预填用户问题生成草稿' },
    { t: '发布新版本', d: published ? `已随 v${published.version} 发布` : '切分后进入新的知识版本' },
    { t: '回归验证', d: resolved ? `已在 ${gap.resolvedRelease ?? '—'} 解决` : '用当前版本重跑全部同类问题' },
  ];

  return (
    <div className="gap-detail">
      <div className="panel-h">
        <h3 className="q-title sm">{gap.sampleQuestion}</h3>
        <button className="icon-btn only-narrow" onClick={onClose} aria-label="关闭"><Icon name="x" /></button>
      </div>
      <div className="muted small">首次 {fmtTime(gap.firstSeen)}，最近 {fmtTime(gap.lastSeen)}，归并 {gap.questions.length} 种问法</div>

      <ol className={`stepper${ignored ? ' dim' : ''}`}>
        {steps.map((s, i) => (
          <li key={s.t} className={i < stage ? 'done' : i === stage ? 'cur' : ''}>
            <span className="st-n num">{i < stage ? <Icon name="check" size={12} /> : i + 1}</span>
            <div><b>{s.t}</b><span>{s.d}</span></div>
          </li>
        ))}
      </ol>

      {err && <ErrorBox msg={err} />}
      <div className="gap-actions">
        {ignored ? <span className="muted">该缺口已忽略</span> : resolved ? (
          <span className="pill tone-green">已解决（{gap.resolvedRelease}）</span>
        ) : stage === 1 ? (
          <>
            <button className="btn primary" disabled={busy} onClick={draft}>起草知识</button>
            <button className="btn" disabled={busy} onClick={ignore}>忽略</button>
          </>
        ) : stage === 2 ? (
          <>
            <a className="btn primary" href={`#/ops/kb/edit?${new URLSearchParams({ gap: gap.id, ...(latestDraft ? { version: latestDraft.id, doc: latestDraft.docKey } : gap.docKey ? { doc: gap.docKey } : {}) })}`}>继续编辑并发布</a>
            <button className="btn" disabled={busy} onClick={runVerify}>直接回归验证</button>
          </>
        ) : (
          <button className="btn primary" disabled={busy} onClick={runVerify}>{busy ? '验证中…' : '回归验证'}</button>
        )}
      </div>

      {verify && (
        <div className={`verify ${verify.resolved ? 'ok' : 'bad'}`}>
          <b>{verify.resolved ? `通过：全部问法可作答，缺口在 ${verify.release} 关闭` : `未通过（${verify.release}）：以下问法仍转人工，继续补充知识`}</b>
          <ul>
            {verify.results.map((r, i) => (
              <li key={i}><DecisionTag d={r.decision} compact /><span>{r.question}</span><span className="num muted small">{r.confidence.toFixed(2)}</span></li>
            ))}
          </ul>
        </div>
      )}

      <h4>归并的问法</h4>
      <ul className="qlist">{gap.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
    </div>
  );
}
