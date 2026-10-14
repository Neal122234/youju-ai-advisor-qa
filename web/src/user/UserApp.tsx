import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, getFault, getHealth, setFault, type ApiMode } from '../api';
import type { ChatResponse, RiskLevel } from '../apiTypes';
import { QUICK_QUESTIONS, type QuickQuestion } from '../mock';
import { Icon, toast } from '../ui/kit';
import { fmtTime } from '../ui/labels';
import { AnswerCard } from './AnswerCard';
import { SourceSheet } from './SourceSheet';
import { FAQ_GROUPS, followUps } from './suggest';

type Msg =
  | { id: string; ts: number; role: 'user'; text: string }
  | { id: string; ts: number; role: 'assistant'; resp: ChatResponse; question: string; fresh: boolean }
  | { id: string; ts: number; role: 'error'; text: string; retry: string; risk: RiskLevel };

const MAX_LEN = 500;
const RISKS: { v: RiskLevel; name: string }[] = [
  { v: 'C1', name: '保守型' }, { v: 'C2', name: '谨慎型' }, { v: 'C3', name: '稳健型' }, { v: 'C4', name: '积极型' }, { v: 'C5', name: '激进型' },
];
const KIND_TONE: Record<string, string> = { normal: 'green', out: 'red', unknown: 'blue', mixed: 'orange', suit: 'yellow', human: 'blue' };
const KIND_GROUP: { kind: QuickQuestion['kind']; label: string; hint: string }[] = [
  { kind: 'normal', label: '正常作答', hint: '带出处作答' },
  { kind: 'suit', label: '适当性', hint: '等级不匹配时提示' },
  { kind: 'mixed', label: '部分越界', hint: '越界部分拒答，其余作答' },
  { kind: 'out', label: '越界拒答', hint: '合规话术 + 后台告警' },
  { kind: 'unknown', label: '知识未覆盖', hint: '转人工 + 记知识缺口' },
  { kind: 'human', label: '用户要人工', hint: '生成工单' },
];
const STAGES = ['正在查找资料…', '正在组织回答…', '正在核对出处，请稍候…'];

function newSid() { return 's_' + Math.random().toString(36).slice(2, 10); }
function sessionId(reset = false) {
  try {
    let s = reset ? null : sessionStorage.getItem('youju.sid');
    if (!s) { s = newSid(); sessionStorage.setItem('youju.sid', s); }
    return s;
  } catch { return reset ? newSid() : 's_anon'; }
}
const readPref = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writePref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** 移动端软键盘弹出时，用 visualViewport 高度撑满可视区，输入框不被遮挡 */
function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const on = () => root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
    on();
    vv.addEventListener('resize', on);
    return () => { vv.removeEventListener('resize', on); root.style.removeProperty('--app-h'); };
  }, []);
}

export function UserApp({ mode }: { mode: ApiMode }) {
  const [risk, setRisk] = useState<RiskLevel>('C3');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [fault, setFaultState] = useState(getFault());
  const [showTech, setShowTech] = useState(readPref('youju.tech') === '1');
  const [faqTab, setFaqTab] = useState(FAQ_GROUPS[0].key);
  const [sheet, setSheet] = useState<{ msgId: string; n: number | null } | null>(null);
  const [jump, setJump] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const sid = useRef(sessionId());
  useVisualViewportHeight();

  // 深链：#/app?q=问题&risk=C2 自动提问（便于演示与录屏）
  useEffect(() => {
    const qs = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const q = qs.get('q');
    const rk = qs.get('risk') as RiskLevel | null;
    if (q) ask(q, rk && /^C[1-5]$/.test(rk) ? rk : undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 发送中阶段提示
  useEffect(() => {
    if (!busy) { setStage(0); return; }
    const a = window.setTimeout(() => setStage(1), 900);
    const b = window.setTimeout(() => setStage(2), 7000);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [busy]);

  // 新消息：用户提问滚到底；回答到达时把回答顶部放进可视区（长回答不直接跳到末尾）
  useEffect(() => {
    const el = listRef.current;
    if (!el || (!msgs.length && !busy)) { el?.scrollTo({ top: 0 }); return; }
    const last = msgs[msgs.length - 1];
    if (!busy && last?.role === 'assistant') {
      const card = el.querySelector<HTMLElement>(`[data-mid="${last.id}"]`);
      if (card) { el.scrollTo({ top: Math.max(0, card.offsetTop - 56), behavior: 'smooth' }); return; }
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // 打字过程中跟随到底部，但不越过回答顶部；用户主动滚动后停止跟随
  const onTyped = useCallback((id: string) => {
    const el = listRef.current;
    if (!el || !follow.current) return;
    const card = el.querySelector<HTMLElement>(`[data-mid="${id}"]`);
    if (!card) return;
    const target = Math.min(card.offsetTop - 56, el.scrollHeight - el.clientHeight);
    if (target > el.scrollTop) el.scrollTop = target;
  }, []);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    setJump(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
  }

  // 输入框自动增高（最多约 5 行）
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 116)}px`;
  }, [input]);

  async function ask(q: string, riskOverride?: RiskLevel, retryOf?: string) {
    const question = q.trim().slice(0, MAX_LEN);
    if (!question || busy) return;
    const r = riskOverride ?? risk;
    if (riskOverride) setRisk(riskOverride);
    if (!retryOf) setInput('');
    follow.current = true;
    const history = msgs.filter((m) => m.role !== 'error').slice(-4).map((m) => m.role === 'user' ? { role: 'user' as const, content: m.text } : { role: 'assistant' as const, content: (m as Extract<Msg, { role: 'assistant' }>).resp.answer });
    setMsgs((m) => {
      const base = retryOf ? m.filter((x) => x.id !== retryOf) : m;
      return retryOf ? base : [...base, { id: 'u' + Date.now(), ts: Date.now(), role: 'user', text: question }];
    });
    setBusy(true);
    try {
      const resp = await api.chat({ question, userRisk: r, sessionId: sid.current, history });
      setMsgs((m) => [...m.map((x) => x.role === 'assistant' ? { ...x, fresh: false } : x), { id: resp.id || 'a' + Date.now(), ts: Date.now(), role: 'assistant', resp, question, fresh: true }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { id: 'e' + Date.now(), ts: Date.now(), role: 'error', text: e?.message ?? '请求失败', retry: question, risk: r }]);
    } finally { setBusy(false); }
  }

  function newChat() {
    if (busy) return;
    setMsgs([]); setSheet(null); setInput('');
    sid.current = sessionId(true);
    toast('已开始新对话');
    taRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 中文输入法候选确认时的 Enter 不发送
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      ask(input);
    }
  }

  const asked = msgs.filter((m) => m.role === 'user').map((m) => (m as Extract<Msg, { role: 'user' }>).text);
  const lastAssistantId = [...msgs].reverse().find((m) => m.role === 'assistant')?.id;
  const sheetMsg = sheet ? msgs.find((m) => m.id === sheet.msgId) as Extract<Msg, { role: 'assistant' }> | undefined : undefined;
  const len = input.length;
  const health = getHealth();
  const group = FAQ_GROUPS.find((g) => g.key === faqTab) ?? FAQ_GROUPS[0];

  const tips = (
    <aside className={`demo-tips${tipsOpen ? ' open' : ''}`} aria-label="演示控制台">
      <div className="tips-h">
        <div className="tips-title"><Icon name="terminal" size={15} /><b>演示控制台</b></div>
        <button className="icon-btn only-mobile" onClick={() => setTipsOpen(false)} aria-label="关闭"><Icon name="x" /></button>
      </div>
      <p className="tips-note">供评审与演示使用，不属于 App 界面。这里的设置会影响左侧对话。</p>
      <section>
        <h4>风险承受等级</h4>
        <div className="seg" role="radiogroup" aria-label="风险承受等级">
          {RISKS.map((x) => (
            <button key={x.v} role="radio" aria-checked={risk === x.v} className={risk === x.v ? 'on' : ''} onClick={() => setRisk(x.v)} title={x.name}>{x.v}</button>
          ))}
        </div>
        <p className="muted small">{risk} {RISKS.find((x) => x.v === risk)?.name}。真实 App 中来自风险测评结果，用来观察适当性提示。</p>
      </section>
      <section>
        <label className="switch">
          <input type="checkbox" checked={showTech} onChange={(e) => { setShowTech(e.target.checked); writePref('youju.tech', e.target.checked ? '1' : '0'); }} />
          <span className="switch-ui" aria-hidden="true" />
          <span><b>展开技术详情</b><span className="muted small">每条回答默认显示决策类型、置信度拆解与追溯链接</span></span>
        </label>
      </section>
      <section>
        <h4>故障注入</h4>
        {mode === 'remote' ? (
          <>
            <select className="input" value={fault} onChange={(e) => { setFault(e.target.value); setFaultState(e.target.value); }} aria-label="故障注入">
              <option value="">无</option>
              <option value="llm">大模型报错</option>
              <option value="slow-llm">大模型超时</option>
              <option value="embed">向量检索失败</option>
            </select>
            <p className="muted small">模拟大模型或向量服务异常，观察降级作答。</p>
          </>
        ) : <p className="muted small">本地演示模式不调用大模型，故障注入不可用。</p>}
      </section>
      <section>
        <h4>示例问题</h4>
        <div className="kind-groups">
          {KIND_GROUP.map((g) => {
            const qs = QUICK_QUESTIONS.filter((q) => q.kind === g.kind);
            if (!qs.length) return null;
            return (
              <div key={g.kind} className="kind-g">
                <div className="kind-h"><span className={`pill tone-${KIND_TONE[g.kind]}`}>{g.label}</span><span className="muted small">{g.hint}</span></div>
                {qs.map((q) => (
                  <button key={q.question} className="kind-q" onClick={() => { ask(q.question, q.risk); setTipsOpen(false); }} disabled={busy}>
                    {q.question}{q.risk ? <span className="muted">（以 {q.risk} 身份）</span> : null}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </section>
      <section className="tips-foot muted small">
        {mode === 'remote' ? `线上服务，知识库 ${health?.kbRelease ?? '—'}，大模型${health?.ai ? '在线' : '不可用'}` : '本地演示模式：不调用大模型，回答为知识原文摘录。'}
        <br />回答下方「详情 → 完整追溯」可跳到运营后台对应日志。
      </section>
    </aside>
  );

  let prevTs = 0;
  return (
    <div className="user-page">
      <div className="user-top">
        <a className="brand sm" href="#/"><span className="brand-mark" /><span><b>有据</b><small>有据可查的投资问答助手 · 示例证券</small></span></a>
        <div className="user-top-r">
          <button className="btn sm only-mobile" onClick={() => setTipsOpen(true)}><Icon name="terminal" size={13} /> 演示控制台</button>
          <a className="btn sm" href="#/ops">运营后台</a>
        </div>
      </div>
      <div className="user-stage">
        <div className="phone">
          <div className="phone-h">
            <a href="#/" className="icon-btn" aria-label="返回"><Icon name="arrowLeft" /></a>
            <div className="phone-title"><b>有据 · 投资问答</b><small>示例证券</small></div>
            <button className="icon-btn" onClick={newChat} disabled={busy || !msgs.length} aria-label="新对话" title="新对话"><Icon name="compose" size={17} /></button>
            <label className="risk-chip" title="风险承受等级（演示）">
              <select value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel)} aria-label="风险承受等级">
                {RISKS.map((x) => <option key={x.v} value={x.v}>{x.v}</option>)}
              </select>
            </label>
          </div>
          <div className="phone-body">
            <div className="phone-msgs" ref={listRef} onScroll={onScroll} onWheel={() => { follow.current = false; }} onTouchMove={() => { follow.current = false; }} aria-live="polite">
              <div className="msg-sys">
                <p>您好，我是有据。开户、交易规则、产品知识都可以问我，每条回答都标有出处，点角标即可查看原文。</p>
                <p className="muted">涉及风险较高的产品，我会按您的风险等级先作提示；资料里没有的问题会为您转人工客服。回答仅供学习参考，不构成投资建议。</p>
              </div>
              {msgs.length === 0 && (
                <section className="faq" aria-label="常见问题">
                  <div className="faq-h">常见问题</div>
                  <div className="faq-tabs" role="tablist">
                    {FAQ_GROUPS.map((g) => (
                      <button key={g.key} role="tab" aria-selected={faqTab === g.key} className={faqTab === g.key ? 'on' : ''} onClick={() => setFaqTab(g.key)}>
                        <Icon name={g.icon} size={15} /><span>{g.label}</span>
                      </button>
                    ))}
                  </div>
                  <ul className="faq-list" role="tabpanel" aria-label={group.label}>
                    {group.questions.map((q) => (
                      <li key={q}><button onClick={() => ask(q)} disabled={busy}><span>{q}</span><Icon name="arrowRight" size={13} /></button></li>
                    ))}
                  </ul>
                </section>
              )}
              {msgs.map((m) => {
                const divider = m.ts - prevTs > 5 * 60 * 1000;
                prevTs = m.ts;
                const time = divider ? <div className="time-div num" key={m.id + 't'}>{fmtTime(new Date(m.ts).toISOString(), false)}</div> : null;
                if (m.role === 'user') return [time, <div key={m.id} className="bubble-u">{m.text}</div>];
                if (m.role === 'assistant') return [time, (
                  <div key={m.id} data-mid={m.id} className="answer-slot">
                    <AnswerCard
                      resp={m.resp} ts={m.ts} animate={m.fresh} showTech={showTech} busy={busy}
                      followUps={m.id === lastAssistantId ? followUps(m.resp, asked) : []}
                      onAsk={(q) => ask(q)}
                      onSources={(n) => setSheet({ msgId: m.id, n })}
                      onTyped={() => onTyped(m.id)}
                    />
                  </div>
                )];
                return [time, (
                  <div key={m.id} className="msg-err" role="alert">
                    <Icon name="alert" size={15} />
                    <div className="msg-err-t"><b>没有收到回答</b><span>{m.text}</span></div>
                    <button className="btn sm" onClick={() => ask(m.retry, m.risk, m.id)} disabled={busy}><Icon name="refresh" size={13} /> 重试</button>
                  </div>
                )];
              })}
              {busy && (
                <div className="answer pending" role="status">
                  <div className="pending-h"><span className="dots" aria-hidden="true"><i /><i /><i /></span><span key={stage} className="stage-t">{STAGES[stage]}</span></div>
                  <div className="skel" style={{ width: '88%' }} /><div className="skel" style={{ width: '64%' }} />
                </div>
              )}
            </div>
            {jump && (
              <button className="jump" onClick={() => { const el = listRef.current; el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }} aria-label="回到最新消息">
                <Icon name="arrowDown" size={16} />
              </button>
            )}
            {sheet && sheetMsg && (
              <SourceSheet citations={sheetMsg.resp.citations} answer={sheetMsg.resp.answer} active={sheet.n} onClose={() => setSheet(null)} />
            )}
          </div>
          <form className="phone-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <div className={`composer${busy ? ' busy' : ''}`}>
              <textarea
                ref={taRef} className="composer-ta" rows={1} value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_LEN))} onKeyDown={onKeyDown}
                placeholder={busy ? '正在回答，请稍候…' : '输入你的问题'} maxLength={MAX_LEN} aria-label="输入问题" disabled={busy}
                enterKeyHint="send"
              />
              {len > 0 && <span className={`count num${len >= MAX_LEN ? ' over' : len > MAX_LEN - 50 ? ' near' : ''}`} aria-live="polite">{len}/{MAX_LEN}</span>}
              <button className="send" type="submit" disabled={busy || !input.trim()} aria-label="发送"><Icon name="send" /></button>
            </div>
            <div className="composer-hint">Enter 发送，Shift + Enter 换行</div>
          </form>
        </div>
        {tips}
      </div>
      {tipsOpen && <div className="scrim only-mobile" onClick={() => setTipsOpen(false)} />}
    </div>
  );
}
