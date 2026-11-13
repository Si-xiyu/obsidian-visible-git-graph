import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CommitFile } from '../../src/git/detail';
import { loadFileDiff, parseUnifiedDiff } from '../../src/git/diff';

/** Fixed base timestamp so commit dates are deterministic. */
const BASE_DATE = 1_700_000_000;

const tempDirs: string[] = [];

/** Empty git config files keep the host's global/system configuration out of the tests. */
const isolatedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-diff-config-'));
const emptyGitConfig = path.join(isolatedConfigDir, 'gitconfig');
fs.writeFileSync(emptyGitConfig, '');

const previousGitConfig = {
  global: process.env.GIT_CONFIG_GLOBAL,
  system: process.env.GIT_CONFIG_SYSTEM,
};

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = emptyGitConfig;
  process.env.GIT_CONFIG_SYSTEM = emptyGitConfig;
});

function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const output = execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: emptyGitConfig,
      GIT_CONFIG_SYSTEM: emptyGitConfig,
      GIT_TERMINAL_PROMPT: '0',
      ...env,
    },
  });
  return output.toString();
}

function dateEnv(seconds: number): NodeJS.ProcessEnv {
  const stamp = `${seconds} +0000`;
  return { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp };
}

function initRepo(): string {
  const dir = mkTempDir('dsh-git-diff-repo-');
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Test User']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'tag.gpgsign', 'false']);
  return dir;
}

function writeFile(dir: string, file: string, content: string): string {
  const abs = path.join(dir, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function writeBinaryFile(dir: string, file: string, bytes: number[]): string {
  const abs = path.join(dir, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(bytes));
  return abs;
}

function commitAll(dir: string, message: string, seconds: number): string {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message], dateEnv(seconds));
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line${String(index + 1).padStart(2, '0')}`).join('\n') + '\n';
}

function modifiedFile(overrides: Partial<CommitFile> & Pick<CommitFile, 'path'>): CommitFile {
  return { status: 'M', additions: 0, deletions: 0, binary: false, ...overrides };
}

describe('diff preview limits', () => {
  it.each([
    ['bytes', 'x'.repeat((2 << 20) + 1) + '\n'],
    ['lines', 'short\n'.repeat(20_001)],
  ])('rejects excessive %s with a readable preview message', async (_kind, content) => {
    const repo = initRepo();
    writeFile(repo, 'large.txt', content);
    const hash = commitAll(repo, 'large file', BASE_DATE);
    await expect(loadFileDiff(repo, hash, modifiedFile({ path: 'large.txt' })))
      .rejects.toThrow('差异过大');
  });
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    // Background git spawns of a rejected call may still be releasing the
    // directory on Windows, so let rmSync retry briefly.
    if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

afterAll(() => {
  if (previousGitConfig.global === undefined) {
    delete process.env.GIT_CONFIG_GLOBAL;
  } else {
    process.env.GIT_CONFIG_GLOBAL = previousGitConfig.global;
  }
  if (previousGitConfig.system === undefined) {
    delete process.env.GIT_CONFIG_SYSTEM;
  } else {
    process.env.GIT_CONFIG_SYSTEM = previousGitConfig.system;
  }
  fs.rmSync(isolatedConfigDir, { recursive: true, force: true });
});

describe('loadFileDiff', () => {
  it('parses hunks with hunk headers, line numbers and add/delete counts', async () => {
    const repo = initRepo();
    writeFile(repo, 'lines.txt', numberedLines(30));
    commitAll(repo, 'base', BASE_DATE);

    const changed = numberedLines(30).split('\n');
    changed[1] = 'line02-changed';
    changed[24] = 'line25-changed';
    writeFile(repo, 'lines.txt', changed.join('\n'));
    const head = commitAll(repo, 'change lines 2 and 25', BASE_DATE + 60);

    const diff = await loadFileDiff(repo, head, modifiedFile({ path: 'lines.txt' }));

    expect(diff.path).toBe('lines.txt');
    expect(diff.oldPath).toBeUndefined();
    expect(diff.binary).toBe(false);
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(2);
    expect(diff.hunks).toHaveLength(2);

    const [first, second] = diff.hunks;
    expect(first).toMatchObject({ oldStart: 1, oldCount: 5, newStart: 1, newCount: 5 });
    expect(first.header).toMatch(/^@@ -1,5 \+1,5 @@/);
    // The hunk header is the first row, so a flattened renderer needs no extra
    // bookkeeping; add/delete/context text is stripped of its marker.
    expect(first.lines.map((line) => line.kind)).toEqual([
      'hunk',
      'context',
      'del',
      'add',
      'context',
      'context',
      'context',
    ]);
    expect(first.lines[0]).toEqual({ kind: 'hunk', text: first.header });
    expect(first.lines[1]).toEqual({ kind: 'context', text: 'line01', oldLine: 1, newLine: 1 });
    expect(first.lines[2]).toEqual({ kind: 'del', text: 'line02', oldLine: 2 });
    expect(first.lines[3]).toEqual({ kind: 'add', text: 'line02-changed', newLine: 2 });
    expect(first.lines[4]).toEqual({ kind: 'context', text: 'line03', oldLine: 3, newLine: 3 });

    expect(second).toMatchObject({ oldStart: 22, oldCount: 7, newStart: 22, newCount: 7 });
    expect(second.header).toMatch(/^@@ -22,7 \+22,7 @@/);
    expect(second.lines.map((line) => line.kind)).toEqual([
      'hunk',
      'context',
      'context',
      'context',
      'del',
      'add',
      'context',
      'context',
      'context',
    ]);
    expect(second.lines[1]).toEqual({ kind: 'context', text: 'line22', oldLine: 22, newLine: 22 });
    expect(second.lines[4]).toEqual({ kind: 'del', text: 'line25', oldLine: 25 });
    expect(second.lines[5]).toEqual({ kind: 'add', text: 'line25-changed', newLine: 25 });
    expect(second.lines[8]).toEqual({ kind: 'context', text: 'line28', oldLine: 28, newLine: 28 });

    // A path that git has nothing for resolves to an empty diff instead of throwing.
    const missing = await loadFileDiff(repo, head, modifiedFile({ path: 'missing.txt' }));
    expect(missing).toMatchObject({ path: 'missing.txt', hunks: [], binary: false, additions: 0, deletions: 0 });
  });

  it('keeps both paths of a renamed file', async () => {
    const repo = initRepo();
    const original = Array.from({ length: 10 }, (_, index) => `row${index + 1}`).join('\n') + '\n';
    writeFile(repo, 'old.txt', original);
    commitAll(repo, 'base', BASE_DATE);

    git(repo, ['mv', 'old.txt', 'renamed.txt']);
    writeFile(repo, 'renamed.txt', original.replace('row5', 'row5-changed'));
    const head = commitAll(repo, 'rename old.txt', BASE_DATE + 60);

    const file = modifiedFile({ path: 'renamed.txt', originalPath: 'old.txt', status: 'R' });
    const diff = await loadFileDiff(repo, head, file);

    expect(diff.path).toBe('renamed.txt');
    expect(diff.oldPath).toBe('old.txt');
    expect(diff.binary).toBe(false);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.hunks[0].lines).toContainEqual({ kind: 'del', text: 'row5', oldLine: 5 });
    expect(diff.hunks[0].lines).toContainEqual({ kind: 'add', text: 'row5-changed', newLine: 5 });
  });

  it('flags a binary file without producing hunks', async () => {
    const repo = initRepo();
    writeFile(repo, 'text.txt', 'hello\n');
    writeBinaryFile(repo, 'data.bin', [0, 1, 2, 3, 0, 10]);
    commitAll(repo, 'base', BASE_DATE);

    writeBinaryFile(repo, 'data.bin', [9, 8, 7, 0, 6, 5]);
    const head = commitAll(repo, 'change binary', BASE_DATE + 60);

    const diff = await loadFileDiff(repo, head, modifiedFile({ path: 'data.bin' }));

    expect(diff).toMatchObject({
      path: 'data.bin',
      binary: true,
      hunks: [],
      additions: 0,
      deletions: 0,
    });
  });
});

describe('parseUnifiedDiff', () => {
  it('groups multiple files and parses context, add, delete, meta and binary rows', () => {
    const text = [
      'diff --git a/one.txt b/one.txt',
      'index 1111111..2222222 100644',
      '--- a/one.txt',
      '+++ b/one.txt',
      '@@ -1,3 +1,3 @@',
      ' first',
      '-second',
      '+SECOND',
      ' third',
      '\\ No newline at end of file',
      'diff --git a/bin.dat b/bin.dat',
      'index 3333333..4444444 100644',
      'Binary files a/bin.dat and b/bin.dat differ',
      'diff --git a/old.txt b/new.txt',
      'similarity index 90%',
      'rename from old.txt',
      'rename to new.txt',
      '--- a/old.txt',
      '+++ b/new.txt',
      '@@ -1,2 +1,2 @@',
      '-alpha',
      '+ALPHA',
      ' beta',
      '',
    ].join('\n');

    const files = parseUnifiedDiff(text);

    expect(files).toHaveLength(3);

    const [one, binary, renamed] = files;
    expect(one.path).toBe('one.txt');
    expect(one.oldPath).toBeUndefined();
    expect(one.binary).toBe(false);
    expect(one.additions).toBe(1);
    expect(one.deletions).toBe(1);
    expect(one.hunks).toHaveLength(1);
    expect(one.hunks[0].lines.map((line) => line.kind)).toEqual([
      'hunk',
      'context',
      'del',
      'add',
      'context',
      'meta',
    ]);
    expect(one.hunks[0].lines[0]).toEqual({ kind: 'hunk', text: '@@ -1,3 +1,3 @@' });
    expect(one.hunks[0].lines[1]).toEqual({ kind: 'context', text: 'first', oldLine: 1, newLine: 1 });
    expect(one.hunks[0].lines[2]).toEqual({ kind: 'del', text: 'second', oldLine: 2 });
    expect(one.hunks[0].lines[3]).toEqual({ kind: 'add', text: 'SECOND', newLine: 2 });
    expect(one.hunks[0].lines[4]).toEqual({ kind: 'context', text: 'third', oldLine: 3, newLine: 3 });
    expect(one.hunks[0].lines[5]).toEqual({ kind: 'meta', text: '\\ No newline at end of file' });

    expect(binary.path).toBe('bin.dat');
    expect(binary.binary).toBe(true);
    expect(binary.hunks).toHaveLength(0);
    expect(binary.additions).toBe(0);
    expect(binary.deletions).toBe(0);

    expect(renamed.path).toBe('new.txt');
    expect(renamed.oldPath).toBe('old.txt');
    expect(renamed.hunks).toHaveLength(1);
    expect(renamed.additions).toBe(1);
    expect(renamed.deletions).toBe(1);
    expect(renamed.hunks[0].lines).toContainEqual({ kind: 'add', text: 'ALPHA', newLine: 1 });
  });

  it('uses the fallback path when the patch has no diff header', () => {
    const text = ['@@ -1 +1 @@', '-old', '+new', ''].join('\n');

    const files = parseUnifiedDiff(text, 'fallback.txt');

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('fallback.txt');
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
  });
});
