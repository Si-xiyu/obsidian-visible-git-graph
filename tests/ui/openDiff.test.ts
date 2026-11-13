import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { DiffRequest } from '../../src/ui/types';

vi.mock('obsidian', () => ({ Plugin: class {}, Notice: vi.fn() }));
vi.mock('../../src/diffView', () => ({ DIFF_VIEW_TYPE: 'diff', GitDiffView: class {} }));
vi.mock('../../src/view', () => ({ VIEW_TYPE_GIT_GRAPH: 'graph', GitGraphView: class {} }));
vi.mock('../../src/settingsTab', () => ({ GitGraphSettingTab: class {} }));
import Plugin from '../../src/main';
import { Notice } from 'obsidian';

const request: DiffRequest = {
  repoRoot: 'repo', hash: 'abc', gitPath: 'git',
  file: { path: 'file', status: 'M', additions: 1, deletions: 0, binary: false },
};

describe('opening diff tabs', () => {
  it('coalesces repeated clicks while a tab is still opening', async () => {
    let finish!: () => void;
    const leaf = { setViewState: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) };
    const workspace = { getLeavesOfType: () => [], getLeaf: vi.fn(() => leaf), revealLeaf: vi.fn() };
    const plugin = new Plugin({} as App, {} as never);
    plugin.app = { workspace } as unknown as App;
    const first = plugin.openDiff(request);
    const second = plugin.openDiff(request);
    expect(workspace.getLeaf).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    expect(workspace.revealLeaf).toHaveBeenCalledTimes(1);
  });

  it('reports opening errors and lets a later click try again', async () => {
    const workspace = {
      getLeavesOfType: () => [],
      getLeaf: vi.fn(() => ({ setViewState: vi.fn().mockRejectedValue(new Error('open failed')) })),
    };
    const plugin = new Plugin({} as App, {} as never);
    plugin.app = { workspace } as unknown as App;
    await plugin.openDiff(request);
    expect(Notice).toHaveBeenCalledWith('open failed');
    await plugin.openDiff(request);
    expect(workspace.getLeaf).toHaveBeenCalledTimes(2);
  });
});
