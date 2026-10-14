import { useEffect, useState } from 'react';
import type { ApiMode } from './api';
import { Landing } from './Landing';
import { UserApp } from './user/UserApp';
import { OpsApp } from './ops/OpsApp';
import { Toaster, splitRoute, useHashRoute } from './ui/kit';

export function App({ mode }: { mode: ApiMode }) {
  const route = useHashRoute();
  const { path } = splitRoute(route);
  const [hideBanner, setHide] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, [path.split('/')[1]]);
  const section = path.startsWith('/ops') ? 'ops' : path.startsWith('/app') ? 'app' : 'home';
  useEffect(() => {
    document.title = section === 'ops' ? '知界 · 运营后台' : section === 'app' ? '知界 · 投教助手' : '知界 · 合规投教助手';
  }, [section]);
  return (
    <div className={`shell shell-${section}`}>
      {mode === 'local' && !hideBanner && (
        <div className="local-banner" role="note">
          <span><b>本地演示模式</b>：接口不可达，使用浏览器内检索与规则引擎，回答为知识原文摘录；后台数据仅保存在当前浏览器。</span>
          <button className="icon-btn" onClick={() => setHide(true)} aria-label="收起提示">×</button>
        </div>
      )}
      {section === 'ops' ? <OpsApp route={route} mode={mode} /> : section === 'app' ? <UserApp mode={mode} /> : <Landing mode={mode} />}
      <Toaster />
    </div>
  );
}
