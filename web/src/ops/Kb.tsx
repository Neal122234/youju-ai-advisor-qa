import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { DocDetail, DocVersion, KbDoc, PreviewChunk, ProductRisk } from '../apiTypes';
import { Empty, ErrorBox, Icon, Loading, Modal, go, toast, useAsync } from '../ui/kit';
import { DOC_CATEGORY_LABEL, VERSION_STATUS_LABEL, fmtTime } from '../ui/labels';
import { lineDiff } from './diff';
import { PageHead } from './OpsApp';

const V_TONE: Record<string, string> = { draft: 'yellow', published: 'green', archived: 'gray' };

export function KbPage({ seg, query }: { seg: string[]; query: URLSearchParams }) {
  if (seg[0] === 'doc' && seg[1]) return <DocPage docKey={decodeURIComponent(seg[1])} />;
  if (seg[0] === 'edit' || seg[0] === 'new') return <Editor query={query} />;
  return <KbHome tab={seg[0] === 'releases' ? 'releases' : 'docs'} />;
}

function KbTabs({ tab }: { tab: string }) {
  return (
    <div className="tabs" role="tablist">
      <a role="tab" aria-selected={tab === 'docs'} className={tab === 'docs' ? 'on' : ''} href="#/ops/kb">文档</a>
      <a role="tab" aria-selected={tab === 'releases'} className={tab === 'releases' ? 'on' : ''} href="#/ops/kb/releases">发布记录</a>
    </div>
  );
}

function KbHome({ tab }: { tab: 'docs' | 'releases' }) {
  const [pub, setPub] = useState(false);
  const docs = useAsync(() => api.docs(), []);
  const rels = useAsync(() => api.releases(), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const list = (docs.data ?? []).filter((d) => (!cat || d.category === cat) && (!q || d.title.includes(q) || d.docKey.includes(q) || d.tags.some((t) => t.includes(q))));
  const current = rels.data?.[0]?.releaseNo;
  return (
    <div className="page">
      <PageHead
        title="知识库"
        desc={`当前发布版本 ${current ?? '—'}；编辑产生草稿，发布后切分入库并生成新版本`}
        actions={<><a className="btn sm" href="#/ops/kb/new">新建文档</a><button className="btn sm primary" onClick={() => setPub(true)}>发布草稿</button></>}
      />
      <KbTabs tab={tab} />
      {tab === 'docs' ? (
        <>
          <div className="filters">
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="类别">
              <option value="">全部类别</option>
              {Object.entries(DOC_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题、doc_key 或标签" aria-label="搜索文档" />
          </div>
          {docs.error ? <ErrorBox msg={docs.error} onRetry={docs.reload} /> : docs.loading && !docs.data ? <Loading rows={8} /> : !list.length ? <Empty title="没有文档" /> : (
            <div className="tbl-wrap">
              <table className="tbl clickable">
                <thead><tr><th>标题</th><th>类别</th><th>当前版本</th><th className="r">块数</th><th>产品风险</th><th>标签</th><th>最近修改</th></tr></thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d.docKey} tabIndex={0} onClick={() => go(`/ops/kb/doc/${encodeURIComponent(d.docKey)}`)} onKeyDown={(e) => e.key === 'Enter' && go(`/ops/kb/doc/${encodeURIComponent(d.docKey)}`)}>
                      <td><div>{d.title}</div><div className="muted small num">{d.docKey}</div></td>
                      <td className="nowrap">{DOC_CATEGORY_LABEL[d.category] ?? d.category}</td>
                      <td className="nowrap">{d.currentVersion !== null ? <span className="num">v{d.currentVersion}</span> : <span className="muted">未发布</span>}{d.draftCount > 0 && <span className="pill tone-yellow">草稿 {d.draftCount}</span>}</td>
                      <td className="num r">{d.chunks}</td>
                      <td>{d.productRisk ? <span className="pill tone-orange">{d.productRisk}</span> : <span className="muted">—</span>}</td>
                      <td className="tags">{d.tags.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}</td>
                      <td className="nowrap muted num">{fmtTime(d.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        rels.error ? <ErrorBox msg={rels.error} onRetry={rels.reload} /> : rels.loading && !rels.data ? <Loading rows={5} /> : (
          <ol className="releases">
            {(rels.data ?? []).map((r, i) => (
              <li key={r.id} className={i === 0 ? 'cur' : ''}>
                <div className="rel-h"><b className="num">{r.releaseNo}</b>{i === 0 && <span className="pill tone-green">当前</span>}<span className="muted small num">{fmtTime(r.createdAt)}</span><span className="muted small">{r.createdBy}</span></div>
                <div>{r.note || <span className="muted">无发布说明</span>}</div>
                {r.docVersions.length > 0 && <details><summary className="muted small">包含 {r.docVersions.length} 个文档版本</summary><div className="tags">{r.docVersions.map((v) => <span key={v} className="tag num">{v}</span>)}</div></details>}
              </li>
            ))}
            {!rels.data?.length && <Empty title="暂无发布记录" />}
          </ol>
        )
      )}
      {pub && <PublishModal onClose={() => setPub(false)} onDone={() => { setPub(false); docs.reload(); rels.reload(); }} />}
    </div>
  );
}

/* ---------------- 发布 ---------------- */
export function PublishModal({ onClose, onDone, preselect, gapId }: { onClose: () => void; onDone: (releaseNo: string) => void; preselect?: string[]; gapId?: string | null }) {
  const [drafts, setDrafts] = useState<(DocVersion & { title: string })[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set(preselect ?? []));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const docs = await api.docs();
      const details = await Promise.all(docs.map((d) => api.doc(d.docKey).catch(() => null)));
      const out: (DocVersion & { title: string })[] = [];
      details.forEach((d) => d?.versions.filter((v) => v.status === 'draft').forEach((v) => out.push({ ...v, title: d.doc.title })));
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setDrafts(out);
      if (!preselect?.length && out.length === 1) setSel(new Set([out[0].id]));
    })().catch((e) => setErr(e.message));
  }, []); // eslint-disable-line
  async function submit() {
    setBusy(true); setErr(null);
    try {
      const r = await api.publish([...sel], note || '运营发布');
      toast(`已发布 ${r.releaseNo}`, 'green');
      onDone(r.releaseNo);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="发布草稿" onClose={onClose}>
      {err && <ErrorBox msg={err} />}
      {!drafts ? <Loading rows={3} /> : !drafts.length ? <Empty title="没有待发布的草稿">先在文档里编辑并保存草稿。</Empty> : (
        <>
          <p className="muted small">选中的草稿会被切分、写入知识块，并生成一个新的知识版本；同文档的旧版本自动归档。</p>
          <ul className="checklist">
            {drafts.map((v) => (
              <li key={v.id}>
                <label>
                  <input type="checkbox" checked={sel.has(v.id)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(v.id) : s.delete(v.id); setSel(s); }} />
                  <span><b>{v.title}</b> <span className="num">v{v.version}</span>{v.gapId && v.gapId === gapId && <span className="pill tone-yellow">本缺口</span>}<br /><span className="muted small">{v.changeNote || '无修改说明'}，{fmtTime(v.createdAt)}</span></span>
                </label>
              </li>
            ))}
          </ul>
          <label className="field"><span>发布说明</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：补充港股通交易时间" /></label>
        </>
      )}
      <div className="row-end">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy || !sel.size} onClick={submit}>{busy ? '发布中…' : `发布 ${sel.size} 个版本`}</button>
      </div>
    </Modal>
  );
}

/* ---------------- 文档详情 ---------------- */
function DocPage({ docKey }: { docKey: string }) {
  const { data, error, loading, reload } = useAsync(() => api.doc(docKey), [docKey]);
  const [view, setView] = useState<string | null>(null);
  const [diffA, setDiffA] = useState<string>('');
  const [diffB, setDiffB] = useState<string>('');
  const [mode, setMode] = useState<'content' | 'diff'>('content');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.versions.length) {
      const vs = data.versions;
      setView((v) => v ?? (vs.find((x) => x.status === 'published') ?? vs[0]).id);
      setDiffB((b) => b || vs[0].id);
      setDiffA((a) => a || (vs[1] ?? vs[0]).id);
    }
  }, [data]);
  const back = <a className="back" href="#/ops/kb"><Icon name="arrowLeft" size={14} /> 知识库</a>;
  if (error) return <div className="page">{back}<ErrorBox msg={error} onRetry={reload} /></div>;
  if (loading && !data) return <div className="page">{back}<Loading rows={8} /></div>;
  if (!data) return null;
  const { doc, versions } = data;
  const cur = versions.find((v) => v.id === view) ?? versions[0];
  const A = versions.find((v) => v.id === diffA), B = versions.find((v) => v.id === diffB);

  async function rollback(v: DocVersion) {
    if (!confirm(`以 v${v.version} 的内容重新发布 ${doc.title}？会生成一个新的知识版本。`)) return;
    setBusy(true);
    try { const r = await api.rollback(doc.docKey, v.version); toast(`已回滚，新版本 ${r.releaseNo}`, 'green'); reload(); }
    catch (e: any) { toast('回滚失败：' + e.message, 'red'); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      {back}
      <PageHead
        title={doc.title}
        desc={`${doc.docKey}，${DOC_CATEGORY_LABEL[doc.category] ?? doc.category}${doc.productRisk ? `，产品风险 ${doc.productRisk}` : ''}，当前 ${doc.currentVersion !== null ? 'v' + doc.currentVersion : '未发布'}，${doc.chunks} 个知识块`}
        actions={<a className="btn sm primary" href={`#/ops/kb/edit?doc=${encodeURIComponent(doc.docKey)}`}>编辑</a>}
      />
      <div className="doc-grid">
        <section className="panel">
          <h3>版本历史</h3>
          <ol className="versions">
            {versions.map((v) => (
              <li key={v.id} className={v.id === cur?.id ? 'on' : ''}>
                <button type="button" onClick={() => { setView(v.id); setMode('content'); }}>
                  <span className="num"><b>v{v.version}</b></span>
                  <span className={`pill tone-${V_TONE[v.status]}`}>{VERSION_STATUS_LABEL[v.status]}</span>
                  <span className="v-note">{v.changeNote || '无说明'}</span>
                  <span className="muted small num">{v.author}，{fmtTime(v.publishedAt ?? v.createdAt)}</span>
                </button>
                {v.status === 'archived' && <button className="btn sm ghost" disabled={busy} onClick={() => rollback(v)}>回滚到此版</button>}
              </li>
            ))}
          </ol>
        </section>
        <section className="panel grow">
          <div className="panel-h">
            <div className="seg sm" role="tablist">
              <button className={mode === 'content' ? 'on' : ''} onClick={() => setMode('content')}>内容</button>
              <button className={mode === 'diff' ? 'on' : ''} onClick={() => setMode('diff')} disabled={versions.length < 2}>对比</button>
            </div>
            {mode === 'diff' ? (
              <div className="diff-pick">
                <select className="input sm" value={diffA} onChange={(e) => setDiffA(e.target.value)} aria-label="旧版本">{versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}</select>
                <Icon name="arrowRight" size={14} />
                <select className="input sm" value={diffB} onChange={(e) => setDiffB(e.target.value)} aria-label="新版本">{versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}</select>
              </div>
            ) : cur && <span className="muted small">v{cur.version} {VERSION_STATUS_LABEL[cur.status]}</span>}
          </div>
          {mode === 'content' ? <pre className="md-src">{cur?.content}</pre> : A && B ? <DiffView a={A.content} b={B.content} /> : null}
        </section>
      </div>
    </div>
  );
}

function DiffView({ a, b }: { a: string; b: string }) {
  const lines = useMemo(() => lineDiff(a, b), [a, b]);
  const add = lines.filter((l) => l.type === 'add').length, del = lines.filter((l) => l.type === 'del').length;
  return (
    <div className="diff">
      <div className="muted small"><span className="d-add-t">+{add}</span> <span className="d-del-t">−{del}</span> 行</div>
      <div className="diff-body">
        {lines.map((l, i) => (
          <div key={i} className={`dl-${l.type}`}><span className="ln num">{l.a ?? ''}</span><span className="ln num">{l.b ?? ''}</span><span className="sg">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span><span className="tx">{l.text || ' '}</span></div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 编辑器 ---------------- */
const RISKS: ProductRisk[] = ['R1', 'R2', 'R3', 'R4', 'R5'];

function Editor({ query }: { query: URLSearchParams }) {
  const docKeyQ = query.get('doc');
  const versionQ = query.get('version');
  const gapId = query.get('gap');
  const isNew = !docKeyQ;
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [form, setForm] = useState({ docKey: '', title: '', category: 'investor_edu', productRisk: '' as '' | ProductRisk, tags: '', content: '## 小标题\n正文……', changeNote: '' });
  const [chunks, setChunks] = useState<PreviewChunk[] | null>(null);
  const [pvErr, setPvErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<DocVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [pub, setPub] = useState(false);
  const [published, setPublished] = useState<string | null>(null);
  const [gapQs, setGapQs] = useState<string[]>([]);
  useEffect(() => {
    if (gapId) api.gaps().then((gs) => setGapQs(gs.find((g) => g.id === gapId)?.questions ?? [])).catch(() => {});
  }, [gapId]);

  useEffect(() => {
    if (!docKeyQ) {
      if (gapId) setForm((f) => ({ ...f, changeNote: '补充知识缺口' }));
      return;
    }
    api.doc(docKeyQ).then((d) => {
      setDetail(d);
      const v = d.versions.find((x) => x.id === versionQ) ?? d.versions.find((x) => x.status === 'draft') ?? d.versions.find((x) => x.status === 'published') ?? d.versions[0];
      setForm({
        docKey: d.doc.docKey, title: d.doc.title, category: d.doc.category, productRisk: d.doc.productRisk ?? '', tags: d.doc.tags.join('，'),
        content: v?.content ?? '', changeNote: v?.status === 'draft' ? v.changeNote : gapId ? '补充知识缺口' : '',
      });
    }).catch((e) => toast('载入文档失败：' + e.message, 'red')).finally(() => setLoading(false));
  }, [docKeyQ, versionQ, gapId]);

  useEffect(() => {
    if (!form.content.trim()) { setChunks([]); return; }
    const t = setTimeout(() => {
      api.previewChunks(form.content).then((c) => { setChunks(c); setPvErr(null); }).catch((e) => setPvErr(e.message));
    }, 450);
    return () => clearTimeout(t);
  }, [form.content]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(null); };

  async function save() {
    if (!form.title.trim()) { toast('请填写标题', 'red'); return; }
    if (isNew && form.docKey && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.docKey)) { toast('doc_key 需为小写字母、数字和连字符', 'red'); return; }
    setBusy(true);
    try {
      const v = await api.saveDoc({
        docKey: form.docKey || undefined, title: form.title.trim(), category: form.category, productRisk: form.productRisk || null,
        tags: form.tags.split(/[,，\s]+/).filter(Boolean), content: form.content, changeNote: form.changeNote || '编辑', gapId,
      });
      setSaved(v);
      if (!form.docKey) setForm((f) => ({ ...f, docKey: v.docKey }));
      toast(`已保存草稿 v${v.version}`, 'green');
    } catch (e: any) { toast('保存失败：' + e.message, 'red'); } finally { setBusy(false); }
  }

  const back = <a className="back" href={docKeyQ ? `#/ops/kb/doc/${encodeURIComponent(docKeyQ)}` : gapId ? '#/ops/gaps' : '#/ops/kb'}><Icon name="arrowLeft" size={14} /> {docKeyQ ? '文档详情' : gapId ? '知识缺口' : '知识库'}</a>;
  if (loading) return <div className="page">{back}<Loading rows={8} /></div>;
  const flowStep = published ? 3 : saved ? 2 : 1;

  return (
    <div className="page editor-page">
      {back}
      <PageHead title={isNew ? '新建文档' : `编辑：${detail?.doc.title ?? form.title}`} desc={gapId ? '由知识缺口发起：保存草稿 → 发布 → 回到缺口做回归验证' : '保存后产生草稿版本，发布后才会被检索到'} />
      {gapId && (
        <ol className="stepper inline">
          {['起草知识', '发布新版本', '回归验证'].map((t, i) => (
            <li key={t} className={i + 1 < flowStep ? 'done' : i + 1 === flowStep ? 'cur' : ''}><span className="st-n num">{i + 1 < flowStep ? <Icon name="check" size={12} /> : i + 1}</span><div><b>{t}</b></div></li>
          ))}
        </ol>
      )}
      <div className="editor">
        <div className="ed-form">
          {gapQs.length > 0 && (
            <div className="notice tone-blue"><b>该缺口收集到的用户问法（答案需覆盖）</b><span>{gapQs.join('；')}</span></div>
          )}
          <div className="form-grid">
            <label className="field"><span>标题</span><input className="input" value={form.title} onChange={set('title')} /></label>
            <label className="field"><span>doc_key</span><input className="input num" value={form.docKey} onChange={set('docKey')} disabled={!isNew} placeholder="留空自动生成" /></label>
            <label className="field"><span>类别</span>
              <select className="input" value={form.category} onChange={set('category')}>{Object.entries(DOC_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="field"><span>产品风险</span>
              <select className="input" value={form.productRisk} onChange={set('productRisk')}><option value="">不涉及</option>{RISKS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            </label>
            <label className="field span2"><span>标签</span><input className="input" value={form.tags} onChange={set('tags')} placeholder="逗号分隔" /></label>
          </div>
          <label className="field grow"><span>正文（Markdown，按 ## 小标题切分）</span>
            <textarea className="input mono ed-text" value={form.content} onChange={set('content')} spellCheck={false} />
          </label>
          <label className="field"><span>修改说明</span><input className="input" value={form.changeNote} onChange={set('changeNote')} placeholder="例如：补充港股通交易时间" /></label>
          <div className="row-end">
            {saved && <span className="muted small">已保存草稿 v{saved.version}</span>}
            <button className="btn" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存草稿'}</button>
            <button className="btn primary" disabled={!saved || !!published} onClick={() => setPub(true)}>发布</button>
          </div>
          {published && (
            <div className="verify ok">
              <b>已发布 {published}</b>
              {gapId ? <div><a className="btn sm primary" href={`#/ops/gaps?id=${encodeURIComponent(gapId)}`}>回到缺口做回归验证</a></div> : <div><a href={`#/ops/kb/doc/${encodeURIComponent(form.docKey)}`}>查看文档版本</a></div>}
            </div>
          )}
        </div>
        <aside className="ed-preview">
          <div className="panel-h"><h3>切分预览</h3><span className="muted small num">{chunks?.length ?? 0} 块</span></div>
          {pvErr && <ErrorBox msg={pvErr} />}
          {!chunks ? <Loading rows={3} /> : !chunks.length ? <p className="muted">正文为空</p> : (
            <ol className="chunks">
              {chunks.map((c) => (
                <li key={c.ord}>
                  <div className="chunk-h"><span className="num muted">#{c.ord}</span><b>{c.heading || '（无小标题）'}</b><span className={`muted small num${c.text.length > 400 ? ' warn-t' : ''}`}>{c.text.length} 字</span></div>
                  <p>{c.text}</p>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
      {pub && saved && <PublishModal preselect={[saved.id]} gapId={gapId} onClose={() => setPub(false)} onDone={(r) => { setPub(false); setPublished(r); }} />}
    </div>
  );
}
