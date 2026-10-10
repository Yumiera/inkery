import { padDisplay } from './text';

const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR === '1');

const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const color = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90'),
};

const stamp = () => color.gray(new Date().toTimeString().slice(0, 8));

export const log = {
  plain(msg = '') {
    process.stdout.write(`${msg}\n`);
  },
  info(msg: string) {
    process.stdout.write(`${color.cyan('ℹ')} ${msg}\n`);
  },
  success(msg: string) {
    process.stdout.write(`${color.green('✔')} ${msg}\n`);
  },
  warn(msg: string) {
    process.stdout.write(`${color.yellow('⚠')} ${msg}\n`);
  },
  error(msg: string) {
    process.stderr.write(`${color.red('✘')} ${msg}\n`);
  },
  step(msg: string) {
    process.stdout.write(`${color.blue('▸')} ${msg}\n`);
  },
  debug(msg: string) {
    if (process.env.INKERY_DEBUG) process.stdout.write(`${stamp()} ${color.gray(msg)}\n`);
  },
  blank() {
    process.stdout.write('\n');
  },
  kv(key: string, value: string, pad = 10) {
    process.stdout.write(`  ${color.gray(padDisplay(key, pad))} ${value}\n`);
  },
  lines(lines: string[], prefix = '  ') {
    for (const l of lines) process.stdout.write(`${prefix}${l}\n`);
  },
};