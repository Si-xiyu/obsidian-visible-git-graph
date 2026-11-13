/**
 * Repository change watcher.
 *
 * A small set of `fs.watch` handles (recursive where the platform supports it)
 * coalesces bursts of filesystem events into one callback. There is no polling
 * and nothing is written: the watcher only tells the view "something changed"
 * and the view decides when to reload.
 */
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
/** Handle returned to the caller; `close` is idempotent. */
export interface RepoWatcher {
  close(): void;
}

/** Window in which further events are folded into the pending callback. */
const DEBOUNCE_MS = 300;

/** Read a `gitdir:` pointer file (`worktree` checkouts use one). */
function readPointerFile(file: string): string | null {
  try {
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((entry) => entry.startsWith('gitdir:'));
    if (line === undefined) return null;
    const value = line.slice('gitdir:'.length).trim();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

/**
 * Directories whose metadata changes when the repository changes.
 *
 * A normal checkout has `.git` as a directory. A linked worktree has `.git` as
 * a file pointing at `.git/worktrees/<name>`, whose `commondir` file points at
 * the shared metadata directory (where refs live). Watching both the worktree
 * metadata and the common directory keeps HEAD/branch changes visible.
 */
function watchTargets(repoRoot: string): string[] {
  const targets = new Set<string>();
  const dotGit = join(repoRoot, '.git');

  try {
    if (statSync(dotGit).isDirectory()) {
      targets.add(dotGit);
    } else {
      const pointer = readPointerFile(dotGit);
      if (pointer !== null) {
        const gitDir = isAbsolute(pointer) ? pointer : resolve(repoRoot, pointer);
        targets.add(gitDir);

        const commonPointer = join(gitDir, 'commondir');
        if (existsSync(commonPointer)) {
          try {
            const common = readFileSync(commonPointer, 'utf8').trim();
            if (common !== '') targets.add(resolve(gitDir, common));
          } catch {
            // A missing/unreadable commondir is not fatal.
          }
        }
      }
    }
  } catch {
    // `.git` may be missing while a command is still initialising; fall back to
    // the conventional path so the watcher can be attached once it appears.
  }

  if (targets.size === 0) targets.add(dotGit);
  return [...targets];
}

/**
 * Watch `repoRoot` for changes and call `onChange` at most once per 300ms
 * burst.
 *
 * Every target is tried recursively first, then non-recursively; if all of
 * them fail the repository root is watched as a last resort (git may create
 * `.git` after the pane first opened). When every attempt fails the returned
 * watcher is a no-op.
 */
export function watchRepo(repoRoot: string, onChange: () => void): RepoWatcher {
  if (repoRoot.trim() === '') {
    return { close: () => undefined };
  }

  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watchers = new Set<FSWatcher>();

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** Trailing debounce: every event restarts the 300ms quiet window. */
  const schedule = (): void => {
    if (closed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!closed) onChange();
    }, DEBOUNCE_MS);
  };

  const detach = (watcher: FSWatcher): void => {
    watchers.delete(watcher);
    try {
      watcher.close();
    } catch {
      // Closing an already-closed watcher is harmless.
    }
  };

  const attach = (target: string, recursive: boolean): boolean => {
    let watcher: FSWatcher;
    try {
      watcher = watch(target, { recursive }, () => schedule());
    } catch {
      return false;
    }
    watcher.on('error', () => detach(watcher));
    watchers.add(watcher);
    return true;
  };

  for (const target of watchTargets(repoRoot)) {
    if (!attach(target, true)) attach(target, false);
  }

  if (watchers.size === 0) {
    // Last resort: the repository root itself (non-recursive is enough to see a
    // later `.git` creation on every platform).
    attach(repoRoot, false);
  }

  return {
    close(): void {
      if (closed) return;
      closed = true;
      clearTimer();
      for (const watcher of [...watchers]) detach(watcher);
      watchers.clear();
    },
  };
}
