import type { CommitFile } from './detail';
import { GitError, runGit } from './run';
import { diffQueue } from './diffQueue';

const MAX_DIFF_BYTES = 2 << 20;
const MAX_DIFF_LINES = 20_000;
const LARGE_DIFF_MESSAGE = '差异过大，暂不预览。请使用外部 Git 工具查看该文件。';

/** Default git executable used when the caller does not supply one. */
const DEFAULT_GIT_PATH = 'git';

export type DiffLineKind = 'add' | 'del' | 'context' | 'hunk' | 'meta';

/**
 * One rendered row of a patch.
 *
 * `text` never carries the patch marker: add/delete/context rows have their
 * leading `+`, `-` or space removed, so the UI decides which gutter marker to
 * draw. Hunk and meta rows keep their full text (the `@@ ... @@` header and the
 * `\ No newline at end of file` marker respectively).
 */
export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  hunks: DiffHunk[];
  binary: boolean;
  additions: number;
  deletions: number;
}

interface WorkingFile {
  headerOldPath?: string;
  headerNewPath?: string;
  renameFrom?: string;
  renameTo?: string;
  minusPath?: string;
  plusPath?: string;
  hunks: DiffHunk[];
  binary: boolean;
  additions: number;
  deletions: number;
}

function newWorkingFile(): WorkingFile {
  return { hunks: [], binary: false, additions: 0, deletions: 0 };
}

/**
 * Read a C-style quoted path starting at `start` (the opening quote).
 *
 * Git emits quoted paths when a name contains a quote, a backslash, a control
 * character, or (with the default `core.quotePath`) any non-ASCII byte. Octal
 * escapes are byte values, so they are decoded through a byte buffer to keep
 * UTF-8 names intact.
 */
function parseQuotedAt(input: string, start: number): { value: string; end: number } | null {
  if (input[start] !== '"') return null;

  const bytes: number[] = [];
  const namedEscapes: Record<string, number> = {
    a: 7,
    b: 8,
    f: 12,
    n: 10,
    r: 13,
    t: 9,
    v: 11,
    '"': 34,
    '\\': 92,
  };

  let i = start + 1;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '"') {
      return { value: Buffer.from(bytes).toString('utf8'), end: i + 1 };
    }
    if (ch === '\\' && i + 1 < input.length) {
      const escape = input[i + 1];
      const named = namedEscapes[escape];
      if (named !== undefined) {
        bytes.push(named);
        i += 2;
        continue;
      }
      if (escape >= '0' && escape <= '7') {
        let octal = '';
        let j = i + 1;
        while (j < input.length && octal.length < 3 && input[j] >= '0' && input[j] <= '7') {
          octal += input[j];
          j++;
        }
        bytes.push(parseInt(octal, 8) & 0xff);
        i = j;
        continue;
      }
      // Unknown escape: keep the escaped character literally.
      bytes.push(...Buffer.from(escape, 'utf8'));
      i += 2;
      continue;
    }
    bytes.push(...Buffer.from(ch, 'utf8'));
    i++;
  }

  return null;
}

/** Decode a path field that may be C-quoted; unquoted values pass through. */
function decodePathField(value: string): string {
  if (!value.startsWith('"')) return value;
  const parsed = parseQuotedAt(value, 0);
  return parsed === null ? value : parsed.value;
}

function stripDiffPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function usablePath(value: string | undefined): string | undefined {
  if (value === undefined || value === '' || value === '/dev/null') return undefined;
  return value;
}

function firstUsable(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const usable = usablePath(value);
    if (usable !== undefined) return usable;
  }
  return undefined;
}

/**
 * Split the two names of a `diff --git a/... b/...` line.
 *
 * Unquoted names may contain spaces, so the delimiter is the ` b/` occurrence
 * that follows the `a/` prefix. Quoted names are tokenised properly.
 */
function parseDiffHeader(rest: string): { oldPath?: string; newPath?: string } {
  if (rest.startsWith('"')) {
    const first = parseQuotedAt(rest, 0);
    if (first === null) return {};
    let i = first.end;
    while (i < rest.length && rest[i] === ' ') i++;
    const second = rest[i] === '"' ? parseQuotedAt(rest, i) : null;
    return {
      oldPath: stripDiffPrefix(first.value, 'a/'),
      ...(second === null ? {} : { newPath: stripDiffPrefix(second.value, 'b/') }),
    };
  }

  if (!rest.startsWith('a/')) return {};
  const separator = rest.indexOf(' b/', 2);
  if (separator < 0) return { oldPath: rest.slice(2) };
  return {
    oldPath: rest.slice(2, separator),
    newPath: rest.slice(separator + 3),
  };
}

interface HunkRange {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/** Parse `@@ -a,b +c,d @@`; omitted counts mean 1, as git writes them. */
function parseHunkRange(line: string): HunkRange | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (match === null) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function finalizeFile(working: WorkingFile, fallbackPath: string | undefined): FileDiff {
  const path =
    firstUsable(working.renameTo, working.plusPath, working.headerNewPath, fallbackPath) ?? '';
  const oldCandidate = firstUsable(working.renameFrom, working.minusPath, working.headerOldPath);
  const oldPath = oldCandidate !== undefined && oldCandidate !== path ? oldCandidate : undefined;

  return {
    path,
    ...(oldPath === undefined ? {} : { oldPath }),
    hunks: working.hunks,
    binary: working.binary,
    additions: working.additions,
    deletions: working.deletions,
  };
}

/**
 * Parse standard `git diff` / `git show` patch output into per-file diffs.
 *
 * Supported rows: `diff --git` sections, `rename from`/`rename to` and
 * `copy from`/`copy to`, `---`/`+++`, `@@` hunk headers, `+`/`-`/context
 * lines and `\ No newline at end of file` markers. Binary sections are flagged
 * from `Binary files ... differ` or `GIT binary patch` and produce no hunks.
 *
 * The hunk header is the first entry of `hunk.lines` with kind `hunk` as well
 * as being available as `hunk.header`; add/delete/context text is stripped of
 * its marker so the UI can render `kind` itself.
 */
export function parseUnifiedDiff(text: string, fallbackPath?: string): FileDiff[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const files: FileDiff[] = [];
  let working: WorkingFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const finish = (): void => {
    if (working === null) return;
    files.push(finalizeFile(working, files.length === 0 ? fallbackPath : undefined));
    working = null;
    hunk = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      finish();
      const paths = parseDiffHeader(line.slice('diff --git '.length));
      working = newWorkingFile();
      working.headerOldPath = paths.oldPath;
      working.headerNewPath = paths.newPath;
      continue;
    }

    if (working === null) {
      // A binary marker can precede any `diff --git` line in hand-written
      // patches; other preamble text (a commit message, say) is skipped.
      if (line.startsWith('Binary files ')) {
        working = newWorkingFile();
        working.binary = true;
        continue;
      }
      // A bare hunk can only be attributed when the caller named the file.
      if (fallbackPath !== undefined && line.startsWith('@@')) {
        working = newWorkingFile();
      } else {
        continue;
      }
    }

    if (working.binary) {
      // Literal / base85 payload of `GIT binary patch`; not display rows.
      continue;
    }

    if (line.startsWith('@@')) {
      const range = parseHunkRange(line);
      if (range === null) {
        hunk = null;
        continue;
      }
      oldLine = range.oldStart;
      newLine = range.newStart;
      hunk = {
        header: line,
        oldStart: range.oldStart,
        oldCount: range.oldCount,
        newStart: range.newStart,
        newCount: range.newCount,
        lines: [{ kind: 'hunk', text: line }],
      };
      working.hunks.push(hunk);
      continue;
    }

    if (hunk === null) {
      if (line.startsWith('rename from ')) {
        working.renameFrom = decodePathField(line.slice('rename from '.length));
        continue;
      }
      if (line.startsWith('copy from ')) {
        working.renameFrom = decodePathField(line.slice('copy from '.length));
        continue;
      }
      if (line.startsWith('rename to ')) {
        working.renameTo = decodePathField(line.slice('rename to '.length));
        continue;
      }
      if (line.startsWith('copy to ')) {
        working.renameTo = decodePathField(line.slice('copy to '.length));
        continue;
      }
      if (line.startsWith('--- ')) {
        working.minusPath = stripDiffPrefix(decodePathField(line.slice(4)), 'a/');
        continue;
      }
      if (line.startsWith('+++ ')) {
        working.plusPath = stripDiffPrefix(decodePathField(line.slice(4)), 'b/');
        continue;
      }
      if (line.startsWith('Binary files ')) {
        working.binary = true;
        continue;
      }
      if (line === 'GIT binary patch') {
        working.binary = true;
        continue;
      }
      // `index`, mode changes, similarity lines and blank lines are skipped.
      continue;
    }

    if (line === '') continue;

    const marker = line[0];
    if (marker === '\\') {
      hunk.lines.push({ kind: 'meta', text: line });
    } else if (marker === '+') {
      working.additions += 1;
      hunk.lines.push({ kind: 'add', text: line.slice(1), newLine });
      newLine += 1;
    } else if (marker === '-') {
      working.deletions += 1;
      hunk.lines.push({ kind: 'del', text: line.slice(1), oldLine });
      oldLine += 1;
    } else if (marker === ' ') {
      hunk.lines.push({ kind: 'context', text: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
    // Any other prefix inside a hunk is malformed; skipping it keeps the
    // line counters from drifting.
  }

  finish();
  return files;
}

/** `:(top,literal)` protects names that contain pathspec magic (`*`, `?`, `[`). */
function literalPathspec(path: string): string {
  return `:(top,literal)${path}`;
}

/**
 * Load the patch of one changed file with a single spawn.
 *
 * A rename/copy passes both names so git can pair the section; every path is
 * protected as a literal pathspec. The first section naming the file wins. When
 * the output has no section for it (for example a pure mode change), an empty
 * diff is returned instead of throwing; binary is still inferred from the
 * output.
 */
export async function loadFileDiff(
  repoRoot: string,
  hash: string,
  file: CommitFile,
  opts?: { gitPath?: string; signal?: AbortSignal },
): Promise<FileDiff> {
  const gitPath = opts?.gitPath ?? DEFAULT_GIT_PATH;

  const paths = [file.path];
  if (file.originalPath !== undefined && file.originalPath !== file.path) {
    paths.push(file.originalPath);
  }

  return diffQueue.run(async () => {
    let stdout: string;
    try {
      ({ stdout } = await runGit(
        gitPath,
        [
          'show',
          '-m',
          '--first-parent',
          '--format=',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '-U3',
          hash,
          '--',
          ...paths.map(literalPathspec),
        ],
        repoRoot,
        { signal: opts?.signal, maxBufferBytes: MAX_DIFF_BYTES },
      ));
    } catch (error) {
      if (error instanceof GitError && error.code === 'MAX_BUFFER') {
        throw new Error(LARGE_DIFF_MESSAGE);
      }
      throw error;
    }
    opts?.signal?.throwIfAborted();
    // Check line count before allocating per-line objects.
    let lineCount = 0;
    for (let i = 0; i < stdout.length; i++) {
      if (stdout.charCodeAt(i) === 10 && ++lineCount > MAX_DIFF_LINES) {
        throw new Error(LARGE_DIFF_MESSAGE);
      }
    }

    const parsed = parseUnifiedDiff(stdout, file.path);
    const match = parsed.find((candidate) => {
      if (candidate.path === file.path || candidate.oldPath === file.path) return true;
      return (
        file.originalPath !== undefined &&
        (candidate.path === file.originalPath || candidate.oldPath === file.originalPath)
      );
    });
    if (match !== undefined) return match;

    const binary =
      parsed.some((candidate) => candidate.binary) ||
      stdout.includes('Binary files ') ||
      stdout.includes('GIT binary patch');

    return {
      path: file.path,
      ...(file.originalPath === undefined ? {} : { oldPath: file.originalPath }),
      hunks: [],
      binary,
      additions: 0,
      deletions: 0,
    };
  }, opts?.signal);
}
