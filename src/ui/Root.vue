<script setup lang="ts">
/**
 * Root of the graph pane.
 *
 * Phase 4 wiring: selecting a row renders its summary immediately from the
 * already-loaded log data, then asynchronously fills in commit details. Opening
 * a file opens its diff in a separate editor tab. Details are cached
 * (`DetailCache` / a per-file Map) and guarded by request sequence numbers so a
 * fast sequence of clicks can never show an older result.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import type { CommitDetails, CommitFile } from '../git/detail';
import { loadCommitDetails } from '../git/detail';
import type { GitCommit } from '../git/repo';
import { GitError } from '../git/run';
import { UNCOMMITTED } from '../graph/engine';
import { DetailCache } from '../graph/detailCache';
import { loadGraph } from '../graph/load';
import { watchRepo, type RepoWatcher } from '../graph/watch';
import { DEFAULT_SETTINGS, type GraphSettings } from '../settings';
import GraphTable from './GraphTable.vue';
import { DEFAULT_PREFERENCES, type DiffRequest, type GraphPreferences, type GraphRow, type GraphViewModel } from './types';

const props = withDefaults(
  defineProps<{
    vaultBase?: string;
    gitPath?: string;
    settings?: GraphSettings;
    onOpenDiff?: (request: DiffRequest) => void;
    onUpdateSettings?: (patch: Partial<GraphSettings>) => void;
  }>(),
  {
    vaultBase: '',
    gitPath: 'git',
    settings: () => DEFAULT_SETTINGS,
  },
);

const state = ref<'loading' | 'none' | 'error' | 'ready'>('loading');
const model = shallowRef<GraphViewModel | null>(null);
const selectedHash = ref<string | null>(null);
const errorCode = ref<string | null>(null);
const errorDetail = ref('');
const loadingMore = ref(false);
const filterText = ref('');

// Graph layout options are not user-editable yet; Phase 5 settings only cover
// the git executable, page size, ref filter and date format.
const prefs: GraphPreferences = DEFAULT_PREFERENCES;

const loading = computed(() => state.value === 'loading');
const showTable = computed(() => state.value === 'ready' && model.value !== null);

// ── Commit details ────────────────────────────────────────────────

const detailsCache = new DetailCache();
const selectedRow = shallowRef<GraphRow | null>(null);
const details = shallowRef<CommitDetails | null>(null);
const detailsLoading = ref(false);
const detailsError = ref<string | null>(null);

/** Sequence for the currently displayed detail request. */
/** Hash of the in-flight detail request, if any. */
/** Hash whose detail request is currently running (at most one). */
let detailsInFlightHash: string | null = null;
/** Latest row clicked while another detail request was running. */
let detailsQueued: { row: GraphRow; repoRoot: string } | null = null;


/** Show git's stderr verbatim when there is one, otherwise the message. */
function errorText(error: unknown): string {
  if (error instanceof GitError) {
    return error.stderr.trim() === '' ? error.message : error.stderr;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Drop the detail cache and every selection state. */
function resetDetailState(): void {

  detailsCache.clear();

  selectedHash.value = null;
  selectedRow.value = null;
  details.value = null;
  detailsLoading.value = false;
  detailsError.value = null;

}

/**
 * Drop the selection and every panel it owns, but keep the detail cache:
 * merging another page keeps the repository and all shown commits unchanged.
 */
function dropSelection(): void {

  selectedHash.value = null;
  selectedRow.value = null;
  details.value = null;
  detailsLoading.value = false;
  detailsError.value = null;
  detailsQueued = null;

}

// ── Repository watcher ────────────────────────────────────────────

/** Set on unmount so an in-flight load cannot start a new watcher. */
let disposed = false;
/** Monotonic reload token; stale responses must not paint or start watchers. */
let reloadSeq = 0;
let repoWatcher: RepoWatcher | null = null;
let watcherRoot: string | null = null;
/** Prevent overlapping reloads; a change during a reload is queued once. */
let reloadInFlight = false;
let reloadAgain = false;

function closeWatcher(): void {
  repoWatcher?.close();
  repoWatcher = null;
  watcherRoot = null;
}

/** (Re)arm the watcher for the repository the current model came from. */
function startWatcher(repoRoot: string): void {
  // Same repository: keep the existing watcher, so a reload creates no gap in
  // which a filesystem event could be missed.
  if (watcherRoot === repoRoot && repoWatcher !== null) return;
  closeWatcher();
  if (disposed || repoRoot === '') return;
  try {
    // watchRepo debounces bursts (300ms); Root only supplies the reload.
    repoWatcher = watchRepo(repoRoot, () => {
      void reload();
    });
    watcherRoot = repoRoot;
  } catch {
    // Watching is best-effort: a missing/unwatchable .git must not break the pane.
    repoWatcher = null;
  }
}

/**
 * Load the first page again. Also used by the retry button and by repository
 * changes. Closing the watcher first prevents overlapping watchers; the fresh
 * model re-arms one afterwards.
 */
async function reload(): Promise<void> {
  if (reloadInFlight) {
    // A filesystem change arrived while git reads were in flight. Remember it
    // and run one more reload after this one, instead of dropping the event.
    reloadAgain = true;
    return;
  }
  reloadInFlight = true;
  const seq = ++reloadSeq;
  loadingMore.value = false;
  resetDetailState();

  // The scaffold test mounts Root without props. An empty vault base cannot be
  // a repository, so keep the loading row instead of spawning git in cwd.
  if (props.vaultBase === '') {
    state.value = 'loading';
    model.value = null;
    reloadInFlight = false;
    return;
  }

  state.value = 'loading';
  model.value = null;

  try {
    const result = await loadGraph(props.vaultBase, prefs, {
      gitPath: props.settings.gitPath,
      pageSize: props.settings.pageSize,
      refFilter: props.settings.refFilter,
    });
    if (seq !== reloadSeq || disposed) return;
    if (result.kind === 'none') {
      state.value = 'none';
      closeWatcher();
      return;
    }
    model.value = result.model;
    state.value = 'ready';
    startWatcher(result.model.repoRoot);
  } catch (error) {
    if (seq !== reloadSeq || disposed) return;
    if (error instanceof GitError) {
      errorCode.value = error.code;
      // stderr is git's verbatim diagnostic; for spawn failures it can be
      // empty, in which case the normalised message is the useful text.
      errorDetail.value = error.stderr.trim() === '' ? error.message : error.stderr;
    } else {
      errorCode.value = null;
      errorDetail.value = error instanceof Error ? error.message : String(error);
    }
    state.value = 'error';
  } finally {
    reloadInFlight = false;
    if (reloadAgain && !disposed) {
      reloadAgain = false;
      void reload();
    }
  }
}

/**
 * Append the next page. `skip` is the number of already-visible real commits;
 * those commits are handed back to `loadGraph` so it can rebuild one merged,
 * deduplicated layout instead of replacing the list with just the new page.
 */
async function loadMore(): Promise<void> {
  const current = model.value;
  if (current === null || !current.moreAvailable || loadingMore.value) return;
  if (props.vaultBase === '') return;

  const existingCommits: GitCommit[] = current.rows
    .filter((row) => row.hash !== UNCOMMITTED)
    .map((row) => row.commit);

  loadingMore.value = true;
  try {
    const result = await loadGraph(props.vaultBase, prefs, {
      gitPath: props.settings.gitPath,
      pageSize: props.settings.pageSize,
      skip: existingCommits.length,
      existingCommits,
      refFilter: props.settings.refFilter,
    });
    // A reload may have replaced the model (or the pane may be gone) while the
    // page was loading; in that case this page is stale.
    if (disposed || model.value !== current) return;
    if (result.kind !== 'ready') return;

    // A new commit/rewritten branch changes the skip offset; the page we just
    // loaded may have skipped a commit at the boundary. Restart from page one.
    if (result.model.head !== current.head) {
      void reload();
      return;
    }

    model.value = result.model;

    // Keep the open details panel when its commit is still in the merged list.
    if (selectedHash.value !== null) {
      const next = result.model.rows.find((row) => row.hash === selectedHash.value);
      if (next) {
        selectedRow.value = next;
      } else {
        dropSelection();
      }
    }
  } catch (error) {
    if (disposed || model.value !== current) return;
    errorCode.value = error instanceof GitError ? error.code : null;
    errorDetail.value = errorText(error);
    state.value = 'error';
  } finally {
    loadingMore.value = false;
  }
}

async function runDetails(row: GraphRow, repoRoot: string): Promise<void> {
  detailsInFlightHash = row.hash;
  details.value = null;
  detailsError.value = null;
  detailsLoading.value = true;

  try {
    const loaded = await loadCommitDetails(repoRoot, row.hash, {
      gitPath: props.settings.gitPath,
    });
    // A result is still useful if the user has moved on: cache it for the same
    // repository, but only paint it when this request is still the current one.
    if (repoRoot === model.value?.repoRoot) detailsCache.set(row.hash, loaded);
    if (selectedHash.value === row.hash) details.value = loaded;
  } catch (error) {
    if (selectedHash.value === row.hash) detailsError.value = errorText(error);
  } finally {
    if (detailsInFlightHash === row.hash) detailsInFlightHash = null;
    if (selectedHash.value === row.hash) {
      detailsLoading.value = false;
        }

    const queued = detailsQueued;
    detailsQueued = null;
    if (queued && selectedHash.value === queued.row.hash) {
      void runDetails(queued.row, queued.repoRoot);
    }
  }
}

/**
 * Row click. The summary appears synchronously from `row.commit`; only a cache
 * miss spawns git. At most one detail request runs at a time, and rapid clicks
 * collapse into "load the latest row" once the current request finishes.
 */
function onSelect(hash: string): void {
  const row = model.value?.rows.find((entry) => entry.hash === hash) ?? null;
  selectedHash.value = hash;
  selectedRow.value = row;

  if (row === null) {
        detailsQueued = null;
    details.value = null;
    detailsLoading.value = false;
    detailsError.value = null;
    return;
  }

  // The uncommitted pseudo-row has no commit object in git; show its summary
  // from the working-tree row and do not spawn a doomed `git show`.
  if (row.hash === UNCOMMITTED) {
        detailsQueued = null;
    details.value = null;
    detailsLoading.value = false;
    detailsError.value = null;
    return;
  }

  if (detailsInFlightHash === hash) {
    // The user came back to a commit whose request is still running. Restore
    // the loading state instead of leaving the previous row's details on screen.
    detailsQueued = null;
    details.value = null;
    detailsError.value = null;
    detailsLoading.value = true;
    return;
  }

  const cached = detailsCache.get(hash);
  if (cached) {
        detailsQueued = null;
    details.value = cached;
    detailsLoading.value = false;
    detailsError.value = null;
    return;
  }

  const repoRoot = model.value?.repoRoot;
  details.value = null;
  detailsError.value = null;

  if (!repoRoot) {
    detailsLoading.value = false;
    detailsError.value = '无法定位仓库根目录';
    return;
  }

  if (detailsInFlightHash !== null) {
    detailsQueued = { row, repoRoot };
    detailsLoading.value = true;
    return;
  }

  void runDetails(row, repoRoot);
}

/** Clicking the expanded row again collapses the inline details. */
function onDeselect(): void {
  selectedHash.value = null;
  selectedRow.value = null;
  details.value = null;
  detailsLoading.value = false;
  detailsError.value = null;
  detailsQueued = null;
}

function onOpenFile(file: CommitFile): void {
  const row = selectedRow.value;
  const repoRoot = model.value?.repoRoot;
  if (!row || !repoRoot || !props.onOpenDiff) return;

  // The diff is a separate editor tab (like VS Code Git Graph), not a drawer
  // inside the graph pane. The tab owns loading, errors and virtual scrolling.
  props.onOpenDiff({
    repoRoot,
    hash: row.hash,
    file,
    gitPath: props.settings.gitPath,
  });
}

/** Header's Local/All dropdown writes through to the persisted setting. */
function onRefFilter(value: 'local' | 'all'): void {
  props.onUpdateSettings?.({ refFilter: value });
}

// A repository switch invalidates every cached commit/diff under the old root.
watch(
  () => model.value?.repoRoot,
  () => {
    resetDetailState();
  },
);

// The pane can be re-pointed at another vault/git executable while mounted.
// Deep watching `settings` catches an in-place mutation as well as a replaced
// settings object. A change drops the page offset because `reload` starts over.
watch(
  () => [props.vaultBase, props.gitPath, props.settings],
  () => {
    void reload();
  },
  { deep: true },
);

onMounted(() => {
  void reload();
});

onBeforeUnmount(() => {
  // Closing the pane stops all fs.watch listeners and makes any in-flight
  // response inert, so nothing keeps running after the view is gone.
  disposed = true;
  reloadSeq++;
  closeWatcher();
});
</script>

<template>
  <div class="dsh-git-graph-root-inner">
    <div v-if="loading" class="dsh-git-graph-loading" role="status" aria-live="polite">loading…</div>

    <div v-else-if="state === 'none'" class="dsh-git-graph-none">当前 vault 不是 git 仓库</div>

    <div v-else-if="state === 'error'" class="dsh-git-graph-error" role="alert">
      <div v-if="errorCode" class="dsh-git-graph-error-code">[{{ errorCode }}]</div>
      <pre class="dsh-git-graph-error-stderr">{{ errorDetail }}</pre>
      <button type="button" class="dsh-git-graph-retry" @click="reload">重试</button>
    </div>

    <div v-else-if="showTable && model" class="dsh-git-graph-ready">
      <GraphTable
        :model="model"
        :prefs="prefs"
        :selected-hash="selectedHash"
        :details="details"
        :details-loading="detailsLoading"
        :details-error="detailsError"
        :date-format="settings.dateFormat"
        :ref-filter="settings.refFilter"
        :filter-text="filterText"
        :has-more="model.moreAvailable"
        :loading-more="loadingMore"
        @select="onSelect"
        @deselect="onDeselect"
        @open-file="onOpenFile"
        @load-more="loadMore"
        @refresh="reload"
        @update:ref-filter="onRefFilter"
        @update:filter-text="filterText = $event"
      />
    </div>
  </div>
</template>
