import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { headBranch, log, parseStatusPorcelainZ, refs, resolveRepoRoot, status } from '../../src/git/repo';

/** Fixed base timestamp so commit dates are deterministic. */
const BASE_DATE = 1_700_000_000;

const tempDirs: string[] = [];

/** Empty git config files keep the host's global/system configuration out of the tests. */
const isolatedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-graph-config-'));
const emptyGitConfig = path.join(isolatedConfigDir, 'gitconfig');
fs.writeFileSync(emptyGitConfig, '');

const previousGitConfig = {
  global: process.env.GIT_CONFIG_GLOBAL,
  system: process.env.GIT_CONFIG_SYSTEM,
};

beforeAll(() => {
  // The functions under test inherit process.env through runGit, so isolate
  // them as well as the git helper below (e.g. status.renames settings).
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
  const dir = mkTempDir('dsh-git-graph-repo-');
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

function commitFile(dir: string, file: string, content: string, message: string, seconds: number): string {
  writeFile(dir, file, content);
  git(dir, ['add', '--', file]);
  git(dir, ['commit', '-m', message], dateEnv(seconds));
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
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

describe('resolveRepoRoot', () => {
  it('returns the absolute root for a real repository', async () => {
    const repo = initRepo();
    const root = await resolveRepoRoot(repo);
    expect(root).not.toBeNull();
    expect((root ?? '').replace(/\\/g, '/').toLowerCase()).toBe(path.resolve(repo).replace(/\\/g, '/').toLowerCase());
  });

  it('returns null outside any repository', async () => {
    const dir = mkTempDir('dsh-git-graph-not-a-repo-');
    await expect(resolveRepoRoot(dir)).resolves.toBeNull();
  });

  it('propagates a missing git executable as ENOENT', async () => {
    const repo = initRepo();
    await expect(resolveRepoRoot(repo, 'dsh-git-graph-no-such-git-executable')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('propagates a spawn timeout as TIMEOUT', async () => {
    const dir = mkTempDir('dsh-git-graph-timeout-');
    // Node executes the extensionless file named `rev-parse` passed as argv[1].
    fs.writeFileSync(path.join(dir, 'rev-parse'), 'setTimeout(() => {}, 5000)');

    await expect(resolveRepoRoot(dir, process.execPath, { timeoutMs: 100 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });
});

describe('headBranch', () => {
  it('reads the symbolic branch and returns null when detached', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);

    expect(await headBranch(repo)).toBe('main');

    git(repo, ['checkout', '-q', '--detach']);
    expect(await headBranch(repo)).toBeNull();
  });
});
describe('log', () => {
  it('returns the newest commits first and reports moreAvailable', async () => {
    const repo = initRepo();
    const first = commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);
    const second = commitFile(repo, 'a.txt', 'two', 'second', BASE_DATE + 60);
    const third = commitFile(repo, 'a.txt', 'three', 'third', BASE_DATE + 120);

    const page = await log(repo, { count: 2 });
    expect(page.moreAvailable).toBe(true);
    expect(page.commits).toHaveLength(2);
    expect(page.commits.map((commit) => commit.hash)).toEqual([third, second]);

    const newest = page.commits[0];
    expect(newest.parents).toEqual([second]);
    expect(newest.author).toBe('Test User');
    expect(newest.email).toBe('test@example.com');
    expect(newest.authorDate).toBe(BASE_DATE + 120);
    expect(newest.committer).toBe('Test User');
    expect(newest.committerEmail).toBe('test@example.com');
    expect(newest.committerDate).toBe(BASE_DATE + 120);
    expect(newest.message.trim()).toBe('third');

    const skipped = await log(repo, { count: 1, skip: 1 });
    expect(skipped.commits.map((commit) => commit.hash)).toEqual([second]);
    expect(skipped.moreAvailable).toBe(true);

    const all = await log(repo, { count: 10 });
    expect(all.moreAvailable).toBe(false);
    expect(all.commits.map((commit) => commit.hash)).toEqual([third, second, first]);
  });

  it('keeps parents that fall outside the requested window', async () => {
    const repo = initRepo();
    const first = commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);
    const second = commitFile(repo, 'a.txt', 'two', 'second', BASE_DATE + 60);

    const page = await log(repo, { count: 1 });
    expect(page.commits).toHaveLength(1);
    expect(page.commits[0].hash).toBe(second);
    expect(page.commits[0].parents).toEqual([first]);
  });

  it('returns both parents of a merge commit', async () => {
    const repo = initRepo();
    const base = commitFile(repo, 'a.txt', 'base', 'base', BASE_DATE);

    git(repo, ['checkout', '-q', '-b', 'feature']);
    const feature = commitFile(repo, 'feature.txt', 'feature', 'feature work', BASE_DATE + 60);

    git(repo, ['checkout', '-q', 'main']);
    const main = commitFile(repo, 'main.txt', 'main', 'main work', BASE_DATE + 120);

    git(repo, ['merge', '--no-ff', 'feature', '-m', 'merge feature'], dateEnv(BASE_DATE + 180));
    const merge = git(repo, ['rev-parse', 'HEAD']).trim();
    expect(merge).not.toBe(main);

    const page = await log(repo, { count: 10 });
    const mergeCommit = page.commits.find((commit) => commit.hash === merge);
    expect(mergeCommit).toBeDefined();
    expect(mergeCommit?.parents).toEqual([main, feature]);
    expect(mergeCommit?.message.trim()).toBe('merge feature');

    // The base commit must remain reachable exactly once through the graph.
    expect(page.commits.filter((commit) => commit.hash === base)).toHaveLength(1);
  });

  it('preserves commit messages containing the 0x1f separator', async () => {
    const repo = initRepo();
    writeFile(repo, 'a.txt', 'one');
    git(repo, ['add', '--', 'a.txt']);

    // Put the message file inside .git so it does not show up as untracked.
    const messageFile = path.join(repo, '.git', 'dsh-message.txt');
    fs.writeFileSync(messageFile, 'subject\x1fwith-separator\n\nbody line\n');
    git(repo, ['commit', '-F', messageFile], dateEnv(BASE_DATE));

    const page = await log(repo, { count: 1 });
    expect(page.commits).toHaveLength(1);
    expect(page.commits[0].message.replace(/\r\n/g, '\n')).toBe('subject\x1fwith-separator\n\nbody line\n');
  });

  it('sees stash commits after stashing tracked changes', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);

    writeFile(repo, 'a.txt', 'modified');
    git(repo, ['stash', 'push'], dateEnv(BASE_DATE + 60));

    const stashed = await status(repo);
    expect(stashed.dirtyCount).toBe(0);

    const page = await log(repo, { count: 20 });
    expect(page.commits.some((commit) => commit.message.trim().startsWith('WIP on '))).toBe(true);
  });
});

describe('refs', () => {
  it('peels annotated tags and keeps lightweight tags on their commit', async () => {
    const repo = initRepo();
    const first = commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);
    const second = commitFile(repo, 'a.txt', 'two', 'second', BASE_DATE + 60);

    git(repo, ['tag', '-a', 'v1', '-m', 'release v1', second]);
    git(repo, ['tag', 'light', first]);

    const all = await refs(repo);

    const branch = all.find((ref) => ref.refname === 'refs/heads/main');
    expect(branch).toMatchObject({ name: 'main', type: 'branch', hash: second, peeled: false });

    const annotated = all.find((ref) => ref.refname === 'refs/tags/v1');
    expect(annotated).toMatchObject({ name: 'v1', type: 'tag', hash: second, peeled: true });

    const lightweight = all.find((ref) => ref.refname === 'refs/tags/light');
    expect(lightweight).toMatchObject({ name: 'light', type: 'tag', hash: first, peeled: false });

    expect(all.every((ref) => ref.type === 'branch' || ref.type === 'remote' || ref.type === 'tag')).toBe(true);
  });
});

describe('status', () => {
  it('parses copy entries including the original path', () => {
    // `git status` itself emits R (not C), but the porcelain parser accepts
    // both record kinds; keep this covered with a synthetic record.
    expect(parseStatusPorcelainZ('C  copied.txt\0original.txt\0')).toEqual([
      { index: 'C', worktree: ' ', path: 'copied.txt', originalPath: 'original.txt' },
    ]);
  });

  it('reports modified files and untracked files with their paths', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);

    writeFile(repo, 'a.txt', 'two');
    writeFile(repo, 'untracked.txt', 'new');
    writeFile(repo, path.join('nested', 'nested.txt'), 'nested');

    const result = await status(repo);
    expect(result.dirtyCount).toBe(result.entries.length);
    expect(result.dirtyCount).toBe(3);

    const modified = result.entries.find((entry) => entry.path === 'a.txt');
    expect(modified).toBeDefined();
    expect(modified?.worktree).toBe('M');
    expect(modified?.index).toBe(' ');

    const untracked = result.entries.find((entry) => entry.path === 'untracked.txt');
    expect(untracked).toMatchObject({ index: '?', worktree: '?', path: 'untracked.txt' });

    const nested = result.entries.find((entry) => entry.path.replace(/\\/g, '/') === 'nested/nested.txt');
    expect(nested).toBeDefined();
  });

  it('parses renamed entries including the original path', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);

    git(repo, ['mv', 'a.txt', 'renamed.txt']);

    const result = await status(repo);
    const renamed = result.entries.find((entry) => entry.path === 'renamed.txt');
    expect(renamed).toBeDefined();
    expect(renamed?.index).toBe('R');
    expect(renamed?.originalPath).toBe('a.txt');
    expect(result.dirtyCount).toBe(1);
  });
});
