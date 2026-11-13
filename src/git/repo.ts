import path from 'node:path';

import { GitError, runGit, type GitRunOptions } from './run';

export interface GitCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authorDate: number;
  committer: string;
  committerEmail: string;
  committerDate: number;
  message: string;
}

export interface GitRef {
  name: string;
  refname: string;
  type: 'branch' | 'remote' | 'tag';
  hash: string;
  peeled: boolean;
}

export interface StatusEntry {
  index: string;
  worktree: string;
  path: string;
  originalPath?: string;
}

export interface RepoStatus {
  entries: StatusEntry[];
  dirtyCount: number;
}

export interface LogResult {
  commits: GitCommit[];
  moreAvailable: boolean;
}

const DEFAULT_GIT_PATH = 'git';

/** Record/field separators used by `git log -z --format=...`. */
const RECORD_SEP = '\0';
const FIELD_SEP = '\x1f';

/**
 * `git rev-parse --show-toplevel` in `vaultBase`.
 *
 * Returns the absolute work-tree root, or `null` when git cannot resolve a
 * work tree there. Matching on git's stderr is deliberately avoided: those
 * diagnostics are localized, so any normal git failure is treated as "not a
 * repository". Missing git / timeouts still propagate so the UI can show the
 * real spawn error.
 */
export async function resolveRepoRoot(
  vaultBase: string,
  gitPath: string = DEFAULT_GIT_PATH,
  options?: GitRunOptions,
): Promise<string | null> {
  try {
    const { stdout } = await runGit(gitPath, ['rev-parse', '--show-toplevel'], vaultBase, options);
    const trimmed = stdout.trim();
    return trimmed === '' ? null : path.resolve(trimmed);
  } catch (err) {
    if (err instanceof GitError && err.code === 'EXIT') {
      return null;
    }
    throw err;
  }
}

/**
 * `git log --all --date-order` for the graph.
 *
 * Fetches one extra commit to compute `moreAvailable`; that extra commit is
 * never returned. Messages may contain the 0x1f field separator, so only the
 * first eight fields are fixed and the rest is re-joined.
 */
export async function log(
  repoRoot: string,
  opts: { count: number; skip?: number },
  gitPath: string = DEFAULT_GIT_PATH,
): Promise<LogResult> {
  const count = Math.max(0, Math.trunc(opts.count));
  const skip = Math.max(0, Math.trunc(opts.skip ?? 0));

  const { stdout } = await runGit(
    gitPath,
    [
      'log',
      '--all',
      '--date-order',
      '-z',
      '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B',
      '--max-count=' + (count + 1),
      '--skip=' + skip,
    ],
    repoRoot,
  );

  const commits: GitCommit[] = [];
  for (const record of stdout.split(RECORD_SEP)) {
    if (record === '') continue;
    const fields = record.split(FIELD_SEP);
    // Hash, parents, author, email, authorDate, committer, committerEmail,
    // committerDate are fixed; everything after belongs to the message.
    if (fields.length < 9) continue;
    commits.push({
      hash: fields[0],
      parents: fields[1] === '' ? [] : fields[1].split(' '),
      author: fields[2],
      email: fields[3],
      authorDate: Number(fields[4]),
      committer: fields[5],
      committerEmail: fields[6],
      committerDate: Number(fields[7]),
      message: fields.slice(8).join(FIELD_SEP),
    });
  }

  return {
    commits: commits.slice(0, count),
    moreAvailable: commits.length > count,
  };
}

/**
 * Branches, remote-tracking branches and tags of the repository.
 *
 * Annotated tags report the peeled (target) commit as `hash` and `peeled: true`;
 * lightweight tags report their own object hash.
 */
export async function refs(repoRoot: string, gitPath: string = DEFAULT_GIT_PATH): Promise<GitRef[]> {
  const { stdout } = await runGit(
    gitPath,
    [
      'for-each-ref',
      '--format=%(refname)%09%(objecttype)%09%(objectname)%09%(*objectname)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ],
    repoRoot,
  );

  const result: GitRef[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line === '') continue;
    const [refname, objectType, objectName, peeledName] = line.split('\t');
    if (!refname || !objectType || !objectName) continue;

    const type = refTypeOf(refname);
    if (type === null) continue;

    const isAnnotatedTag = objectType === 'tag' && peeledName !== undefined && peeledName !== '';
    result.push({
      name: refname.slice(refPrefixOf(type).length),
      refname,
      type,
      hash: isAnnotatedTag ? peeledName : objectName,
      peeled: isAnnotatedTag,
    });
  }
  return result;
}

/**
 * Parse porcelain v1 NUL output into status entries.
 *
 * Rename/copy records carry the original path as the following NUL-separated
 * field. Exported for unit tests: real `git status` only emits `R` (copy
 * detection is a diff option, not a status option), but the parser accepts `C`
 * as well.
 */
export function parseStatusPorcelainZ(stdout: string): StatusEntry[] {
  const fields = stdout.split(RECORD_SEP);
  const entries: StatusEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (record === '') continue;

    const index = record[0] ?? ' ';
    const worktree = record[1] ?? ' ';
    const path = record.slice(3);
    const renamed = index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C';

    if (renamed) {
      // In -z mode the record is "XY NEW\0OLD" (the arrow is omitted).
      const originalPath = fields[i + 1];
      i++;
      entries.push({ index, worktree, path, originalPath });
    } else {
      entries.push({ index, worktree, path });
    }
  }
  return entries;
}

/**
 * Working-tree status in porcelain v1 NUL format.
 *
 * `dirtyCount` is simply the number of reported entries.
 */
export async function status(repoRoot: string, gitPath: string = DEFAULT_GIT_PATH): Promise<RepoStatus> {
  const { stdout } = await runGit(gitPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], repoRoot);
  const entries = parseStatusPorcelainZ(stdout);
  return { entries, dirtyCount: entries.length };
}

/**
 * Current `HEAD` commit hash, or `null` when HEAD does not resolve.
 *
 * A repository without commits has no HEAD, and that is an ordinary state here,
 * so every failure (unborn branch, missing git, timeout, ...) collapses to
 * `null` instead of propagating. Callers that need real diagnostics should run
 * `resolveRepoRoot`/`log` and let those errors surface.
 */
export async function head(repoRoot: string, gitPath: string = DEFAULT_GIT_PATH): Promise<string | null> {
  try {
    const { stdout } = await runGit(gitPath, ['rev-parse', 'HEAD'], repoRoot);
    const trimmed = stdout.trim();
    return trimmed === '' ? null : trimmed;
  } catch (err) {
    // An unborn branch is an ordinary state (empty repository); spawn failures
    // and timeouts must still reach the UI's error state.
    if (err instanceof GitError && err.code === 'EXIT') {
      return null;
    }
    throw err;
  }
}

export interface StashCommitInfo {
  hash: string;
  parents: string[];
}

/**
 * The branch HEAD is attached to, or `null` for a detached HEAD / empty ref.
 *
 * `symbolic-ref` is authoritative: multiple branches may point at the same
 * commit, so scanning `for-each-ref` cannot identify the current one reliably.
 */
export async function headBranch(
  repoRoot: string,
  gitPath: string = DEFAULT_GIT_PATH,
): Promise<string | null> {
  try {
    const { stdout } = await runGit(gitPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot);
    const trimmed = stdout.trim();
    return trimmed === '' ? null : trimmed;
  } catch (err) {
    // Detached HEAD is a normal state, not an error.
    if (err instanceof GitError && err.code === 'EXIT') return null;
    throw err;
  }
}

/**
 * Every stash reflog entry, with its parent hashes.
 *
 * `git log -g refs/stash` yields one line per entry; the first parent is the
 * commit the stash was based on, and any further parents are the index /
 * untracked snapshot commits (the "stash internal" rows). A repository with no
 * stash makes the ref ambiguous and exits non-zero, which is not an error here.
 */
export async function stashes(repoRoot: string, gitPath: string = DEFAULT_GIT_PATH): Promise<StashCommitInfo[]> {
  try {
    const { stdout } = await runGit(gitPath, ['log', '-g', 'refs/stash', '--format=%H%x1f%P'], repoRoot);
    return stdout
      .split(/\r?\n/)
      .filter((line) => line !== '')
      .map((line) => {
        const [hash, parents = ''] = line.split('\x1f');
        return { hash, parents: parents === '' ? [] : parents.split(' ') };
      })
      .filter((entry) => entry.hash !== '');
  } catch (err) {
    if (err instanceof GitError && err.code === 'EXIT') {
      return [];
    }
    throw err;
  }
}

function refTypeOf(refname: string): GitRef['type'] | null {
  if (refname.startsWith('refs/heads/')) return 'branch';
  if (refname.startsWith('refs/remotes/')) return 'remote';
  if (refname.startsWith('refs/tags/')) return 'tag';
  return null;
}

function refPrefixOf(type: GitRef['type']): string {
  switch (type) {
    case 'branch':
      return 'refs/heads/';
    case 'remote':
      return 'refs/remotes/';
    case 'tag':
      return 'refs/tags/';
  }
}
