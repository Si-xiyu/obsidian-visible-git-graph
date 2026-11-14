/**
 * Repository change watcher.
 *
 * Watches only the metadata git rewrites when commits, refs, HEAD or the index
 * change: `HEAD`, `packed-refs`, `index`, `logs/HEAD` and `refs/`.
 *
 * The rest of `.git` is deliberately excluded. In particular, watching
 * `.git/objects/**` looks harmless but is not: reading an object file updates
 * its last-access time on Windows, and `fs.watch` reports that as a change, so
 * every commit details/diff read would reload the pane (and make it flash the
 * loading row). Object files are never a signal that HEAD, a ref or the index
 * changed; the files watched here are.
 */
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/** Handle returned to the caller; `close` is idempotent. */
export interface RepoWatcher {
  close(): void;
}

/** Window in which further events are folded into the pending callback. */
const DEBOUNCE_MS = 300;

/** Files under a git directory that change when the repository does. */
const GIT_FILES = ['HEAD', 'packed-refs', 'index', join('logs', 'HEAD')];

/**
 * Direct children of a git directory whose rename/write is a real change.
 * Filtering on the name keeps directory-level noise (for example `index.lock`
 * being created during an index write) from scheduling a reload.
 */
const DIRECT_RENAME_FILES: ReadonlySet<string> = new Set(['HEAD', 'packed-refs', 'index']);

/** Ref subdirectories, used when recursive watching of `refs/` is unavailable. */
const REF_DIRS = ['heads', 'remotes', 'tags'].map((dir) => join('refs', dir));

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

interface GitDirs {
  /** The directory holding this checkout's HEAD/index/logs. */
  gitDir: string;
  /** Shared metadata for a linked worktree; null for a normal checkout. */
  commonDir: string | null;
}

/**
 * Resolve the per-worktree git directory and, for a linked worktree, the
 * shared common directory where refs and packed-refs live.
 */
function resolveGitDirs(repoRoot: string): GitDirs {
  const dotGit = join(repoRoot, '.git');

  try {
    if (statSync(dotGit).isDirectory()) {
      return { gitDir: dotGit, commonDir: null };
    }

    const pointer = readPointerFile(dotGit);
    if (pointer === null) {
      return { gitDir: dotGit, commonDir: null };
    }

    const gitDir = isAbsolute(pointer) ? pointer : resolve(repoRoot, pointer);
    let commonDir: string | null = null;
    const commonPointer = join(gitDir, 'commondir');
    if (existsSync(commonPointer)) {
      try {
        const common = readFileSync(commonPointer, 'utf8').trim();
        if (common !== '') commonDir = resolve(gitDir, common);
      } catch {
        // A missing/unreadable commondir is not fatal.
      }
    }
    return { gitDir, commonDir };
  } catch {
    // `.git` may be missing while a command is still initialising; watch the
    // conventional path so the watcher is attached once it appears.
    return { gitDir: dotGit, commonDir: null };
  }
}

/**
 * Watch `repoRoot` for changes and call `onChange` at most once per 300ms
 * burst.
 *
 * Every attempt is best-effort: a missing or unwatchable metadata path is
 * skipped, and when nothing can be watched the returned watcher is a no-op.
 */
export function watchRepo(repoRoot: string, onChange: () => void): RepoWatcher {
  if (repoRoot.trim() === '') {
    return { close: () => undefined };
  }

  let closed = false;
  let timer: number | null = null;
  const watchers = new Set<FSWatcher>();

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  /** Trailing debounce: every event restarts the 300ms quiet window. */
  const schedule = (): void => {
    if (closed) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
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

  const add = (
    path: string,
    recursive: boolean,
    listener: (eventType: string, filename: string | Buffer | null) => void = schedule,
  ): boolean => {
    if (!existsSync(path)) return false;
    let watcher: FSWatcher;
    try {
      watcher = watch(path, { recursive, persistent: false }, listener);
    } catch {
      return false;
    }
    watcher.on('error', () => detach(watcher));
    watchers.add(watcher);
    return true;
  };

  /**
   * gitDir-level events: only the files git replaces by rename are interesting.
   * `index.lock` and other transient entries are ignored.
   */
  const onDirEvent = (_eventType: string, filename: string | Buffer | null): void => {
    if (filename === null) {
      schedule();
      return;
    }
    if (DIRECT_RENAME_FILES.has(filename.toString())) schedule();
  };

  /** Watch `refs/` recursively, falling back to one watch per ref subdirectory. */
  const watchRefs = (dir: string): void => {
    if (!add(join(dir, 'refs'), true)) {
      for (const refDir of REF_DIRS) add(join(dir, refDir), false);
    }
  };

  /** A checkout's own metadata: HEAD, index, logs/HEAD and its refs. */
  const watchGitDir = (dir: string): void => {
    for (const file of GIT_FILES) add(join(dir, file), false);
    add(dir, false, onDirEvent);
    watchRefs(dir);
  };

  /** A linked worktree's common metadata: refs and packed-refs only. */
  const watchCommonDir = (dir: string): void => {
    add(join(dir, 'packed-refs'), false);
    add(dir, false, onDirEvent);
    watchRefs(dir);
  };

  const { gitDir, commonDir } = resolveGitDirs(repoRoot);
  watchGitDir(gitDir);
  if (commonDir !== null && commonDir !== gitDir) watchCommonDir(commonDir);

  if (watchers.size === 0) {
    // Last resort: the repository root itself (non-recursive is enough to see a
    // later `.git` creation on every platform).
    add(repoRoot, false);
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
