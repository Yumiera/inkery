import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  api,
  type ConfigPayload,
  type DeploySettings,
  type SiteSettings,
  type VerifyFile,
} from '../api';
import { errorToast, meta, refreshMeta, toast } from '../store';

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function parseKeywords(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

const TIMEZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
})();

interface FieldProps {
  label: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
  list?: string;
  disabled?: boolean;
  wide?: boolean;
}

function Field(props: FieldProps) {
  return (
    <label class={`form-row${props.wide ? ' wide' : ''}`}>
      <span>{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        list={props.list}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      {props.hint ? <small class="muted">{props.hint}</small> : null}
    </label>
  );
}

export function SettingsPage() {
  const [payload, setPayload] = useState<ConfigPayload | null>(null);
  const [site, setSite] = useState<SiteSettings | null>(null);
  const [deploy, setDeploy] = useState<DeploySettings | null>(null);
  const [keywords, setKeywords] = useState('');
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<VerifyFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const apply = (data: ConfigPayload): void => {
    setPayload(data);
    setSite({ ...data.site });
    setDeploy({ ...data.deploy });
    setKeywords(data.site.keywords.join(', '));
    setBaseline(JSON.stringify({ site: data.site, deploy: data.deploy }));
  };

  useEffect(() => {
    void api
      .getConfig()
      .then(apply)
      .catch(errorToast)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void api
      .listVerifyFiles()
      .then((result) => setFiles(result.items))
      .catch(errorToast);
  }, []);

  const draft = useMemo(() => {
    if (site === null || deploy === null) return null;
    return { site: { ...site, keywords: parseKeywords(keywords) }, deploy };
  }, [site, deploy, keywords]);

  const dirty = draft !== null && baseline !== '' && JSON.stringify(draft) !== baseline;

  const patchSite = (key: Exclude<keyof SiteSettings, 'verify'>, value: string): void =>
    setSite((current) => (current === null ? current : { ...current, [key]: value }));
  const patchVerify = (key: keyof SiteSettings['verify'], value: string): void =>
    setSite((current) =>
      current === null ? current : { ...current, verify: { ...current.verify, [key]: value } },
    );
  const patchDeploy = <K extends keyof DeploySettings>(key: K, value: DeploySettings[K]): void =>
    setDeploy((current) => (current === null ? current : { ...current, [key]: value }));

  const save = async (): Promise<void> => {
    if (draft === null) return;
    setSaving(true);
    try {
      const result = await api.saveConfig(draft);
      apply(result);
      toast('配置已保存，正在重新构建', 'success');
      void refreshMeta();
    } catch (error) {
      errorToast(error);
    } finally {
      setSaving(false);
    }
  };

  const uploadVerifyFile = async (file: File): Promise<void> => {
    setUploading(true);
    try {
      const result = await api.uploadVerifyFile(file);
      setFiles(result.items);
      toast(`已上传 ${file.name}`, 'success');
    } catch (error) {
      errorToast(error);
    } finally {
      setUploading(false);
    }
  };

  const removeVerifyFile = async (name: string): Promise<void> => {
    try {
      const result = await api.deleteVerifyFile(name);
      setFiles(result.items);
      toast(`已删除 ${name}`, 'success');
    } catch (error) {
      errorToast(error);
    }
  };

  const reset = (): void => {
    if (payload === null) return;
    apply(payload);
  };

  if (loading) return <div class="empty">加载中…</div>;
  if (site === null || deploy === null || payload === null) return <div class="empty">配置不可用</div>;

  const preview = payload.preview;

  return (
    <div class="settings">
      <div class="page-head">
        <h1>站点设置</h1>
        <span class="spacer" />
        <span class="muted mono">{payload.configFile}</span>
        <button class="btn btn-sm" disabled={!dirty || saving} onClick={reset}>
          放弃修改
        </button>
        <button class="btn btn-sm btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存并重建'}
        </button>
      </div>

      {dirty ? <div class="banner">有未保存的改动，保存后会自动重新加载配置并重建站点。</div> : null}

      <section class="card">
        <div class="card-head">
          <h2>站点基础</h2>
          <span class="muted">站点地址决定 feed / sitemap / og:url 中的绝对链接</span>
        </div>
        <div class="form-grid">
          <Field label="站点标题" value={site.title} onInput={(v) => patchSite('title', v)} />
          <Field label="副标题" value={site.subtitle} onInput={(v) => patchSite('subtitle', v)} />
          <Field
            label="站点地址"
            value={site.url}
            placeholder="https://example.com"
            hint="部署后填写真实域名，留空会退回相对链接"
            onInput={(v) => patchSite('url', v)}
          />
          <Field
            label="子路径"
            value={site.baseUrl}
            placeholder="/"
            hint="仓库站点形如 /repo/；用户站点或自定义域名填 /"
            onInput={(v) => patchSite('baseUrl', v)}
          />
          <Field label="作者" value={site.author} onInput={(v) => patchSite('author', v)} />
          <Field label="邮箱" value={site.email} onInput={(v) => patchSite('email', v)} />
          <Field label="语言" value={site.lang} placeholder="zh-CN" onInput={(v) => patchSite('lang', v)} />
          <Field
            label="时区"
            value={site.timezone}
            list="tz-list"
            placeholder="Asia/Shanghai"
            onInput={(v) => patchSite('timezone', v)}
          />
          <datalist id="tz-list">
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          <Field
            label="关键词"
            value={keywords}
            placeholder="博客, 随笔"
            hint="逗号分隔"
            onInput={setKeywords}
            wide
          />
          <label class="form-row wide">
            <span>站点描述</span>
            <textarea
              rows={2}
              value={site.description}
              onInput={(event) => patchSite('description', event.currentTarget.value)}
            />
          </label>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>站点验证</h2>
          <span class="muted">填入各平台验证码，构建时输出对应的 meta 标签，无需上传文件</span>
        </div>
        <div class="form-grid">
          <Field
            label="Google"
            value={site.verify.google}
            placeholder="google-site-verification"
            onInput={(value) => patchVerify('google', value)}
          />
          <Field
            label="Bing"
            value={site.verify.bing}
            placeholder="msvalidate.01"
            onInput={(value) => patchVerify('bing', value)}
          />
          <Field
            label="百度"
            value={site.verify.baidu}
            placeholder="baidu-site-verification"
            onInput={(value) => patchVerify('baidu', value)}
          />
          <Field
            label="Yandex"
            value={site.verify.yandex}
            placeholder="yandex-verification"
            onInput={(value) => patchVerify('yandex', value)}
          />
        </div>

        <div class="verify-files">
          <div class="verify-files-head">
            <span class="muted">验证文件（发布到站点根目录）</span>
            <span class="spacer" />
            <button
              class="btn btn-sm"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? '上传中…' : '上传文件'}
            </button>
            <input
              ref={fileInput}
              class="verify-input"
              type="file"
              accept=".html,.htm,.xml,.txt"
              onChange={(event) => {
                const picked = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (picked) void uploadVerifyFile(picked);
              }}
            />
          </div>
          {files.length === 0 ? (
            <p class="muted">
              暂无文件。可上传 .html / .xml / .txt，例如 BingSiteAuth.xml 或 google 开头的验证页。
            </p>
          ) : (
            <ul class="verify-list">
              {files.map((item) => (
                <li key={item.name}>
                  <a
                    class="mono"
                    href={`${meta.value?.siteUrl ?? ''}/${item.name}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    /{item.name}
                  </a>
                  <span class="muted">{formatSize(item.size)}</span>
                  <span class="spacer" />
                  <button
                    class="btn btn-ghost btn-sm btn-danger"
                    onClick={() => void removeVerifyFile(item.name)}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>部署目标</h2>
          <span class="muted">推送 dist/ 产物到 Git 仓库的指定分支</span>
        </div>
        <div class="form-grid">
          <label class="form-row check wide">
            <input
              type="checkbox"
              checked={deploy.enabled}
              onChange={(event) => patchDeploy('enabled', event.currentTarget.checked)}
            />
            <span>启用部署（关闭后墨台的部署按钮不可用）</span>
          </label>
          <Field
            label="仓库"
            value={deploy.repo}
            placeholder="owner/repo 或完整 Git 地址"
            hint="owner/repo 简写会补全为 https://github.com/owner/repo.git"
            onInput={(v) => patchDeploy('repo', v)}
            wide
          />
          <Field
            label="分支"
            value={deploy.branch}
            placeholder="main"
            hint="需与仓库默认分支一致"
            onInput={(v) => patchDeploy('branch', v)}
          />
          <Field
            label="自定义域名"
            value={deploy.cname}
            placeholder="blog.example.com"
            hint="填写后会写入 CNAME 文件"
            onInput={(v) => patchDeploy('cname', v)}
          />
          <Field label="提交信息" value={deploy.message} hint="支持 {{date}} 占位符" onInput={(v) => patchDeploy('message', v)} />
          <label class="form-row check">
            <input
              type="checkbox"
              checked={deploy.forcePush}
              onChange={(event) => patchDeploy('forcePush', event.currentTarget.checked)}
            />
            <span>强制推送（覆盖远端历史）</span>
          </label>
        </div>

        <div class="deploy-preview">
          {preview.deployable ? (
            <>
              <span class="badge badge-published">可部署</span>
              <span class="muted">
                推送目标 {deploy.repo || '—'}@{deploy.branch}
              </span>
              {preview.pagesUrl ? (
                <a class="mono" href={preview.pagesUrl} target="_blank" rel="noreferrer">
                  {preview.pagesUrl}
                </a>
              ) : null}
            </>
          ) : (
            <>
              <span class="badge badge-draft">未配置</span>
              <span class="muted">{preview.reason}</span>
            </>
          )}
        </div>

        {preview.warnings.length > 0 ? (
          <ul class="warn-list">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}