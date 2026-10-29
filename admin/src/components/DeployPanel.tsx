import { useState } from 'preact/hooks';
import { buildState, deployState, meta, startDeploy } from '../store';

const PHASE_LABEL: Record<string, string> = {
  precheck: '检查',
  build: '构建',
  stage: '暂存',
  commit: '提交',
  push: '推送',
  indexnow: '索引',
  done: '完成',
};

function shortRepo(repo: string): string {
  return repo.replace(/^https?:\/\//, '').replace(/^git@([^:]+):/, '$1/').replace(/\.git$/, '');
}

export function DeployPanel() {
  const [open, setOpen] = useState(false);
  const target = meta.value?.deploy ?? null;
  const state = deployState.value;
  const build = buildState.value;

  const running = state?.status === 'running';
  const determinate = running && state.phase === 'build' && build !== null && build.total > 0;
  const percent =
    state === null
      ? 0
      : state.status === 'done'
        ? 100
        : determinate
          ? Math.min(100, Math.round((build.current / build.total) * 100))
          : 100;

  const barClass = running
    ? determinate
      ? ''
      : 'busy'
    : state?.status === 'done'
      ? 'done'
      : state?.status === 'error'
        ? 'error'
        : '';

  const status = (() => {
    if (state === null) return target?.configured === true ? '尚未部署' : '未配置部署目标';
    if (running) return state.message;
    return state.status === 'error' ? `失败：${state.errors[0] ?? state.message}` : state.message;
  })();

  const showLog = state !== null && (open || state.status === 'error');

  return (
    <>
      <div class="build-bar deploy-bar">
        <button
          class="btn btn-sm btn-primary"
          disabled={running || target?.configured !== true}
          title={target?.configured === true ? `部署到 ${target.repo} (${target.branch})` : (target?.reason ?? '')}
          onClick={() => void startDeploy()}
        >
          {running ? '部署中…' : '部署'}
        </button>
        <div class={`progress ${barClass}`}>
          <i style={barClass === 'busy' ? undefined : { width: `${percent}%` }} />
        </div>
        {running ? <span class="badge badge-tag">{PHASE_LABEL[state.phase] ?? state.phase}</span> : null}
        <span role="status" aria-live="polite">
          {status}
        </span>
        {state !== null && state.log.length > 0 ? (
          <button
            class="btn btn-sm btn-ghost"
            aria-expanded={showLog}
            onClick={() => setOpen((value) => !value)}
          >
            {showLog ? '收起日志' : '日志'}
          </button>
        ) : null}
        <span class="spacer" />
        {target !== null && target.warnings.length > 0 ? (
          <span class="muted" title={target.warnings.join('\n')}>
            {target.warnings.length} 条部署警告
          </span>
        ) : null}
        {target !== null && target.configured ? (
          <span class="muted mono" title={target.repo}>
            {shortRepo(target.repo)}@{target.branch}
            {target.cname !== '' ? (
              <>
                {' '}
                <span class="sep" aria-hidden="true" />{' '}
                {target.cname}
              </>
            ) : null}
          </span>
        ) : null}
        {target?.pagesUrl ? (
          <a class="mono" href={target.pagesUrl} target="_blank" rel="noreferrer">
            {target.pagesUrl.replace(/^https?:\/\//, '')}
          </a>
        ) : null}
      </div>
      {showLog ? (
        <div class="deploy-log" role="log">
          {state.log.map((line, index) => (
            <div key={`${index}-${line}`}>{line}</div>
          ))}
        </div>
      ) : null}
    </>
  );
}