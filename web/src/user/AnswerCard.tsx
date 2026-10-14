import { useState } from 'react';
import { api } from '../api';
import type { ChatResponse } from '../apiTypes';
import { AnswerText, ConfidenceBar, DecisionTag, Icon, toast } from '../ui/kit';

const BAD_REASONS = ['答非所问', '信息有误或过时', '没解决我的问题', '其他'];

export function AnswerCard({ resp }: { resp: ChatResponse }) {
  const [openCite, setOpenCite] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [fb, setFb] = useState<null | 'up' | 'down'>(null);
  const [badOpen, setBadOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const isHandoff = resp.decision.startsWith('handoff');
  const showConf = resp.decision !== 'refused' && resp.decision !== 'handoff_request';
  const cites = resp.citations ?? [];
  // 管线会把适当性提示附在答案末尾；用户端改用提示框展示，正文里去掉重复的那段
  const notice = resp.suitability?.notice ?? '';
  const shown = notice && resp.answer.includes(notice)
    ? resp.answer.replace(notice, '').replace(/[\s]*【?适当性提示】?[:：]?\s*$/, '').trimEnd()
    : resp.answer;

  async function sendFb(helpful: boolean) {
    try {
      await api.feedback(resp.id, helpful, helpful ? undefined : [reason, note].filter(Boolean).join('：'));
      setFb(helpful ? 'up' : 'down'); setBadOpen(false);
      toast(helpful ? '感谢反馈' : '已记录，运营会据此补充知识', 'green');
    } catch (e: any) { toast('反馈提交失败：' + (e?.message ?? ''), 'red'); }
  }

  return (
    <article className={`answer d-${resp.decision}`}>
      <header className="answer-h">
        <DecisionTag d={resp.decision} />
        {resp.mode !== 'llm' && <span className="pill tone-gray">{resp.mode === 'local' ? '原文摘录' : '降级作答'}</span>}
      </header>

      <AnswerText text={shown} active={openCite} onCite={(n) => { setOpenCite((c) => (c === n ? null : n)); setShowAll(true); }} />

      {resp.suitability && (
        <div className={`notice ${resp.suitability.matched ? 'tone-green' : 'tone-orange'}`}>
          <b>适当性提示</b>
          <span>{resp.suitability.notice}</span>
        </div>
      )}

      {isHandoff && resp.handoff && (
        <div className="handoff">
          <div className="handoff-h"><Icon name="headset" /> <b>已转人工客服</b></div>
          <div className="kv"><span>工单号</span><code>{resp.handoff.ticketId ?? '生成中'}</code></div>
          <div className="kv"><span>原因</span><span>{resp.handoff.reason}</span></div>
          <p className="muted small">人工客服将在 30 分钟内回复（交易日 9:00–17:00），结果通过 App 消息通知您。</p>
        </div>
      )}

      {cites.length > 0 && (
        <div className="sources">
          <button type="button" className="sources-t" onClick={() => setShowAll((s) => !s)} aria-expanded={showAll}>
            <Icon name="doc" size={14} /> 来源 {cites.length} 条 <Icon name={showAll ? 'arrowLeft' : 'arrowRight'} size={12} className={showAll ? 'rot-90' : ''} />
          </button>
          {showAll && (
            <ol className="source-list">
              {cites.map((c) => (
                <li key={c.n} className={openCite === c.n ? 'on' : ''}>
                  <button type="button" className="src-head" onClick={() => setOpenCite((o) => (o === c.n ? null : c.n))}>
                    <span className="cite static">{c.n}</span>
                    <span className="src-title">{c.docTitle}</span>
                    <span className="muted small">v{c.version}</span>
                  </button>
                  <div className="src-meta muted small">§ {c.heading}</div>
                  {openCite === c.n && <blockquote>{c.snippet}</blockquote>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {showConf && <ConfidenceBar value={resp.confidence} breakdown={resp.confidenceBreakdown} />}

      {resp.disclaimer && <p className="disclaimer">{resp.disclaimer}</p>}

      <footer className="answer-f">
        <div className="fb">
          <button type="button" className={`icon-btn${fb === 'up' ? ' on' : ''}`} disabled={!!fb} onClick={() => sendFb(true)} aria-label="有帮助"><Icon name="thumbUp" /></button>
          <button type="button" className={`icon-btn${fb === 'down' ? ' on bad' : ''}`} disabled={!!fb} onClick={() => setBadOpen((o) => !o)} aria-label="没帮助"><Icon name="thumbDown" /></button>
        </div>
        <a className="trace" href={`#/ops/logs/${encodeURIComponent(resp.id)}`}>查看完整追溯 <Icon name="external" size={12} /></a>
      </footer>
      {badOpen && (
        <div className="badfb">
          <div className="chips">
            {BAD_REASONS.map((r) => <button type="button" key={r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>{r}</button>)}
          </div>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充说明（选填）" maxLength={200} />
          <div className="row-end"><button type="button" className="btn sm" onClick={() => setBadOpen(false)}>取消</button><button type="button" className="btn sm primary" onClick={() => sendFb(false)} disabled={!reason && !note}>提交</button></div>
        </div>
      )}
    </article>
  );
}
