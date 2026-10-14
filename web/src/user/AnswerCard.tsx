import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ChatResponse } from '../apiTypes';
import { AnswerText, ConfidenceBar, DecisionTag, Icon, toast } from '../ui/kit';
import { MODE_LABEL, fmtTime } from '../ui/labels';

const BAD_REASONS = ['答非所问', '信息有误或过时', '没解决我的问题', '其他'];

const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 打字机式渐显：按字推进，总时长随长度压缩在约 0.8–2.4 s；不截断引用角标 */
function useTypewriter(text: string, enabled: boolean) {
  const [n, setN] = useState(enabled && !reduceMotion() ? 0 : text.length);
  useEffect(() => {
    if (n >= text.length) return;
    const step = Math.max(2, Math.ceil(text.length / 70));
    const t = window.setTimeout(() => setN((x) => Math.min(text.length, x + step)), 28);
    return () => window.clearTimeout(t);
  }, [n, text]);
  const done = n >= text.length;
  const shown = done ? text : text.slice(0, n).replace(/\[\d*$/, '');
  return { shown, done, skip: () => setN(text.length) };
}

/** 用户看到的友好状态；决策枚举与置信度收进「查看详情」 */
function statusOf(resp: ChatResponse): { tone: string; icon: string; text: string } | null {
  const n = resp.citations?.length ?? 0;
  switch (resp.decision) {
    case 'answered': return n ? { tone: 'green', icon: 'checkCircle', text: `已核实来源 · 引用 ${n} 处` } : null;
    case 'answered_caveat': return { tone: 'yellow', icon: 'info', text: n ? `建议核实 · 引用 ${n} 处` : '建议核实' };
    case 'partial_refusal': return { tone: 'orange', icon: 'info', text: '部分问题不在服务范围' };
    case 'refused': return { tone: 'gray', icon: 'shield', text: '超出服务范围' };
    case 'handoff_unknown': case 'handoff_low_conf': case 'handoff_request': return { tone: 'blue', icon: 'headset', text: '已转人工' };
    case 'degraded': return { tone: 'gray', icon: 'doc', text: '知识库原文摘录' };
    default: return null;
  }
}

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

export function AnswerCard({ resp, ts, animate, followUps, onAsk, onSources, showTech, onTyped, busy, feedback = null, onFeedback }: {
  resp: ChatResponse; ts: number; animate: boolean; followUps: string[]; showTech: boolean; busy: boolean;
  onAsk: (q: string) => void; onSources: (n: number | null) => void; onTyped?: () => void;
  /** 已提交的反馈（随对话持久化）；提交后锁定，不可改 */
  feedback?: 'up' | 'down' | null; onFeedback?: (v: 'up' | 'down') => void;
}) {
  const [fb, setFb] = useState<null | 'up' | 'down'>(feedback);
  useEffect(() => { if (feedback) setFb(feedback); }, [feedback]);
  const [sending, setSending] = useState(false);
  const [badOpen, setBadOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [tech, setTech] = useState(showTech);
  useEffect(() => setTech(showTech), [showTech]);

  const isHandoff = resp.decision.startsWith('handoff');
  const showConf = resp.decision !== 'refused' && resp.decision !== 'handoff_request';
  const cites = resp.citations ?? [];
  // 管线会把适当性提示附在答案末尾；用户端改用提示框展示，正文里去掉重复的那段
  const notice = resp.suitability?.notice ?? '';
  const body = notice && resp.answer.includes(notice)
    ? resp.answer.replace(notice, '').replace(/[\s]*【?适当性提示】?[:：]?\s*$/, '').trimEnd()
    : resp.answer;
  const tw = useTypewriter(body, animate);
  const typedOnce = useRef(false);
  useEffect(() => {
    if (!tw.done) onTyped?.();
    else if (!typedOnce.current) { typedOnce.current = true; onTyped?.(); }
  }, [tw.shown, tw.done]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = statusOf(resp);

  async function sendFb(helpful: boolean) {
    if (fb || sending) return;
    setSending(true);
    try {
      await api.feedback(resp.id, helpful, helpful ? undefined : [reason, note].filter(Boolean).join('：'));
      const v = helpful ? 'up' : 'down';
      setFb(v); setBadOpen(false); onFeedback?.(v);
      toast(helpful ? '感谢反馈' : '已记录，运营会据此补充知识', 'green');
    } catch (e: any) { toast('反馈提交失败：' + (e?.message ?? ''), 'red'); } finally { setSending(false); }
  }
  async function copy() {
    const plain = body.replace(/\[\d+\]/g, '') + (notice ? `\n\n适当性提示：${notice}` : '');
    const ok = await copyText(plain);
    toast(ok ? '已复制回答' : '复制失败，请长按选择文字', ok ? 'green' : 'red');
  }

  return (
    <article className={`answer d-${resp.decision}${tw.done ? '' : ' typing-on'}`} aria-busy={!tw.done}>
      {st && (
        <header className={`answer-st tone-${st.tone}`}>
          <Icon name={st.icon} size={14} /><span>{st.text}</span>
          {resp.mode === 'local' && cites.length > 0 && !isHandoff && <span className="answer-st-x">本地演示 · 原文摘录</span>}
        </header>
      )}

      <AnswerText text={tw.shown} citations={cites} onCite={(n) => onSources(n)} />
      {!tw.done && (
        <button type="button" className="tw-skip" onClick={tw.skip}>显示全部</button>
      )}

      {tw.done && (
        <div className="answer-rest">
          {resp.suitability && (
            <div className={`notice ${resp.suitability.matched ? 'tone-green' : 'tone-orange'}`}>
              <b>适当性提示</b>
              <span>{resp.suitability.notice}</span>
            </div>
          )}

          {isHandoff && resp.handoff && (
            <div className="handoff">
              <div className="handoff-h"><Icon name="headset" /> <b>已为您转接人工客服</b></div>
              <div className="kv"><span>工单号</span><code>{resp.handoff.ticketId ?? '生成中'}</code></div>
              <div className="kv"><span>原因</span><span>{resp.handoff.reason}</span></div>
              <p className="muted small">人工客服将在服务时间内回复，结果通过 App 消息通知您。</p>
            </div>
          )}

          {resp.disclaimer && <p className="disclaimer">{resp.disclaimer}</p>}

          <footer className="answer-f">
            <div className="acts">
              <button type="button" className="act" onClick={copy} aria-label="复制回答" title="复制"><Icon name="copy" size={15} /></button>
              <button type="button" className={`act${fb === 'up' ? ' on' : ''}`} disabled={!!fb || sending} onClick={() => sendFb(true)} aria-label="有帮助" aria-pressed={fb === 'up'} title="有帮助"><Icon name="thumbUp" size={15} /></button>
              <button type="button" className={`act${fb === 'down' ? ' on bad' : ''}`} disabled={!!fb || sending} onClick={() => setBadOpen((o) => !o)} aria-label="没帮助" aria-pressed={fb === 'down'} aria-expanded={badOpen} title="没帮助"><Icon name="thumbDown" size={15} /></button>
              {cites.length > 0 && (
                <button type="button" className="act src-btn" onClick={() => onSources(null)}><Icon name="doc" size={14} /> 出处 {cites.length}</button>
              )}
            </div>
            <div className="acts-r">
              <time className="msg-time num" dateTime={new Date(ts).toISOString()}>{fmtTime(new Date(ts).toISOString(), false)}</time>
              <button type="button" className={`more-btn${tech ? ' on' : ''}`} onClick={() => setTech((t) => !t)} aria-expanded={tech}>
                详情<Icon name={tech ? 'chevronUp' : 'chevronDown'} size={12} />
              </button>
            </div>
          </footer>

          {badOpen && (
            <div className="badfb">
              <div className="badfb-t">哪里不满意？</div>
              <div className="chips">
                {BAD_REASONS.map((r) => <button type="button" key={r} className={reason === r ? 'on' : ''} aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}
              </div>
              <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充说明（选填）" maxLength={200} />
              <div className="row-end"><button type="button" className="btn sm" onClick={() => setBadOpen(false)}>取消</button><button type="button" className="btn sm primary" onClick={() => sendFb(false)} disabled={(!reason && !note) || sending}>提交反馈</button></div>
            </div>
          )}

          {tech && (
            <div className="tech" aria-label="技术详情">
              <div className="tech-h"><span>演示 / 运营视角</span><a className="trace" href={`#/ops/logs/${encodeURIComponent(resp.id)}`}>完整追溯 <Icon name="external" size={12} /></a></div>
              <div className="tech-row"><DecisionTag d={resp.decision} compact /><span className="muted small">{MODE_LABEL[resp.mode] ?? resp.mode} · {resp.latencyMs} ms · 知识 {resp.kbRelease}</span></div>
              {showConf && <ConfidenceBar value={resp.confidence} breakdown={resp.confidenceBreakdown} showDetail />}
            </div>
          )}

          {followUps.length > 0 && (
            <div className="followups" aria-label="推荐追问">
              <span className="fu-t">你可能还想问</span>
              {followUps.map((q) => (
                <button key={q} type="button" className="fu" disabled={busy} onClick={() => onAsk(q)}>
                  <span>{q}</span><Icon name="arrowRight" size={12} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
