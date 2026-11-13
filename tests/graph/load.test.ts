import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { UNCOMMITTED } from '../../src/graph/engine';
import { loadGraph } from '../../src/graph/load';
import { DEFAULT_PREFERENCES } from '../../src/ui/types';

/** Fixed base timestamp so commit dates are deterministic. */
const BASE_DATE = 1_700_000_000;

const tempDirs: string[] = [];

/** Empty git config files keep the host's global/system configuration out of the tests. */
const isolatedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visible-git-graph-load-config-'));
const emptyGitConfig = path.join(isolatedConfigDir, 'gitconfig');
fs.writeFileSync(emptyGitConfig, '');

const previousGitConfig = {
  global: process.env.GIT_CONFIG_GLOBAL,
  system: process.env.GIT_CONFIG_SYSTEM,
};

beforeAll(() => {
  // loadGraph inherits process.env through runGit, so isolate the git reads as
  // well as the helper below (renames, default branch, ...).
  process.env.GIT_CONFIG_GLOBAL = emptyGitConfig;
  process.env.GIT_CONFIG_SYSTEM = emptyGitConfig;
});

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

function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: emptyGitConfig,
      GIT_CONFIG_SYSTEM: emptyGitConfig,
      GIT_TERMINAL_PROMPT: '0',
      ...env,
    },
  }).toString();
}

function dateEnv(seconds: number): NodeJS.ProcessEnv {
  const stamp = `${seconds} +0000`;
  return { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp };
}

function initRepo(): string {
  const dir = mkTempDir('visible-git-graph-load-repo-');
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

describe('loadGraph', () => {
  it('builds a ready view model from a linear history with a tag', async () => {
    const repo = initRepo();
    const first = commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);
    const second = commitFile(repo, 'a.txt', 'two', 'second', BASE_DATE + 60);
    const third = commitFile(repo, 'a.txt', 'three', 'third', BASE_DATE + 120);
    git(repo, ['tag', 'v1', first]);

    const result = await loadGraph(repo, DEFAULT_PREFERENCES);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    const { model } = result;

    expect(model.repoRoot.replace(/\\/g, '/').toLowerCase()).toBe(path.resolve(repo).replace(/\\/g, '/').toLowerCase());
    expect(model.head).toBe(third);
    expect(model.rows).toHaveLength(3);
    expect(model.rows.map((row) => row.hash)).toEqual([third, second, first]);
    expect(model.rows.map((row) => row.description)).toEqual(['third', 'second', 'first']);
    expect(model.rows[0].author).toBe('Test User');
    expect(model.rows[0].date).toBe(BASE_DATE + 120);
    expect(model.rows[0].current).toBe(true);
    expect(model.dirtyCount).toBe(0);
    expect(model.moreAvailable).toBe(false);

    // HEAD is a pseudo-ref on the newest commit; the tag sits on its own row.
    expect(model.rows[0].refs.map((badge) => badge.key)).toContain('HEAD');
    expect(model.rows[0].refs[0]).toMatchObject({ key: 'HEAD', name: 'HEAD', type: 'head' });
    expect(model.rows[1].refs).toEqual([]);
    expect(model.rows[2].refs).toEqual([
      expect.objectContaining({ key: 'refs/tags/v1', name: 'v1', type: 'tag' }),
    ]);
    expect(model.rows[2].refs[0].colour).toBe(model.rows[2].colour);

    expect(model.graphWidth).toBeGreaterThan(0);
    expect(model.layout.points).toHaveLength(3);
    expect(model.layout.rowWidths).toHaveLength(3);
    expect(model.contentWidth).toBeGreaterThan(0);

    // Pagination metadata comes straight from the log window.
    const paged = await loadGraph(repo, DEFAULT_PREFERENCES, { pageSize: 2 });
    expect(paged.kind).toBe('ready');
    if (paged.kind !== 'ready') return;
    expect(paged.model.rows).toHaveLength(2);
    expect(paged.model.moreAvailable).toBe(true);
  });

  it('merges pages by hash and advances moreAvailable', async () => {
    const repo = initRepo();
    const hashes: string[] = [];
    for (let i = 0; i < 5; i++) {
      hashes.push(commitFile(repo, 'page.txt', `v${i}`, `page ${i}`, BASE_DATE + i * 60));
    }
    const newestFirst = hashes.slice().reverse();

    const first = await loadGraph(repo, DEFAULT_PREFERENCES, { pageSize: 2 });
    expect(first.kind).toBe('ready');
    if (first.kind !== 'ready') return;
    expect(first.model.rows.map((row) => row.hash)).toEqual(newestFirst.slice(0, 2));
    expect(first.model.moreAvailable).toBe(true);

    const firstExisting = first.model.rows.map((row) => row.commit);
    const second = await loadGraph(repo, DEFAULT_PREFERENCES, {
      pageSize: 2,
      skip: firstExisting.length,
      existingCommits: firstExisting,
    });
    expect(second.kind).toBe('ready');
    if (second.kind !== 'ready') return;
    expect(second.model.rows.map((row) => row.hash)).toEqual(newestFirst.slice(0, 4));
    expect(second.model.layout.points).toHaveLength(4);
    expect(second.model.moreAvailable).toBe(true);

    const secondExisting = second.model.rows.map((row) => row.commit);
    const third = await loadGraph(repo, DEFAULT_PREFERENCES, {
      pageSize: 2,
      skip: secondExisting.length,
      existingCommits: secondExisting,
    });
    expect(third.kind).toBe('ready');
    if (third.kind !== 'ready') return;
    expect(third.model.rows.map((row) => row.hash)).toEqual(newestFirst);
    expect(third.model.moreAvailable).toBe(false);

    // An overlapping offset (e.g. stale skip) must merge without duplicates and
    // without changing the order the user already sees.
    const overlap = await loadGraph(repo, DEFAULT_PREFERENCES, {
      pageSize: 2,
      skip: 1,
      existingCommits: secondExisting,
    });
    expect(overlap.kind).toBe('ready');
    if (overlap.kind !== 'ready') return;
    expect(overlap.model.rows).toHaveLength(4);
    expect(new Set(overlap.model.rows.map((row) => row.hash)).size).toBe(4);
    expect(overlap.model.rows.map((row) => row.hash)).toEqual(newestFirst.slice(0, 4));
  });

  it('keeps exactly one uncommitted row when merging a dirty page', async () => {
    const repo = initRepo();
    const firstHash = commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);
    const secondHash = commitFile(repo, 'a.txt', 'two', 'second', BASE_DATE + 60);
    writeFile(repo, 'a.txt', 'dirty');

    const firstPage = await loadGraph(repo, DEFAULT_PREFERENCES, { pageSize: 1 });
    expect(firstPage.kind).toBe('ready');
    if (firstPage.kind !== 'ready') return;
    expect(firstPage.model.rows.map((row) => row.hash)).toEqual([UNCOMMITTED, secondHash]);
    expect(firstPage.model.moreAvailable).toBe(true);

    const next = await loadGraph(repo, DEFAULT_PREFERENCES, {
      pageSize: 1,
      skip: firstPage.model.rows.filter((row) => row.hash !== UNCOMMITTED).length,
      // Deliberately pass the synthetic row too: loadGraph must ignore it.
      existingCommits: firstPage.model.rows.map((row) => row.commit),
    });
    expect(next.kind).toBe('ready');
    if (next.kind !== 'ready') return;
    expect(next.model.rows.map((row) => row.hash)).toEqual([
      UNCOMMITTED,
      secondHash,
      firstHash,
    ]);
    expect(next.model.rows.filter((row) => row.hash === UNCOMMITTED)).toHaveLength(1);
    expect(next.model.moreAvailable).toBe(false);
  });

  it('hides remote refs under local and shows them under all', async () => {
    const repo = initRepo();
    const headHash = commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);
    git(repo, ['update-ref', 'refs/remotes/origin/main', headHash]);

    const local = await loadGraph(repo, DEFAULT_PREFERENCES);
    expect(local.kind).toBe('ready');
    if (local.kind !== 'ready') return;
    const localRow = local.model.rows.find((row) => row.hash === headHash);
    expect(localRow).toBeDefined();
    expect(localRow?.refs.some((badge) => badge.type === 'remote')).toBe(false);
    expect(localRow?.refs.some((badge) => badge.type === 'branch')).toBe(true);

    const all = await loadGraph(repo, DEFAULT_PREFERENCES, { refFilter: 'all' });
    expect(all.kind).toBe('ready');
    if (all.kind !== 'ready') return;
    const allRow = all.model.rows.find((row) => row.hash === headHash);
    expect(allRow).toBeDefined();
    expect(allRow?.refs.some((badge) => badge.type === 'remote')).toBe(true);
    expect(allRow?.refs.some((badge) => badge.key === 'refs/remotes/origin/main')).toBe(true);
  });

  it('returns none outside a git repository', async () => {
    const dir = mkTempDir('visible-git-graph-load-not-a-repo-');
    await expect(loadGraph(dir, DEFAULT_PREFERENCES)).resolves.toEqual({ kind: 'none' });
  });

  it('prepends an uncommitted row for working-tree changes', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);
    const head = commitFile(repo, 'a.txt', 'two', 'second', BASE_DATE + 60);

    writeFile(repo, 'a.txt', 'dirty');
    writeFile(repo, 'untracked.txt', 'new');

    const result = await loadGraph(repo, DEFAULT_PREFERENCES);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    const { model } = result;

    expect(model.dirtyCount).toBe(2);
    expect(model.head).toBe(head);
    expect(model.rows).toHaveLength(3);
    expect(model.rows[0].hash).toBe(UNCOMMITTED);
    expect(model.rows[0].commit.hash).toBe(UNCOMMITTED);
    expect(model.rows[0].commit.parents).toEqual([head]);
    expect(model.rows[0].description).toBe('Uncommitted changes');
    expect(model.rows[1].hash).toBe(head);
    expect(model.rows[0].current).toBe(true);
    expect(model.rows[0].refs.map((badge) => badge.key)).not.toContain('HEAD');
    expect(model.rows[1].refs.map((badge) => badge.key)).toContain('HEAD');
    expect(model.graphWidth).toBeGreaterThan(0);
  });

  it('returns ready with no rows for a repository without commits', async () => {
    const repo = initRepo();

    const result = await loadGraph(repo, DEFAULT_PREFERENCES);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.model.rows).toEqual([]);
    expect(result.model.head).toBeNull();
    expect(result.model.graphWidth).toBe(0);
    expect(result.model.dirtyCount).toBe(0);
  });

  it('shows uncommitted changes even before the first commit', async () => {
    const repo = initRepo();
    writeFile(repo, 'untracked.txt', 'new');

    const result = await loadGraph(repo, DEFAULT_PREFERENCES);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.model.head).toBeNull();
    expect(result.model.rows).toHaveLength(1);
    expect(result.model.rows[0].hash).toBe(UNCOMMITTED);
    expect(result.model.rows[0].commit.parents).toEqual([]);
    expect(result.model.rows[0].current).toBe(true);
  });

  it('marks stash and stash-internal rows from the stash reflog', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one', 'first', BASE_DATE);
    writeFile(repo, 'a.txt', 'modified');
    git(repo, ['stash', 'push', '-q']);

    const stashHash = git(repo, ['rev-parse', 'refs/stash']).trim();
    const internalHash = git(repo, ['rev-parse', 'refs/stash^2']).trim();

    const result = await loadGraph(repo, DEFAULT_PREFERENCES);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    const { model } = result;
    const stashRow = model.rows.findIndex((row) => row.hash === stashHash);
    const internalRow = model.rows.findIndex((row) => row.hash === internalHash);

    expect(stashRow).toBeGreaterThanOrEqual(0);
    expect(internalRow).toBeGreaterThanOrEqual(0);
    expect(model.layout.points[stashRow].stash).toBe(true);
    expect(model.layout.points[internalRow].stashInternal).toBe(true);
  });
});
