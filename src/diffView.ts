import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { createApp, h, ref, shallowRef } from 'vue';
import type { App as VueApp } from 'vue';
import { loadFileDiff, type FileDiff } from './git/diff';
import { GitError } from './git/run';
import DiffDrawer from './ui/DiffDrawer.vue';
import type { DiffRequest } from './ui/types';

export const DIFF_VIEW_TYPE = 'dsh-git-diff-view';

/** Validate a restored view state enough to avoid opening a half-empty tab. */
function isDiffRequest(value: unknown): value is DiffRequest {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<DiffRequest>;
  return (
    typeof candidate.repoRoot === 'string' &&
    typeof candidate.hash === 'string' &&
    typeof candidate.gitPath === 'string' &&
    candidate.file !== undefined &&
    candidate.file !== null &&
    typeof candidate.file === 'object' &&
    typeof candidate.file.path === 'string'
  );
}

/** Full-tab viewer for one file's patch, opened from the commit details list. */
export class GitDiffView extends ItemView {
  private request: DiffRequest | null;
  private vueApp: VueApp | null = null;
  private disposed = false;
  private loadController: AbortController | null = null;
  private loadedKey: string | null = null;
  private readonly requestRef = shallowRef<DiffRequest | null>(null);

  constructor(leaf: WorkspaceLeaf, request?: DiffRequest | null) {
    super(leaf);
    // The plugin passes the request directly when it creates the tab; the view
    // state is the fallback when Obsidian restores the tab after a reload.
    const state = leaf.getViewState().state;
    this.request = request ?? (isDiffRequest(state) ? state : null);
  }

  getViewType(): string {
    return DIFF_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.request?.file.path ?? 'Git Diff';
  }

  getIcon(): string {
    return 'file-diff';
  }

  /** Persist the request so a restored tab can reload the same patch. */
  getState(): Record<string, unknown> {
    return this.request === null ? {} : { ...this.request };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (isDiffRequest(state)) {
      this.request = state;
      this.requestRef.value = state;
      if (this.vueApp !== null && !this.disposed) void this.loadDiff();
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.disposed = false;
    this.requestRef.value = this.request;
    this.contentEl.addClass('dsh-git-graph-diff-view');
    const container = this.contentEl.createDiv({ cls: 'dsh-git-graph-diff-view-inner' });

    const diff = shallowRef<FileDiff | null>(null);
    const loading = ref(true);
    const error = ref<string | null>(null);

    this.vueApp = createApp({
      render: () =>
        h(DiffDrawer, {
          open: true,
          mode: 'tab',
          file: this.requestRef.value?.file ?? null,
          diff: diff.value,
          loading: loading.value,
          error: error.value,
          onClose: () => this.leaf.detach(),
        }),
    });
    this.vueApp.mount(container);

    this.diffRef = diff;
    this.loadingRef = loading;
    this.errorRef = error;
    void this.loadDiff();
  }

  private diffRef: { value: FileDiff | null } | null = null;
  private loadingRef: { value: boolean } | null = null;
  private errorRef: { value: string | null } | null = null;

  private async loadDiff(): Promise<void> {
    const diff = this.diffRef;
    const loading = this.loadingRef;
    const error = this.errorRef;
    if (diff === null || loading === null || error === null) return;

    if (this.request === null) {
      loading.value = false;
      error.value = '无法加载差异：缺少提交或文件信息';
      return;
    }

    const request = this.request;
    const key = JSON.stringify([request.repoRoot, request.hash, request.gitPath, request.file.path, request.file.originalPath]);
    if (this.loadedKey === key) return;
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    this.loadedKey = key;
    const current = (): boolean => !this.disposed && this.loadController === controller;

    loading.value = true;
    error.value = null;
    diff.value = null;
    try {
      const loaded = await loadFileDiff(request.repoRoot, request.hash, request.file, {
        gitPath: request.gitPath,
        signal: controller.signal,
      });
      if (current()) diff.value = loaded;
    } catch (caught) {
      if (current()) {
        error.value =
          caught instanceof GitError
            ? caught.stderr.trim() === ''
              ? caught.message
              : caught.stderr
            : caught instanceof Error
              ? caught.message
              : String(caught);
      }
    } finally {
      if (current()) loading.value = false;
    }
  }

  async onClose(): Promise<void> {
    this.disposed = true;
    this.loadController?.abort();
    this.loadController = null;
    this.loadedKey = null;
    if (this.diffRef) this.diffRef.value = null;
    this.vueApp?.unmount();
    this.vueApp = null;
    this.diffRef = null;
    this.loadingRef = null;
    this.errorRef = null;
    this.contentEl.empty();
  }
}
