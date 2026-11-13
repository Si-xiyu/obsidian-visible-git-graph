// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { WorkspaceLeaf } from 'obsidian';
import type { FileDiff } from '../../src/git/diff';
import type { DiffRequest } from '../../src/ui/types';

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl = Object.assign(document.createElement('div'), {
      addClass() {},
      createDiv(this: HTMLElement) { const el = document.createElement('div'); this.appendChild(el); return el; },
      empty(this: HTMLElement) { this.replaceChildren(); },
    });
    constructor(public leaf: unknown) {}
    async setState() {}
  },
}));
vi.mock('../../src/git/diff', () => ({ loadFileDiff: vi.fn() }));
import { loadFileDiff } from '../../src/git/diff';
import { GitDiffView } from '../../src/diffView';

const request = (path: string): DiffRequest => ({
  repoRoot: 'repo', hash: 'abc', gitPath: 'git',
  file: { path, status: 'M', additions: 1, deletions: 0, binary: false },
});
const patch = (text: string): FileDiff => ({
  path: 'file', binary: false, additions: 1, deletions: 0,
  hunks: [{ header: '@@ -0,0 +1 @@', oldStart: 0, oldCount: 0, newStart: 1, newCount: 1,
    lines: [{ kind: 'add', text, newLine: 1 }] }],
});
const views: GitDiffView[] = [];
function makeView() {
  const view = new GitDiffView({ getViewState: () => ({}) } as WorkspaceLeaf, request('first'));
  views.push(view);
  return view;
}
afterEach(async () => {
  await Promise.all(views.splice(0).map(view => view.onClose()));
  vi.clearAllMocks();
});

describe('diff view lifecycle', () => {
  it('loads once for onOpen followed by the same restored state', async () => {
    vi.mocked(loadFileDiff).mockResolvedValue(patch('content'));
    const view = makeView();
    await view.onOpen();
    await view.setState(request('first'), { history: false });
    expect(loadFileDiff).toHaveBeenCalledTimes(1);
  });

  it('cancels replaced loads and ignores results arriving out of order', async () => {
    const resolves: Array<(diff: FileDiff) => void> = [];
    vi.mocked(loadFileDiff).mockImplementation(() => new Promise(resolve => resolves.push(resolve)));
    const view = makeView();
    await view.onOpen();
    const oldSignal = vi.mocked(loadFileDiff).mock.calls[0][3]?.signal;
    await view.setState(request('second'), { history: false });
    expect(oldSignal?.aborted).toBe(true);
    resolves[1](patch('new content'));
    await nextTick(); await nextTick();
    resolves[0](patch('stale content'));
    await nextTick(); await nextTick();
    expect(view.contentEl.textContent).toContain('new content');
    expect(view.contentEl.textContent).not.toContain('stale content');
    expect(view.contentEl.textContent).toContain('second');
  });

  it('aborts on close and supports opening the view again', async () => {
    vi.mocked(loadFileDiff).mockImplementation(() => new Promise(() => {}));
    const view = makeView();
    await view.onOpen();
    const signal = vi.mocked(loadFileDiff).mock.calls[0][3]?.signal;
    await view.onClose();
    expect(signal?.aborted).toBe(true);
    expect(view.contentEl.childElementCount).toBe(0);
    await view.onOpen();
    expect(loadFileDiff).toHaveBeenCalledTimes(2);
  });
});
