import { useEffect } from 'preact/hooks';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import { BuildPanel } from './components/BuildPanel';
import { DeployPanel } from './components/DeployPanel';
import { Toasts } from './components/Toasts';
import { EditorPage } from './pages/EditorPage';
import { ListPage } from './pages/ListPage';
import { SettingsPage } from './pages/SettingsPage';
import {
  colorPref,
  connectLiveReload,
  liveConnected,
  meta,
  overview,
  refreshMeta,
  refreshPosts,
  setColorPref,
} from './store';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const ICONS = {
  posts: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  settings: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
};

function NavIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function Sidebar() {
  const [location] = useLocation();
  const latest = overview.value.latest;

  return (
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true" />
        墨台
        <small>Inkery Studio</small>
      </div>

      <nav class="nav">
        <Link class={location === '/' ? 'active' : ''} href="/">
          <NavIcon path={ICONS.posts} />
          文章列表
        </Link>
        <Link class={location === '/settings' ? 'active' : ''} href="/settings">
          <NavIcon path={ICONS.settings} />
          站点设置
        </Link>
      </nav>

      <div class="overview">
        <div>
          总数 <b>{overview.value.total}</b>
        </div>
        <div>
          已发布 <b>{overview.value.published}</b>{' '}
          <span class="sep" aria-hidden="true" />{' '}
          草稿 <b>{overview.value.drafts}</b>{' '}
          <span class="sep" aria-hidden="true" />{' '}
          定时 <b>{overview.value.scheduled}</b>
        </div>
        <div>最近更新</div>
        <div>
          {latest ? (
            <>
              {latest.title}{' '}
              <span class="sep" aria-hidden="true" />{' '}
              {latest.updated ?? latest.date}
            </>
          ) : (
            '—'
          )}
        </div>
      </div>

      <div class="sidebar-foot">
        <label for="mode-select">外观</label>
        <select
          id="mode-select"
          value={colorPref.value}
          onChange={(event) => setColorPref(event.currentTarget.value as 'auto' | 'light' | 'dark')}
        >
          <option value="auto">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
        <div>
          {meta.value ? (
            <>
              v{meta.value.version}{' '}
              <span class="sep" aria-hidden="true" />{' '}
              {meta.value.mode}
            </>
          ) : (
            ''
          )}
        </div>
        <div>
          <i class={`status-dot ${liveConnected.value ? 'on' : ''}`} /> 实时通道
        </div>
      </div>
    </aside>
  );
}

export function App() {
  useEffect(() => {
    void refreshMeta();
    void refreshPosts();
    return connectLiveReload();
  }, []);

  return (
    <Router base={BASE}>
      <div class="shell">
        <Sidebar />
        <main class="main">
          <Switch>
            <Route path="/">{() => <ListPage />}</Route>
            <Route path="/settings">{() => <SettingsPage />}</Route>
            <Route path="/edit/:slug">
              {(params: { slug: string }) => <EditorPage slug={params.slug} />}
            </Route>
            <Route>
              <div class="empty">页面不存在</div>
            </Route>
          </Switch>
        </main>
        <div class="status-dock">
          <BuildPanel />
          <DeployPanel />
        </div>
      </div>
      <Toasts />
    </Router>
  );
}