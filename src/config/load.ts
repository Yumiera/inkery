import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_FILENAME, defaultConfig } from './defaults';
import { ConfigError, configSchema, formatZodIssues, type Config } from './schema';
import { normalizeBaseUrl } from '../util/paths';

export interface LoadedConfig {
  /** 校验并归一化后的配置 */
  config: Config;
  /** 配置文件绝对路径 */
  configPath: string;
  /** 项目根目录（配置文件所在目录） */
  root: string;
  contentDir: string;
  themeDir: string;
  outDir: string;
  cacheDir: string;
  scaffoldDir: string;
}

export interface LoadConfigOptions {
  cwd?: string;
  configPath?: string;
}

/** 可热替换的配置持有者：配置重载后就地更新 loaded，持有者无需重建 */
export interface LoadedHolder {
  loaded: LoadedConfig;
}

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 以默认配置为底、用户配置为覆盖；数组整体替换，不做逐元素合并 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(override)) return override as unknown as T;
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: PlainObject = { ...base };
    for (const key of Object.keys(override)) {
      out[key] = deepMerge((base as PlainObject)[key], override[key]);
    }
    return out as unknown as T;
  }
  return (override === undefined ? base : override) as T;
}

export async function findConfigPath(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd);
  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      /* 继续向上 */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function readConfigFile(file: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError([`JSON 解析失败 — ${message}`], file);
  }
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath = options.configPath
    ? path.resolve(cwd, options.configPath)
    : ((await findConfigPath(cwd)) ?? path.join(cwd, CONFIG_FILENAME));

  const raw = await readConfigFile(configPath);
  if (!isPlainObject(raw)) {
    throw new ConfigError(['配置根节点必须是 JSON 对象'], configPath);
  }

  const merged = deepMerge(defaultConfig, raw);
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ConfigError(formatZodIssues(parsed.error), configPath);
  }

  const config = parsed.data;
  config.site.baseUrl = normalizeBaseUrl(config.site.baseUrl);
  config.site.url = config.site.url.replace(/\/+$/, '');
  config.site.keywords = config.site.keywords.filter((k) => k.trim() !== '');

  const root = path.dirname(configPath);
  return {
    config,
    configPath,
    root,
    contentDir: path.join(root, 'content'),
    themeDir: path.join(root, 'themes', config.theme.name),
    outDir: path.resolve(root, config.build.outDir),
    cacheDir: path.join(root, '.cache'),
    scaffoldDir: path.join(root, 'scaffolds'),
  };
}

export function serializeConfig(config: Config): string {
  const ordered: Config = {
    site: config.site,
    navigation: config.navigation,
    social: config.social,
    permalinkPattern: config.permalinkPattern,
    theme: config.theme,
    server: config.server,
    build: config.build,
    deploy: config.deploy,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export async function writeConfig(file: string, config: Config): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, serializeConfig(config), 'utf8');
}