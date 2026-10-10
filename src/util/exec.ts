import { spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** 捕获 stdout/stderr 而不是透传到终端 */
  silent?: boolean;
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/** 逐行流式执行，用于部署时把 git 输出实时回传 */
export function runStream(
  cmd: string,
  args: string[],
  onLine: (line: string, stream: 'stdout' | 'stderr') => void,
  opts: RunOptions = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    const feed = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim() !== '') onLine(line, stream);
      }
    };

    child.stdout?.on('data', feed('stdout'));
    child.stderr?.on('data', feed('stderr'));
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 0));
  });
}

export async function git(args: string[], cwd: string): Promise<RunResult> {
  return run('git', args, { cwd });
}

export async function gitStream(
  args: string[],
  cwd: string,
  onLine: (line: string, stream: 'stdout' | 'stderr') => void,
): Promise<number> {
  return runStream('git', args, onLine, { cwd });
}