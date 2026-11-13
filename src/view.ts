import { ItemView, type FileSystemAdapter, type WorkspaceLeaf } from 'obsidian';
import { createApp } from 'vue';
import type { App as VueApp } from 'vue';
import type { GraphSettings } from './settings';
import type { DiffRequest } from './ui/types';
import Root from './ui/Root.vue';

export const VIEW_TYPE_GIT_GRAPH = 'visible-git-graph-view';

export class GitGraphView extends ItemView {
  private vueApp: VueApp | null = null;
  private rootContainer: HTMLElement | null = null;
  private settings: GraphSettings;
  private readonly openDiff: (request: DiffRequest) => void;
  private readonly updateSettings: (patch: Partial<GraphSettings>) => void;

  constructor(
    leaf: WorkspaceLeaf,
    settings: GraphSettings,
    openDiff: (request: DiffRequest) => void,
    updateSettings: (patch: Partial<GraphSettings>) => void,
  ) {
    super(leaf);
    this.settings = { ...settings };
    this.openDiff = openDiff;
    this.updateSettings = updateSettings;
  }

  getViewType(): string {
    return VIEW_TYPE_GIT_GRAPH;
  }

  getDisplayText(): string {
    return 'Git Graph';
  }

  getIcon(): string {
    return 'git-branch';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('visible-git-graph-view');
    this.mount();
  }

  applySettings(next: GraphSettings): void {
    const changed =
      this.settings.gitPath !== next.gitPath ||
      this.settings.pageSize !== next.pageSize ||
      this.settings.refFilter !== next.refFilter ||
      this.settings.dateFormat !== next.dateFormat;
    if (!changed) return;

    this.settings = { ...next };
    if (this.rootContainer === null) return;
    this.teardown();
    this.mount();
  }

  async onClose(): Promise<void> {
    this.teardown();
  }

  private mount(): void {
    const container = this.contentEl.createDiv({ cls: 'visible-git-graph-root' });
    this.rootContainer = container;

    // The plugin is desktop-only (manifest `isDesktopOnly`), so the vault
    // adapter is always the filesystem one and exposes the repository base.
    const vaultBase = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
    this.vueApp = createApp(Root, {
      vaultBase,
      settings: this.settings,
      onOpenDiff: this.openDiff,
      onUpdateSettings: this.updateSettings,
    });
    this.vueApp.mount(container);
  }

  private teardown(): void {
    this.vueApp?.unmount();
    this.vueApp = null;
    this.rootContainer?.remove();
    this.rootContainer = null;
  }
}
