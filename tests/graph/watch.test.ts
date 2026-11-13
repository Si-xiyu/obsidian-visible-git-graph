// @vitest-environment jsdom
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepoWatcher } from '../../src/graph/watch';
import { watchRepo } from '../../src/graph/watch';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('watchRepo', () => {
  let root: string | null = null;
  let watcher: RepoWatcher | null = null;

  afterEach(async () => {
    watcher?.close();
    watcher = null;
    if (root !== null) {
      await rm(root, { recursive: true, force: true });
      root = null;
    }
  });

  it('reports a write inside .git and stops after close', async () => {
    root = await mkdtemp(join(tmpdir(), 'visible-git-watch-'));
    await mkdir(join(root, '.git'));

    let calls = 0;
    watcher = watchRepo(root, () => {
      calls += 1;
    });

    await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await sleep(500);
    expect(calls).toBeGreaterThanOrEqual(1);

    watcher.close();
    watcher = null;
    const callsAtClose = calls;

    await writeFile(join(root, '.git', 'index'), 'index\n');
    await sleep(450);
    expect(calls).toBe(callsAtClose);
  });

  it('coalesces a burst of writes into one callback', async () => {
    root = await mkdtemp(join(tmpdir(), 'visible-git-watch-'));
    await mkdir(join(root, '.git'));

    let calls = 0;
    watcher = watchRepo(root, () => {
      calls += 1;
    });

    await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(root, '.git', 'ORIG_HEAD'), 'a\n');
    await writeFile(join(root, '.git', 'MERGE_HEAD'), 'b\n');
    await sleep(500);

    expect(calls).toBe(1);
  });

  it('does not fire a pending callback after close', async () => {
    root = await mkdtemp(join(tmpdir(), 'visible-git-watch-'));
    await mkdir(join(root, '.git'));

    let calls = 0;
    watcher = watchRepo(root, () => {
      calls += 1;
    });

    await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    // Close inside the 300ms window, before the debounce timer can fire.
    watcher.close();
    watcher = null;
    await sleep(450);
    expect(calls).toBe(0);
  });

  it('follows a worktree .git pointer and its shared commondir', async () => {
    root = await mkdtemp(join(tmpdir(), 'visible-git-watch-'));
    const worktreeGit = join(root, 'worktree-git');
    const commonGit = join(root, 'common-git');
    await mkdir(worktreeGit);
    await mkdir(commonGit);
    await writeFile(join(root, '.git'), `gitdir: ${worktreeGit}\n`);
    await writeFile(join(worktreeGit, 'commondir'), '../common-git\n');

    let calls = 0;
    watcher = watchRepo(root, () => {
      calls += 1;
    });

    await writeFile(join(commonGit, 'packed-refs'), 'refs/heads/main\n');
    await sleep(500);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it('returns a no-op watcher when the path cannot be watched', async () => {
    root = await mkdtemp(join(tmpdir(), 'visible-git-watch-'));
    let calls = 0;
    // No `.git` and no permission problems: the root fallback is watchable, so
    // this only proves the watcher is created and can be closed safely twice.
    watcher = watchRepo(join(root, 'missing'), () => {
      calls += 1;
    });
    watcher.close();
    watcher.close();
    await sleep(50);
    expect(calls).toBe(0);
  });
});
