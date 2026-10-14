import { useEffect, useRef, useState } from 'react';
import { api, getFault, getHealth, setFault, type ApiMode } from '../api';
import type { ChatResponse, RiskLevel } from '../apiTypes';
import { QUICK_QUESTIONS } from '../mock';
import { Icon } from '../ui/kit';
import { AnswerCard } from './AnswerCard';

type Msg = { id: string; role: 'user'; text: string } | { id: string; role: 'assistant'; resp: ChatResponse } | { id: string; role: 'error'; text: string; retry: string };

const RISKS: { v: RiskLevel; name: string }[] = [
  { v: 'C1', name: '保守型' }, { v: 'C2', name: '谨慎型' }, { v: 'C3', name: '稳健型' }, { v: 'C4', name: '积极型' }, { v: 'C5', name: '激进型' },
];
const KIND_TONE: Record<string, string> = { normal: 'green', out: 'red', unknown: 'blue', mixed: 'orange', suit: 'yellow', human: 'blue' };

function sessionId() {
  try {
    let s = sessionStorage.getItem('youju.sid');
    if (!s) { s = 's_' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('youju.sid', s); }
    return s;
  } catch { return 's_anon'; }
}

export function UserApp({ mode }: { mode: ApiMode }) {
  const [risk, setRisk] = useState<RiskLevel>('C3');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [fault, setFaultState] = useState(getFault());
  const listRef = useRef<HTMLDivElement>(null);
  const sid = useRef(sessionId());

  // 深链：#/app?q=问题&risk=C2 自动提问（便于演示与录屏）
  useEffect(() => {
    const qs = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const q = qs.get('q');
    const rk = qs.get('risk') as RiskLevel | null;
    if (q) ask(q, rk && /^C[1-5]$/.test(rk) ? rk : undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const last = msgs[msgs.length - 1];
    if (!busy && last?.role === 'assistant') {
      // 新回答：把回答顶部滚到可视区（长回答不直接跳到末尾）
      const cards = el.querySelectorAll('.answer');
      const card = cards[cards.length - 1] as HTMLElement | undefined;
      if (card) { el.scrollTo({ top: Math.max(0, card.offsetTop - 56), behavior: 'smooth' }); return; }
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  async function ask(q: string, riskOverride?: RiskLevel) {
    const question = q.trim();
    if (!question || busy) return;
    const r = riskOverride ?? risk;
    if (riskOverride) setRisk(riskOverride);
    setInput('');
    const history = msgs.filter((m) => m.role !== 'error').slice(-4).map((m) => m.role === 'user' ? { role: 'user' as const, content: m.text } : { role: 'assistant' as const, content: (m as any).resp.answer as string });
    setMsgs((m) => [...m, { id: 'u' + Date.now(), role: 'user', text: question }]);
    setBusy(true);
    try {
      const resp = await api.chat({ question, userRisk: r, sessionId: sid.current, history });
      setMsgs((m) => [...m, { id: resp.id || 'a' + Date.now(), role: 'assistant', resp }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { id: 'e' + Date.now(), role: 'error', text: e?.message ?? '请求失败', retry: question }]);
    } finally { setBusy(false); }
  }

  const health = getHealth();
  const tips = (
    <aside className={`demo-tips${tipsOpen ? ' open' : ''}`} aria-label="演示提示">
      <div className="tips-h"><b>演示提示</b><button className="icon-btn only-mobile" onClick={() => setTipsOpen(false)} aria-label="关闭"><Icon name="x" /></button></div>
      <section>
        <h4>风险承受等级</h4>
        <p className="muted">真实 App 中来自风险测评结果，这里可手动切换，用来观察适当性提示。</p>
        <div className="seg" role="radiogroup" aria-label="风险承受等级">
          {RISKS.map((x) => (
            <button key={x.v} role="radio" aria-checked={risk === x.v} className={risk === x.v ? 'on' : ''} onClick={() => setRisk(x.v)} title={x.name}>{x.v}</button>
          ))}
        </div>
        <p className="muted small">{risk} {RISKS.find((x) => x.v === risk)?.name}</p>
      </section>
      <section>
        <h4>试试这些问题</h4>
        <ul className="quick-list">
          {QUICK_QUESTIONS.map((q) => (
            <li key={q.question}>
              <button onClick={() => { ask(q.question, q.risk); setTipsOpen(false); }} disabled={busy}>
                <span className={`pill tone-${KIND_TONE[q.kind]}`}>{q.label}</span>
                <span>{q.question}{q.risk ? `（以 ${q.risk} 身份）` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {mode === 'remote' && (
        <section>
          <h4>故障注入</h4>
          <p className="muted">模拟大模型或向量服务异常，观察降级作答。</p>
          <select className="input" value={fault} onChange={(e) => { setFault(e.target.value); setFaultState(e.target.value); }}>
            <option value="">无</option>
            <option value="llm">大模型报错</option>
            <option value="slow-llm">大模型超时</option>
            <option value="embed">向量检索失败</option>
          </select>
        </section>
      )}
      <section className="muted small">
        {mode === 'remote' ? `知识库 ${health?.kbRelease ?? '—'}，大模型${health?.ai ? '在线' : '不可用'}` : '本地演示模式：不调用大模型，回答为知识原文摘录。'}
        <br />每条回答下方「查看完整追溯」可跳到运营后台对应日志。
      </section>
    </aside>
  );

  return (
    <div className="user-page">
      <div className="user-top">
        <a className="brand sm" href="#/"><span className="brand-mark" /><span><b>有据</b><small>有据可查的投资问答助手 · 示例证券</small></span></a>
        <div className="user-top-r">
          <button className="btn sm only-mobile" onClick={() => setTipsOpen(true)}>演示提示</button>
          <a className="btn sm" href="#/ops">运营后台</a>
        </div>
      </div>
      <div className="user-stage">
        <div className="phone">
          <div className="phone-h">
            <a href="#/" className="icon-btn" aria-label="返回"><Icon name="arrowLeft" /></a>
            <div className="phone-title"><b>有据 · 投资问答</b><small>示例证券</small></div>
            <label className="risk-chip" title="风险承受等级（演示）">
              <select value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel)} aria-label="风险承受等级">
                {RISKS.map((x) => <option key={x.v} value={x.v}>{x.v}</option>)}
              </select>
            </label>
          </div>
          <div className="phone-msgs" ref={listRef}>
            <div className="msg-sys">
              <p>您好，我是有据。开户、交易规则、产品知识都可以问我，每条回答都标有出处，点角标即可查看原文。</p>
              <p className="muted">涉及风险较高的产品，我会按您的风险等级先作提示；资料里没有的问题会为您转人工客服。回答仅供学习参考，不构成投资建议。</p>
            </div>
            {msgs.length === 0 && (
              <div className="quick-chips">
                {QUICK_QUESTIONS.slice(0, 6).map((q) => <button key={q.question} onClick={() => ask(q.question, q.risk)}>{q.question}</button>)}
              </div>
            )}
            {msgs.map((m) =>
              m.role === 'user' ? <div key={m.id} className="bubble-u">{m.text}</div>
              : m.role === 'assistant' ? <AnswerCard key={m.id} resp={m.resp} />
              : <div key={m.id} className="msg-err"><Icon name="info" /> <span>回答失败：{m.text}</span><button className="btn sm" onClick={() => ask(m.retry)}>重试</button></div>,
            )}
            {busy && (
              <div className="answer typing" aria-live="polite">
                <div className="dots"><i /><i /><i /></div>
                <span className="muted small">正在检索知识库并校验合规…</span>
                <div className="skel" style={{ width: '88%' }} /><div className="skel" style={{ width: '64%' }} />
              </div>
            )}
          </div>
          <form className="phone-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="输入你的问题" maxLength={600} aria-label="输入问题" />
            <button className="send" type="submit" disabled={busy || !input.trim()} aria-label="发送"><Icon name="send" /></button>
          </form>
        </div>
        {tips}
      </div>
      {tipsOpen && <div className="scrim only-mobile" onClick={() => setTipsOpen(false)} />}
    </div>
  );
}
