import { buildState, changedUrls, liveConnected, meta, startBuild } from '../store';

export function BuildPanel() {
  const state = buildState.value;
  const running = state?.status === 'running';
  const percent =
    state === null
      ? 0
      : state.status === 'done'
        ? 100
        : state.total > 0
          ? Math.min(100, Math.round((state.current / state.total) * 100))
          : 0;

  const siteBase = meta.value?.siteUrl ?? '';

  return (
    <div class="build-bar">
      <button class="btn btn-sm btn-primary" disabled={running} onClick={() => void startBuild()}>
        {running ? '构建中…' : '构建'}
      </button>
      <div class="progress">
        <i style={{ width: `${percent}%` }} />
      </div>
      <span>
        {state === null
          ? '尚未构建'
          : `${state.status === 'error' ? '失败：' : ''}${state.message}${
              running ? ` · ${state.phase} ${state.current}/${state.total}` : ''
            }`}
      </span>
      {state?.status === 'error' && state.errors.length > 0 ? (
        <span class="muted" title={state.errors.join('\n')}>
          {state.errors[0]}
        </span>
      ) : null}
      <span class="spacer" />
      <div class="changed-urls">
        {changedUrls.value.slice(0, 10).map((url) => (
          <a key={url} href={`${siteBase}${url}`} target="_blank" rel="noreferrer">
            {url}
          </a>
        ))}
      </div>
      <span class="muted" title="SSE 实时通道">
        <i class={`status-dot ${liveConnected.value ? 'on' : ''}`} /> SSE
      </span>
    </div>
  );
}