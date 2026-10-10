import type { Config } from './schema';

export const CONFIG_FILENAME = 'blog.config.json';

/** 默认强调色：暖墨棕。对纸白 #fefdfa 为 5.67:1、作为底色承白字为 5.77:1，均达 WCAG AA */
export const DEFAULT_ACCENT = '#8c5a3c';

export const defaultConfig: Config = {
  site: {
    title: 'My Blog',
    subtitle: '',
    description: '',
    keywords: [],
    author: '',
    email: '',
    lang: 'zh-CN',
    timezone: 'Asia/Shanghai',
    url: 'http://localhost:4321',
    baseUrl: '/',
    logo: '',
    favicon: '',
    defaultCover: '',
    footerHtml: '',
  },
  navigation: [
    { text: '首页', link: '/' },
    { text: '归档', link: '/archives/' },
    { text: '标签', link: '/tags/' },
    { text: '分类', link: '/categories/' },
  ],
  social: [],
  permalinkPattern: '/posts/:slug/',
  theme: {
    name: 'default',
    config: {
      accentColor: DEFAULT_ACCENT,
      colorMode: 'auto',
      postsPerPage: 10,
      tocDepth: 3,
      showReadingTime: true,
      showSearch: true,
      codeTheme: { light: 'github-light', dark: 'github-dark' },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4321,
    open: true,
  },
  build: {
    outDir: 'dist',
    drafts: false,
    cache: true,
    concurrency: 8,
    minify: true,
    shiki: {
      extraLangs: [],
    },
  },
  deploy: {
    type: 'git',
    enabled: false,
    repo: '',
    branch: 'master',
    forcePush: true,
    message: 'chore: publish {{date}}',
    cname: '',
  },
};

/** 主题配置的读取入口：带类型收窄与默认值回退 */
export function themeOption<T>(config: Config, key: string, fallback: T): T {
  const raw = config.theme.config[key];
  return (raw === undefined ? fallback : (raw as T));
}