import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitError, runGit } from '../../src/git/run';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'visible-git-run-'));
  tempDirs.push(dir);
  return dir;
}

async function captureError(promise: Promise<unknown>): Promise<GitError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GitError);
    return error as GitError;
  }
  throw new Error('expected runGit() to reject, but it resolved');
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runGit', () => {
  it('cancels an active process without reporting a timeout', async () => {
    const cwd = await makeTempDir();
    const controller = new AbortController();
    const result = captureError(runGit(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], cwd, {
      signal: controller.signal,
    }));
    controller.abort();
    expect((await result).code).toBe('ABORTED');
  });

  it('reports buffer limits separately from other command failures', async () => {
    const cwd = await makeTempDir();
    const error = await captureError(runGit(process.execPath, ['-e', "process.stdout.write('x'.repeat(4096))"], cwd, {
      maxBufferBytes: 1024,
    }));
    expect(error.code).toBe('MAX_BUFFER');
  });
  it('runs git --version and returns raw stdout', async () => {
    const cwd = await makeTempDir();

    const result = await runGit('git', ['--version'], cwd);

    expect(result.stdout).toContain('git version');
    expect(result.stdout.endsWith('\n')).toBe(true);
    expect(result.stderr).toBe('');
  });

  it('does not trim successful stdout or stderr', async () => {
    const cwd = await makeTempDir();
    const script = "process.stdout.write('  keep  \\n');process.stderr.write('  keep-err  \\n')";

    const result = await runGit(process.execPath, ['-e', script], cwd);

    expect(result.stdout).toBe('  keep  \n');
    expect(result.stderr).toBe('  keep-err  \n');
  });

  it('classifies a missing git executable as ENOENT', async () => {
    const cwd = await makeTempDir();
    const missingGit = join(cwd, 'definitely-no-such-git-executable');

    const error = await captureError(runGit(missingGit, ['--version'], cwd));

    expect(error.code).toBe('ENOENT');
    expect(error.args).toEqual(['--version']);
    expect(error.cwd).toBe(cwd);
  });

  it('classifies a non-zero git exit as EXIT and keeps the fatal stderr text', async () => {
    const cwd = await makeTempDir();
    await runGit('git', ['init', '--quiet'], cwd);

    const error = await captureError(runGit('git', ['rev-parse', '--verify', 'no-such-ref-xyz'], cwd));

    expect(error.code).toBe('EXIT');
    expect(error.stderr).toContain('fatal');
    expect(error.args).toEqual(['rev-parse', '--verify', 'no-such-ref-xyz']);
    expect(error.cwd).toBe(cwd);
  });

  it('returns stderr byte-for-byte for a non-zero exit', async () => {
    const cwd = await makeTempDir();
    const script = "process.stderr.write('raw-stderr-text');process.exit(7)";

    const error = await captureError(runGit(process.execPath, ['-e', script], cwd));

    expect(error.code).toBe('EXIT');
    expect(error.stderr).toBe('raw-stderr-text');
  });

  it('classifies a spawn killed by the timeout as TIMEOUT', async () => {
    const cwd = await makeTempDir();
    const script = 'setTimeout(() => {}, 5000)';

    const error = await captureError(runGit(process.execPath, ['-e', script], cwd, { timeoutMs: 100 }));

    expect(error.code).toBe('TIMEOUT');
  });

  it('classifies an externally signalled child as EXIT rather than TIMEOUT', async () => {
    const cwd = await makeTempDir();
    const script = "process.kill(process.pid, 'SIGTERM')";

    const error = await captureError(runGit(process.execPath, ['-e', script], cwd, { timeoutMs: 5000 }));

    expect(error.code).toBe('EXIT');
  });
});
