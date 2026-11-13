import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadCommitDetails, type CommitFile } from '../../src/git/detail';

/** Fixed base timestamp so commit dates are deterministic. */
const BASE_DATE = 1_700_000_000;

const tempDirs: string[] = [];

/** Empty git config files keep the host's global/system configuration out of the tests. */
const isolatedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-detail-config-'));
const emptyGitConfig = path.join(isolatedConfigDir, 'gitconfig');
fs.writeFileSync(emptyGitConfig, '');

const previousGitConfig = {
  global: process.env.GIT_CONFIG_GLOBAL,
  system: process.env.GIT_CONFIG_SYSTEM,
};

beforeAll(() => {
  // loadCommitDetails inherits process.env through runGit, so isolate the
  // functions under test as well as the git helper below.
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
  const dir = mkTempDir('dsh-git-detail-repo-');
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

function fileByPath(files: CommitFile[], filePath: string): CommitFile {
  const found = files.find((file) => file.path === filePath);
  expect(found, `expected changed file ${filePath} in ${labels(files)}`).toBeDefined();
  return found as CommitFile;
}

function labels(files: CommitFile[]): string {
  return files.map((file) => `${file.status}:${file.path}`).join(', ');
}

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

describe('loadCommitDetails', () => {
  it('merges metadata with modified, added, deleted and renamed files', async () => {
    const repo = initRepo();
    writeFile(repo, 'a.txt', 'one\ntwo\nthree\n');
    writeFile(repo, 'gone.txt', 'bye\n');
    writeFile(repo, 'old.txt', 'rename me\nline two\nline three\n');
    const base = commitAll(repo, 'base', BASE_DATE);

    writeFile(repo, 'a.txt', 'one\ntwo-changed\nthree\nfour\n');
    writeFile(repo, 'new.txt', 'brand new\n');
    fs.rmSync(path.join(repo, 'gone.txt'));
    git(repo, ['mv', 'old.txt', 'renamed.txt']);
    const head = commitAll(repo, 'second', BASE_DATE + 60);

    const details = await loadCommitDetails(repo, head);

    expect(details.meta).toMatchObject({
      hash: head,
      parents: [base],
      author: 'Test User',
      email: 'test@example.com',
      authorDate: BASE_DATE + 60,
      committer: 'Test User',
      committerEmail: 'test@example.com',
      committerDate: BASE_DATE + 60,
    });
    expect(details.meta.message.trim()).toBe('second');

    expect(details.files).toHaveLength(4);

    const modified = fileByPath(details.files, 'a.txt');
    expect(modified).toMatchObject({ status: 'M', additions: 2, deletions: 1, binary: false });
    expect(modified.originalPath).toBeUndefined();

    const added = fileByPath(details.files, 'new.txt');
    expect(added).toMatchObject({ status: 'A', additions: 1, deletions: 0, binary: false });
    expect(added.originalPath).toBeUndefined();

    const deleted = fileByPath(details.files, 'gone.txt');
    expect(deleted).toMatchObject({ status: 'D', additions: 0, deletions: 1, binary: false });
    expect(deleted.originalPath).toBeUndefined();

    const renamed = fileByPath(details.files, 'renamed.txt');
    expect(renamed).toMatchObject({
      status: 'R',
      originalPath: 'old.txt',
      additions: 0,
      deletions: 0,
      binary: false,
    });
  });

  it('reports a merge commit against its first parent', async () => {
    const repo = initRepo();
    writeFile(repo, 'a.txt', 'base\n');
    const base = commitAll(repo, 'base', BASE_DATE);

    git(repo, ['checkout', '-q', '-b', 'feature']);
    writeFile(repo, 'feature.txt', 'from feature\n');
    const feature = commitAll(repo, 'feature work', BASE_DATE + 60);

    git(repo, ['checkout', '-q', 'main']);
    writeFile(repo, 'main.txt', 'on main\n');
    const main = commitAll(repo, 'main work', BASE_DATE + 120);

    git(repo, ['merge', '--no-ff', 'feature', '-m', 'merge feature'], dateEnv(BASE_DATE + 180));
    const merge = git(repo, ['rev-parse', 'HEAD']).trim();
    expect(merge).not.toBe(base);

    const details = await loadCommitDetails(repo, merge);

    expect(details.meta.parents).toEqual([main, feature]);

    // Relative to the first parent (main), the merge brings in feature.txt, and
    // main.txt is unchanged, so it must not appear.
    expect(details.files).toHaveLength(1);
    const added = fileByPath(details.files, 'feature.txt');
    expect(added).toMatchObject({ status: 'A', additions: 1, deletions: 0 });
    expect(details.files.some((file) => file.path === 'main.txt')).toBe(false);
  });

  it('marks binary changes and reports no line counts', async () => {
    const repo = initRepo();
    writeFile(repo, 'text.txt', 'hello\n');
    writeBinaryFile(repo, 'data.bin', [0, 1, 2, 3, 0, 10]);
    commitAll(repo, 'base', BASE_DATE);

    writeBinaryFile(repo, 'data.bin', [9, 8, 7, 0, 6, 5]);
    const head = commitAll(repo, 'change binary', BASE_DATE + 60);

    const details = await loadCommitDetails(repo, head);

    expect(details.files).toHaveLength(1);
    const binary = fileByPath(details.files, 'data.bin');
    expect(binary).toMatchObject({
      status: 'M',
      binary: true,
      additions: 0,
      deletions: 0,
    });
  });

  it('propagates an unknown hash as a GitError', async () => {
    const repo = initRepo();
    writeFile(repo, 'a.txt', 'base\n');
    commitAll(repo, 'base', BASE_DATE);

    await expect(loadCommitDetails(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).rejects.toMatchObject({
      name: 'GitError',
      code: 'EXIT',
    });
    await expect(loadCommitDetails(repo, 'not-a-commit')).rejects.toMatchObject({
      name: 'GitError',
      code: 'EXIT',
    });
  });
});
