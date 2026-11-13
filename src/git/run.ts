import { execFile } from 'node:child_process';
import type { ExecFileException } from 'node:child_process';

/** Default per-spawn timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Maximum captured stdout/stderr size per spawn (64 MiB). */
const MAX_BUFFER_BYTES = 64 << 20;

/** How a failed git spawn was classified. */
export type GitErrorCode = 'ENOENT' | 'TIMEOUT' | 'EXIT' | 'ABORTED' | 'MAX_BUFFER';

export interface GitRunResult {
  stdout: string;
  stderr: string;
}

export interface GitRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxBufferBytes?: number;
}

interface GitErrorDetails {
  readonly stderr: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/**
 * Normalised failure for any git spawn.
 *
 * `stderr` is git's output exactly as captured (never rewritten or trimmed) so
 * the UI can show the original diagnostic text.
 */
export class GitError extends Error {
  readonly code: GitErrorCode;
  readonly stderr: string;
  readonly args: readonly string[];
  readonly cwd: string;

  constructor(code: GitErrorCode, details: GitErrorDetails) {
    const lastLine = details.stderr.trim().split(/\r?\n/).pop() ?? '';
    super(`git ${details.args.join(' ')} failed [${code}]${lastLine ? `: ${lastLine}` : ''}`);
    this.name = 'GitError';
    this.code = code;
    this.stderr = details.stderr;
    this.args = details.args;
    this.cwd = details.cwd;
  }
}

/** Coerce execFile output (string, Buffer or undefined) without altering it. */
function toText(value: string | Buffer | undefined | null): string {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value : value.toString('utf8');
}

function classify(error: ExecFileException): GitErrorCode {
  if (error.code === 'ABORT_ERR') return 'ABORTED';
  // Spawn failure: the executable itself does not exist.
  if (error.code === 'ENOENT') {
    return 'ENOENT';
  }
  // Keep output limits distinct so preview callers can explain why loading stopped.
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return 'MAX_BUFFER';
  }
  // execFile sets killed=true only when it terminates the child itself
  // (timeout or abort). A child killed by an external signal leaves killed
  // false, so do not treat error.signal alone as a timeout.
  if (error.killed === true || error.code === 'ETIMEDOUT') {
    return 'TIMEOUT';
  }
  return 'EXIT';
}

/**
 * Run one git command in its own process and normalise failures.
 *
 * The caller receives raw stdout/stderr on success; no trimming or rewriting
 * happens at this layer.
 */
export function runGit(
  gitPath: string,
  args: string[],
  cwd: string,
  options?: GitRunOptions,
): Promise<GitRunResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };

  return new Promise<GitRunResult>((resolve, reject) => {
    execFile(
      gitPath,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: options?.maxBufferBytes ?? MAX_BUFFER_BYTES,
        signal: options?.signal,
        windowsHide: true,
        encoding: 'utf8',
        env,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: toText(stdout), stderr: toText(stderr) });
          return;
        }

        reject(
          new GitError(classify(error), {
            // Partial output is still useful on timeout; prefer the value the
            // error carries and fall back to the captured stderr buffer.
            stderr: toText(error.stderr ?? stderr),
            args,
            cwd,
          }),
        );
      },
    );
  });
}
