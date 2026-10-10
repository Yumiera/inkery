/** 本地时间字符串 <-> Date，全部经由这里，避免时区漂移 */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) map[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instant.getTime();
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** 把 'YYYY-MM-DD HH:mm:ss' 按指定时区的墙上时间解析为 Date；非法返回 null */
export function parseLocal(input: string, timeZone = DEFAULT_TIMEZONE): Date | null {
  if (typeof input !== 'string') return null;
  const m = LOCAL_RE.exec(input.trim());
  if (!m) return null;

  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = utcGuess - tzOffsetMs(new Date(utcGuess), timeZone);
  ts = utcGuess - tzOffsetMs(new Date(ts), timeZone);
  const result = new Date(ts);

  // 校验回读一致，捕获 2026-02-31 这类不存在的日期
  const back = formatLocal(result, timeZone);
  if (back !== toLocalString(year, month, day, hour, minute, second)) return null;
  return result;
}

/** Date -> 'YYYY-MM-DD HH:mm:ss'（按指定时区） */
export function formatLocal(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) map[part.type] = part.value;
  return toLocalString(
    Number(map.year),
    Number(map.month),
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
}

/** Date -> 'YYYY-MM-DD'（按指定时区） */
export function formatLocalDate(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  return formatLocal(date, timeZone).slice(0, 10);
}

function toLocalString(y: number, mo: number, d: number, h: number, mi: number, s: number): string {
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${p(y, 4)}-${p(mo)}-${p(d)} ${p(h)}:${p(mi)}:${p(s)}`;
}

/** 当前时间的本地字符串 */
export function nowLocal(timeZone = DEFAULT_TIMEZONE): string {
  return formatLocal(new Date(), timeZone);
}

/** 解析广义时间输入：支持 Date、ISO、'YYYY-MM-DD HH:mm:ss'、'YYYY/MM/DD' */
export function toDate(input: unknown, timeZone = DEFAULT_TIMEZONE): Date | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input !== 'string') return null;
  const normalized = input.trim().replace(/\//g, '-').replace('T', ' ');
  const local = parseLocal(normalized, timeZone);
  if (local) return local;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 人类可读的「x 分钟前」 */
export function fromNow(date: Date, now = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const suffix = diff >= 0 ? '前' : '后';
  if (abs < minute) return '刚刚';
  if (abs < hour) return `${Math.floor(abs / minute)} 分钟${suffix}`;
  if (abs < day) return `${Math.floor(abs / hour)} 小时${suffix}`;
  if (abs < 30 * day) return `${Math.floor(abs / day)} 天${suffix}`;
  return formatLocalDate(date);
}