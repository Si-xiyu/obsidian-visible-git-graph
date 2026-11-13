/**
 * Glue between the git access layer and the graph pane.
 *
 * One `loadGraph` call answers "what should the table show right now": it
 * resolves the repository, fetches commits/refs/status/HEAD in parallel, folds
 * the working tree into a synthetic uncommitted row and runs the layout engine.
 * It performs no caching, no polling, no file writes and no network access.
 */
import type { GitCommit, GitRef } from '../git/repo';
import { head, headBranch, log, refs, resolveRepoRoot, stashes, status } from '../git/repo';
import type { Commit } from './types';
import { buildLayout, GREY, UNCOMMITTED } from './engine';
import type { GraphPreferences, GraphRefBadge, GraphRow, GraphViewModel } from '../ui/types';

export type LoadGraphResult = { kind: 'none' } | { kind: 'ready'; model: GraphViewModel };

/** Which refs get a badge on their commit row. */
export type RefFilter = 'local' | 'all';

export interface LoadGraphOptions {
  gitPath?: string;
  pageSize?: number;
  /** Commits to skip before this page (pagination offset). */
  skip?: number;
  /**
   * Commits already displayed by the caller. They are merged with the new page
   * by hash so "load more" rebuilds one consistent, duplicate-free list.
   */
  existingCommits?: GitCommit[];
  refFilter?: RefFilter;
}

/** Default number of commits requested per page. */
const DEFAULT_PAGE_SIZE = 200;

/** Fallback colour when a row has no layout point (defensive; should not happen). */
const FALLBACK_COLOUR = GREY;

/** Synthetic commit message shown for working-tree changes. */
const UNCOMMITTED_MESSAGE = 'Uncommitted changes';

/**
 * Load everything the table needs for one render.
 *
 * `resolveRepoRoot` is the only serial step: it tells us whether there is a
 * repository at all. The four git reads then run concurrently because they are
 * independent spawns; running them serially would cost ~4x the latency.
 *
 * `resolveRepoRoot` returns `null` for a non-repository; spawn failures
 * (`ENOENT`, `TIMEOUT`, ...) are intentionally not caught here and reach the UI.
 */
export async function loadGraph(
  vaultBase: string,
  prefs: GraphPreferences,
  opts?: LoadGraphOptions,
): Promise<LoadGraphResult> {
  const gitPath = opts?.gitPath;
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE;
  const skip = opts?.skip ?? 0;
  const refFilter = opts?.refFilter ?? 'local';

  const repoRoot = await resolveRepoRoot(vaultBase, gitPath);
  if (repoRoot === null) {
    return { kind: 'none' };
  }

  const [page, repoRefs, repoStatus, headHash, headBranchName, repoStashes] = await Promise.all([
    log(repoRoot, { count: pageSize, skip }, gitPath),
    refs(repoRoot, gitPath),
    status(repoRoot, gitPath),
    head(repoRoot, gitPath),
    headBranch(repoRoot, gitPath),
    stashes(repoRoot, gitPath),
  ]);

  // Row commits keep the concrete GitCommit shape; layout inputs only need the
  // narrower Commit shape (same objects, plus optional stash flags).
  const stashHashes = new Set(repoStashes.map((entry) => entry.hash));
  const stashInternalHashes = new Set<string>();
  for (const entry of repoStashes) {
    // Parents after the first are the index/untracked snapshot commits.
    for (const parent of entry.parents.slice(1)) stashInternalHashes.add(parent);
  }

  // Merge the page onto the rows the caller already has. Existing commits come
  // first so the visible order stays stable while the user scrolls; dedupe by
  // hash protects against a page that overlaps (new commits pushed in between,
  // or the caller passing a slightly stale offset). The synthetic uncommitted
  // row must never come from the caller: it is re-added below when dirty.
  const seen = new Set<string>();
  const rowCommits: GitCommit[] = [];
  for (const commit of opts?.existingCommits ?? []) {
    if (commit.hash === UNCOMMITTED || seen.has(commit.hash)) continue;
    seen.add(commit.hash);
    rowCommits.push(commit);
  }
  for (const commit of page.commits) {
    if (seen.has(commit.hash)) continue;
    seen.add(commit.hash);
    rowCommits.push(commit);
  }

  const layoutCommits: Commit[] = rowCommits.map((commit) =>
    toLayoutCommit(commit, stashHashes, stashInternalHashes),
  );

  if (repoStatus.dirtyCount > 0) {
    const now = Math.floor(Date.now() / 1000);
    const uncommitted: GitCommit = {
      hash: UNCOMMITTED,
      // An empty repository has no HEAD, but its working tree can still be dirty.
      parents: headHash === null ? [] : [headHash],
      author: '',
      email: '',
      authorDate: now,
      committer: '',
      committerEmail: '',
      committerDate: now,
      message: UNCOMMITTED_MESSAGE,
    };
    // The uncommitted row always belongs at the top of the list.
    rowCommits.unshift(uncommitted);
    layoutCommits.unshift(uncommitted);
  }

  const layout = buildLayout(layoutCommits, {
    head: headHash,
    firstParentOnly: prefs.firstParentOnly,
    muteMerges: prefs.muteMerges,
    muteNonAncestors: prefs.muteNonAncestors,
    style: prefs.style,
    uncommittedMark: prefs.uncommittedMark,
    maxWidth: prefs.maxWidth,
  });

  const rowByHash = new Map<string, number>();
  for (let i = 0; i < rowCommits.length; i++) {
    // The uncommitted row is first; a real hash is never duplicated.
    if (!rowByHash.has(rowCommits[i].hash)) {
      rowByHash.set(rowCommits[i].hash, i);
    }
  }

  const colourAt = (row: number): string => layout.points[row]?.colour ?? FALLBACK_COLOUR;
  const badgesByRow: GraphRefBadge[][] = rowCommits.map(() => []);

  // `local` hides remote-tracking refs (their commits still appear via --all);
  // `all` shows every branch, remote and tag.
  const visibleRefs =
    refFilter === 'all'
      ? repoRefs
      : repoRefs.filter((ref) => ref.type === 'branch' || ref.type === 'tag');

  for (const ref of visibleRefs) {
    const row = rowByHash.get(ref.hash);
    if (row === undefined) continue;
    badgesByRow[row].push(toBadge(ref, colourAt(row)));
  }

  if (headHash !== null) {
    const row = rowByHash.get(headHash);
    if (row !== undefined) {
      // HEAD is a pseudo-ref: git does not list it in refs/*, and it belongs
      // ahead of the branch/tag badges on its commit.
      badgesByRow[row].unshift({ key: 'HEAD', name: 'HEAD', type: 'head', colour: colourAt(row) });
    }
  }

  const rows: GraphRow[] = rowCommits.map((commit, row) => ({
    commit,
    row,
    hash: commit.hash,
    description: firstLine(commit.message),
    author: commit.author,
    date: commit.authorDate,
    colour: colourAt(row),
    muted: layout.muted[row] ?? false,
    current: layout.points[row]?.current ?? false,
    refs: badgesByRow[row],
  }));

  const graphWidth = layout.rowWidths.length > 0 ? Math.max(0, ...layout.rowWidths) : 0;

  return {
    kind: 'ready',
    model: {
      rows,
      layout,
      graphWidth,
      contentWidth: layout.contentWidth,
      head: headHash,
      headBranch: headBranchName,
      layoutCommits,
      repoRoot,
      dirtyCount: repoStatus.dirtyCount,
      moreAvailable: page.moreAvailable,
    },
  };
}

/** Project a git commit onto the engine's narrower input shape. */
function toLayoutCommit(
  commit: GitCommit,
  stashHashes: ReadonlySet<string>,
  stashInternalHashes: ReadonlySet<string>,
): Commit {
  return {
    hash: commit.hash,
    parents: commit.parents,
    message: commit.message,
    author: commit.author,
    email: commit.email,
    date: commit.authorDate,
    stash: stashHashes.has(commit.hash) || undefined,
    stashInternal: stashInternalHashes.has(commit.hash) || undefined,
  };
}

/** First non-empty line, trimmed; empty commits render as an empty cell. */
function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0]?.trim() ?? '';
}

function toBadge(ref: GitRef, colour: string): GraphRefBadge {
  return {
    key: ref.refname,
    name: ref.name,
    type: ref.type,
    colour,
  };
}
