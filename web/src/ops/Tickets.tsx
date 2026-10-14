import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Ticket, TicketStatus } from '../apiTypes';
import { Empty, ErrorBox, Icon, Loading, toast, useAsync } from '../ui/kit';
import { TICKET_STATUS_LABEL, fmtTime } from '../ui/labels';
import { PageHead } from './OpsApp';

const TONE: Record<string, string> = { pending: 'orange', processing: 'blue', closed: 'gray' };
const FLOW: TicketStatus[] = ['pending', 'processing', 'closed'];

export function TicketsPage({ query }: { query: URLSearchParams }) {
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<string | null>(query.get('id'));
  const { data, error, loading, reload } = useAsync(() => api.tickets(), []);
  const list = (data ?? []).filter((t) => !filter || t.status === filter);
  const t = (data ?? []).find((x) => x.id === sel) ?? null;
  useEffect(() => { if (!sel && list.length && window.innerWidth > 900) setSel(list[0].id); }, [data]); // eslint-disable-line
  return (
    <div className="page">
      <PageHead title="人工工单" desc="转人工的问答生成工单；接单、回复、关闭" actions={<button className="btn sm" onClick={reload}><Icon name="refresh" size={14} /> 刷新</button>} />
      <div className="filters">
        <div className="seg" role="radiogroup" aria-label="状态">
          {[['', '全部'], ...FLOW.map((s) => [s, TICKET_STATUS_LABEL[s]])].map(([v, l]) => (
            <button key={v} role="radio" aria-checked={filter === v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>
              {l} <span className="num muted">{(data ?? []).filter((x) => !v || x.status === v).length}</span>
            </button>
          ))}
        </div>
      </div>
      {error ? <ErrorBox msg={error} onRetry={reload} /> : loading && !data ? <Loading rows={6} /> : !list.length ? (
        <Empty title="没有工单">用户端说「转人工」或问知识库未覆盖的问题会生成工单。</Empty>
      ) : (
        <div className="master-detail">
          <div className="md-list">
            {list.map((x) => (
              <button key={x.id} className={`md-item${sel === x.id ? ' on' : ''}`} onClick={() => setSel(x.id)}>
                <div className="md-item-t">{x.question || x.reason}</div>
                <div className="md-item-m">
                  <span className={`pill tone-${TONE[x.status]}`}>{TICKET_STATUS_LABEL[x.status]}</span>
                  <span className="muted small">{x.reason}</span>
                  <span className="muted small num">{fmtTime(x.createdAt)}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="md-detail">{t ? <TicketDetail key={t.id + t.updatedAt} t={t} onSaved={reload} onClose={() => setSel(null)} /> : <Empty title="选择一个工单" />}</div>
        </div>
      )}
    </div>
  );
}

function TicketDetail({ t, onSaved, onClose }: { t: Ticket; onSaved: () => void; onClose: () => void }) {
  const [reply, setReply] = useState(t.reply ?? '');
  const [busy, setBusy] = useState(false);
  async function save(status: TicketStatus) {
    setBusy(true);
    try { await api.updateTicket(t.id, { status, reply }); toast(`工单已${status === 'closed' ? '关闭' : status === 'processing' ? '接单' : '保存'}`, 'green'); onSaved(); }
    catch (e: any) { toast('保存失败：' + e.message, 'red'); } finally { setBusy(false); }
  }
  const idx = FLOW.indexOf(t.status);
  return (
    <div className="ticket-detail">
      <div className="panel-h"><h3 className="q-title sm">{t.question || '（无问题原文）'}</h3><button className="icon-btn only-narrow" onClick={onClose} aria-label="关闭"><Icon name="x" /></button></div>
      <dl className="dl">
        <dt>工单号</dt><dd className="num">{t.id}</dd>
        <dt>原因</dt><dd>{t.reason}</dd>
        <dt>创建</dt><dd className="num">{fmtTime(t.createdAt)}</dd>
        <dt>更新</dt><dd className="num">{fmtTime(t.updatedAt)}</dd>
        <dt>处理人</dt><dd>{t.assignee ?? '未分配'}</dd>
        {t.qaId && <><dt>原问答</dt><dd><a href={`#/ops/logs/${encodeURIComponent(t.qaId)}`}>查看追溯</a></dd></>}
      </dl>
      <ol className="flowline">
        {FLOW.map((s, i) => <li key={s} className={i < idx ? 'done' : i === idx ? 'cur' : ''}>{TICKET_STATUS_LABEL[s]}</li>)}
      </ol>
      <label className="field">
        <span>回复用户</span>
        <textarea className="input" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="回复内容同样需遵守合规要求：不荐股、不预测、不承诺收益" disabled={t.status === 'closed'} />
      </label>
      <div className="row-end">
        {t.status === 'pending' && <button className="btn" disabled={busy} onClick={() => save('processing')}>接单</button>}
        {t.status !== 'closed' && <button className="btn" disabled={busy} onClick={() => save(t.status)}>保存回复</button>}
        {t.status !== 'closed' && <button className="btn primary" disabled={busy || !reply.trim()} onClick={() => save('closed')}>回复并关闭</button>}
        {t.status === 'closed' && <button className="btn" disabled={busy} onClick={() => save('processing')}>重新打开</button>}
      </div>
    </div>
  );
}
