import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, getHealth, type ApiMode } from '../api';
import { Icon, splitRoute, useSlashFocus } from '../ui/kit';
import { Overview } from './Overview';
import { LogDetailPage, LogsPage } from './Logs';
import { GapsPage } from './Gaps';
import { AlertsPage } from './Alerts';
import { TicketsPage } from './Tickets';
import { KbPage } from './Kb';
import { EvalPage } from './Eval';

const NAV = [
  { key: 'overview', label: '总览', icon: 'chart' },
  { key: 'logs', label: '问答追溯', icon: 'list' },
  { key: 'gaps', label: '知识缺口', icon: 'gap' },
  { key: 'alerts', label: '越界告警', icon: 'shield' },
  { key: 'tickets', label: '人工工单', icon: 'headset' },
  { key: 'kb', label: '知识库', icon: 'book' },
  { key: 'eval', label: '评测', icon: 'flask' },
];

export function OpsApp({ route, mode }: { route: string; mode: ApiMode }) {
  const { path, query } = splitRoute(route);
  const seg = path.split('/').filter(Boolean).slice(1); // 去掉 ops
  const page = seg[0] || 'overview';
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [route]);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [path]);
  const [release, setRelease] = useState(getHealth()?.kbRelease ?? '');
  useEffect(() => { api.health().then((x) => setRelease(x.kbRelease)).catch(() => {}); }, [path]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => { api.dashboard().then((d) => setCounts({ gaps: d.openGaps, alerts: d.openAlerts })).catch(() => {}); }, [page]);
  useSlashFocus();

  let body;
  switch (page) {
    case 'logs': body = seg[1] ? <LogDetailPage id={decodeURIComponent(seg[1])} /> : <LogsPage query={query} />; break;
    case 'gaps': body = <GapsPage query={query} />; break;
    case 'alerts': body = <AlertsPage />; break;
    case 'tickets': body = <TicketsPage query={query} />; break;
    case 'kb': body = <KbPage seg={seg.slice(1)} query={query} />; break;
    case 'eval': body = <EvalPage />; break;
    default: body = <Overview />;
  }

  return (
    <div className="ops">
      <aside className={`ops-nav${navOpen ? ' open' : ''}`}>
        <a className="brand" href="#/"><span className="brand-mark" /><span><b>有据</b><small>运营后台</small></span></a>
        <nav>
          {NAV.map((n) => (
            <a key={n.key} href={`#/ops/${n.key}`} className={page === n.key ? 'on' : ''} aria-current={page === n.key ? 'page' : undefined}>
              <Icon name={n.icon} /> {n.label}
              {counts[n.key] ? <span className="nav-badge num" aria-label={`待处理 ${counts[n.key]}`}>{counts[n.key]}</span> : null}
            </a>
          ))}
        </nav>
        <div className="ops-nav-foot">
          <a href="#/app" className="btn sm block">打开用户端</a>
          <div className="muted small">
            {mode === 'local' ? '本地演示模式' : '线上服务'}，知识库 {release || '—'}
            {mode === 'local' && <><br /><button className="linkish" onClick={async () => { const m = await import('../local/engine'); m.resetLocal(); location.reload(); }}>重置演示数据</button></>}
          </div>
          <div className="muted small">演示后台无登录，生产环境需接入权限控制。</div>
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <main className="ops-main" ref={mainRef}>
        <div className="ops-mobilebar">
          <button className="icon-btn" onClick={() => setNavOpen(true)} aria-label="打开导航"><Icon name="menu" /></button>
          <b>{NAV.find((n) => n.key === page)?.label ?? '运营后台'}</b>
        </div>
        {body}
      </main>
    </div>
  );
}

export function PageHead({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="page-h">
      <div><h1>{title}</h1>{desc && <p className="muted">{desc}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
