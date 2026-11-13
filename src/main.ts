import { Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import { DIFF_VIEW_TYPE, GitDiffView } from './diffView';
import { DEFAULT_SETTINGS, normalizeSettings, type GraphSettings } from './settings';
import { GitGraphSettingTab } from './settingsTab';
import type { DiffRequest } from './ui/types';
import { GitGraphView, VIEW_TYPE_GIT_GRAPH } from './view';

export default class DshGitGraphPlugin extends Plugin {
  /** Validated settings, kept in sync with the persisted data file. */
  settings: GraphSettings = { ...DEFAULT_SETTINGS };

  /** Request handed to the diff view while its leaf is being created. */
  private readonly diffRequests = new WeakMap<WorkspaceLeaf, DiffRequest>();

  async onload(): Promise<void> {
    // Persisted data is untrusted JSON; normalise once so every consumer sees
    // a complete object with in-range values.
    this.settings = normalizeSettings(await this.loadData());

    this.registerView(
      VIEW_TYPE_GIT_GRAPH,
      (leaf) =>
        new GitGraphView(
          leaf,
          this.settings,
          (request) => {
            void this.openDiff(request);
          },
          (patch) => {
            void this.saveSettings(patch);
          },
        ),
    );
    this.registerView(
      DIFF_VIEW_TYPE,
      (leaf) => new GitDiffView(leaf, this.diffRequests.get(leaf) ?? null),
    );

    this.addRibbonIcon('git-branch', 'Open Git Graph', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open',
      name: 'Open Git Graph',
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new GitGraphSettingTab(this.app, this));
  }

  // No onunload: detaching leaves there would reset the pane to its default
  // position when the plugin is re-enabled. Obsidian closes the views itself.

  /** Merge a patch into the current settings, persist it and refresh views. */
  async saveSettings(patch: Partial<GraphSettings>): Promise<void> {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    await this.saveData(this.settings);
    await this.refreshViews();
  }

  /**
   * Push the new settings into every open graph pane. The leaf stays where it
   * is (split, order, count); only the mounted Vue app is recreated.
   */
  async refreshViews(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GIT_GRAPH);
    for (const leaf of leaves) {
      if (leaf.view instanceof GitGraphView) {
        leaf.view.applySettings(this.settings);
      }
    }
  }

  /** Open one file's diff in a new editor tab, reusing an identical tab. */
  private readonly openingDiffs = new Map<string, Promise<void>>();

  async openDiff(request: DiffRequest): Promise<void> {
    const key = JSON.stringify([request.repoRoot, request.hash, request.file.path]);
    const pending = this.openingDiffs.get(key);
    if (pending) return pending;
    const opening = this.openDiffTab(request).catch((error: unknown) => {
      new Notice(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      this.openingDiffs.delete(key);
    });
    this.openingDiffs.set(key, opening);
    return opening;
  }

  private async openDiffTab(request: DiffRequest): Promise<void> {
    const { workspace } = this.app;

    // Re-clicking the same file used to create a second tab and churn the
    // layout; reveal the existing diff instead.
    const existing = workspace.getLeavesOfType(DIFF_VIEW_TYPE).find((leaf) => {
      const state = leaf.view.getState?.();
      return (
        state !== undefined &&
        state !== null &&
        state['repoRoot'] === request.repoRoot &&
        state['hash'] === request.hash &&
        (state['file'] as { path?: string } | undefined)?.path === request.file.path
      );
    });
    if (existing !== undefined) {
      await workspace.revealLeaf(existing);
      return;
    }

    const leaf = workspace.getLeaf(true);
    this.diffRequests.set(leaf, request);
    await leaf.setViewState({
      type: DIFF_VIEW_TYPE,
      active: true,
      state: request as unknown as Record<string, unknown>,
    });
    await workspace.revealLeaf(leaf);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_GIT_GRAPH);
    let leaf: WorkspaceLeaf | null = existing[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_GIT_GRAPH, active: true });
    }

    if (leaf) {
      await workspace.revealLeaf(leaf);
    }
  }
}
