import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initApi } from './api';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="boot"><span className="brand-mark" />正在连接服务…</div>);
initApi().then((info) => root.render(<App mode={info.mode} />));
