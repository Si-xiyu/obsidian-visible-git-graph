import { runGit } from './run';

/** Default git executable used when the caller does not supply one. */
const DEFAULT_GIT_PATH = 'git';

/** Field/record separators shared with `git show -z` formats. */
const FIELD_SEP = '\x1f';
const RECORD_SEP = '\0';

export interface CommitMeta {
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

/** Single-letter `git diff --name-status` status, normalised to upper case. */
export type FileStatusCode = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X' | 'B';

export interface CommitFile {
  path: string;
  originalPath?: string;
  status: FileStatusCode;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface CommitDetails {
  meta: CommitMeta;
  files: CommitFile[];
}

/** `git show -s --format=...` field order; the message is everything after the 8th separator. */
const META_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B';

const FILE_STATUSES: ReadonlySet<string> = new Set(['A', 'M', 'D', 'R', 'C', 'T', 'U', 'X', 'B']);

function asCount(text: string): number {
  const value = Number(text);
  return Number.isFinite(value) ? value : 0;
}

function normaliseStatus(record: string): FileStatusCode {
  const letter = (record[0] ?? 'M').toUpperCase();
  return (FILE_STATUSES.has(letter) ? letter : 'M') as FileStatusCode;
}

/**
 * Parse the single record written by the metadata `--format`.
 *
 * Messages may contain the 0x1f separator, so only the first eight fields are
 * positional and the remainder is re-joined unchanged.
 */
function parseCommitMeta(stdout: string, hash: string): CommitMeta {
  const fields = stdout.split(FIELD_SEP);
  const field = (index: number): string => fields[index] ?? '';

  return {
    hash: field(0) || hash,
    parents: field(1) === '' ? [] : field(1).split(' '),
    author: field(2),
    email: field(3),
    authorDate: asCount(field(4)),
    committer: field(5),
    committerEmail: field(6),
    committerDate: asCount(field(7)),
    message: fields.slice(8).join(FIELD_SEP),
  };
}

interface NameStatusEntry {
  path: string;
  originalPath?: string;
  status: FileStatusCode;
}

/**
 * Parse `git show --name-status -z` output.
 *
 * In `-z` mode a plain record is `M\0path\0`; a rename/copy record is
 * `R100\0old\0new\0` (or `C...`). The status letter is the first character of
 * the status token, and the rename destination is the canonical path.
 */
function parseNameStatus(stdout: string): NameStatusEntry[] {
  const fields = stdout.split(RECORD_SEP);
  const entries: NameStatusEntry[] = [];

  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (record === '') continue;

    const status = normaliseStatus(record);
    if (status === 'R' || status === 'C') {
      const originalPath = fields[i + 1];
      const path = fields[i + 2];
      if (originalPath === undefined || path === undefined) break;
      i += 2;
      entries.push({ path, originalPath, status });
    } else {
      const path = fields[i + 1];
      if (path === undefined) break;
      i += 1;
      entries.push({ path, status });
    }
  }

  return entries;
}

interface NumstatEntry {
  path: string;
  originalPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * Parse `git show --numstat -z` output.
 *
 * A plain record is `add\tdel\tpath\0`. A binary file writes `-\t-\tpath\0`
 * and a rename writes `add\tdel\t\0old\0new\0`: git empties the path field and
 * splits the two names into separate NUL fields. Because records are not
 * line-oriented here, entries are consumed by field position rather than by
 * zipping the output with the name-status list.
 */
function parseNumstat(stdout: string): NumstatEntry[] {
  const fields = stdout.split(RECORD_SEP);
  const entries: NumstatEntry[] = [];

  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (record === '') continue;

    const firstTab = record.indexOf('\t');
    const secondTab = firstTab < 0 ? -1 : record.indexOf('\t', firstTab + 1);
    if (secondTab < 0) continue;

    const addText = record.slice(0, firstTab);
    const delText = record.slice(firstTab + 1, secondTab);
    let path = record.slice(secondTab + 1);
    let originalPath: string | undefined;

    if (path === '') {
      originalPath = fields[i + 1];
      path = fields[i + 2] ?? '';
      i += 2;
      if (originalPath === undefined || path === '') break;
    }

    const binary = addText === '-' && delText === '-';
    entries.push({
      path,
      ...(originalPath === undefined ? {} : { originalPath }),
      additions: binary ? 0 : asCount(addText),
      deletions: binary ? 0 : asCount(delText),
      binary,
    });
  }

  return entries;
}

/**
 * Join name-status and numstat output by path.
 *
 * A file seen only in name-status reports zero changes; a file seen only in
 * numstat defaults to `M`. Stats for a rename are keyed by the destination
 * path, exactly like name-status.
 */
function mergeFiles(nameStatus: NameStatusEntry[], numstat: NumstatEntry[]): CommitFile[] {
  const statsByPath = new Map<string, NumstatEntry>();
  for (const entry of numstat) {
    statsByPath.set(entry.path, entry);
  }

  const files: CommitFile[] = [];
  const seen = new Set<string>();

  for (const entry of nameStatus) {
    const stats = statsByPath.get(entry.path);
    seen.add(entry.path);
    files.push({
      path: entry.path,
      ...(entry.originalPath === undefined ? {} : { originalPath: entry.originalPath }),
      status: entry.status,
      additions: stats?.additions ?? 0,
      deletions: stats?.deletions ?? 0,
      binary: stats?.binary ?? false,
    });
  }

  for (const stats of numstat) {
    if (seen.has(stats.path)) continue;
    files.push({
      path: stats.path,
      ...(stats.originalPath === undefined ? {} : { originalPath: stats.originalPath }),
      status: 'M',
      additions: stats.additions,
      deletions: stats.deletions,
      binary: stats.binary,
    });
  }

  return files;
}

/**
 * Load one commit's metadata and changed files with two parallel spawns.
 *
 * The metadata `--format` and `--name-status` travel in the same command: git
 * writes the formatted commit record, a NUL terminator, then the name-status
 * records. That keeps a click at the two-spawn budget from the acceptance
 * criteria while still fetching both status lists in parallel. The two diff
 * commands use `-m --first-parent`, so a merge commit reports the changes it
 * introduced relative to its first parent instead of an empty list. Failures
 * (bad hash, missing git, timeout) propagate as the original `GitError`; nothing
 * is rewritten and nothing is cached here.
 */
export async function loadCommitDetails(
  repoRoot: string,
  hash: string,
  opts?: { gitPath?: string },
): Promise<CommitDetails> {
  const gitPath = opts?.gitPath ?? DEFAULT_GIT_PATH;

  const [metaAndStatusResult, numstatResult] = await Promise.all([
    runGit(
      gitPath,
      ['show', '-m', '--first-parent', '--name-status', '-z', `--format=${META_FORMAT}`, hash],
      repoRoot,
    ),
    runGit(gitPath, ['show', '-m', '--first-parent', '--numstat', '-z', '--format=', hash], repoRoot),
  ]);

  // With `-z`, the formatted commit record is terminated by a NUL before the
  // per-file name-status records begin; commit messages cannot contain NUL.
  const separator = metaAndStatusResult.stdout.indexOf(RECORD_SEP);
  const metaText =
    separator < 0 ? metaAndStatusResult.stdout : metaAndStatusResult.stdout.slice(0, separator);
  const statusText = (separator < 0 ? '' : metaAndStatusResult.stdout.slice(separator + 1)).replace(/^[\r\n]+/, '');

  return {
    meta: parseCommitMeta(metaText, hash),
    files: mergeFiles(parseNameStatus(statusText), parseNumstat(numstatResult.stdout)),
  };
}
