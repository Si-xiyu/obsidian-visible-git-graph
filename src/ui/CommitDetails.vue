<script setup lang="ts">
/**
 * Selected-commit detail panel.
 *
 * The summary is rendered from `row.commit` immediately, before any git spawn
 * returns, so clicking a row never shows an empty panel. When `details` arrives
 * it replaces the summary fields and supplies the changed-file list. The file
 * list can be shown flat or grouped by directory; clicking a file asks the
 * parent to open the diff drawer.
 */
import { computed, ref } from 'vue';
import type { CommitDetails, CommitFile, FileStatusCode } from '../git/detail';
import { formatDate } from './format';
import type { GraphRow } from './types';

const props = withDefaults(
  defineProps<{
    row: GraphRow;
    details: CommitDetails | null;
    loading: boolean;
    error: string | null;
    dateFormat?: string;
  }>(),
  { dateFormat: 'DD Mon YYYY HH:mm' },
);

const emit = defineEmits<{
  (event: 'open-file', file: CommitFile): void;
}>();

/** Summary fields shared by `GitCommit` (table row) and `CommitMeta` (details). */
interface CommitSummary {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authorDate: number;
  committer: string;
  committerEmail: string;
  committerDate: number;
  message: string;
}

/** Details win once loaded; until then the row's log data is authoritative. */
const meta = computed<CommitSummary>(() => props.details?.meta ?? props.row.commit);

const files = computed<CommitFile[]>(() => props.details?.files ?? []);
const loaded = computed<boolean>(() => props.details !== null);

const totals = computed<{ additions: number; deletions: number }>(() => {
  let additions = 0;
  let deletions = 0;
  for (const file of files.value) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { additions, deletions };
});

type ViewMode = 'list' | 'tree';

const view = ref<ViewMode>('list');

interface TreeEntry {
  key: string;
  depth: number;
  dir: boolean;
  /** Full path in list mode, basename in tree mode. */
  name: string;
  file: CommitFile | null;
}

interface DirNode {
  dirs: Map<string, DirNode>;
  files: CommitFile[];
}

/** Group files by directory, parents before their contents. */
function buildTree(source: CommitFile[]): TreeEntry[] {
  const root: DirNode = { dirs: new Map(), files: [] };

  for (const file of source) {
    const parts = file.path.split('/');
    // The last segment is the file itself; the rest become directory nodes.
    parts.pop();
    let node = root;
    for (const part of parts) {
      let child = node.dirs.get(part);
      if (!child) {
        child = { dirs: new Map(), files: [] };
        node.dirs.set(part, child);
      }
      node = child;
    }
    node.files.push(file);
  }

  const entries: TreeEntry[] = [];

  const walk = (node: DirNode, depth: number, prefix: string): void => {
    for (const dirName of [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
      const child = node.dirs.get(dirName);
      if (!child) continue;
      const path = prefix === '' ? dirName : `${prefix}/${dirName}`;
      entries.push({ key: `dir:${path}`, depth, dir: true, name: dirName, file: null });
      walk(child, depth + 1, path);
    }
    const sorted = node.files.slice().sort((a, b) => a.path.localeCompare(b.path));
    for (const file of sorted) {
      entries.push({
        key: `file:${file.path}`,
        depth,
        dir: false,
        name: basename(file.path),
        file,
      });
    }
  };

  walk(root, 0, '');
  return entries;
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

const displayEntries = computed<TreeEntry[]>(() => {
  if (view.value === 'tree') return buildTree(files.value);
  return files.value.map((file) => ({
    key: `file:${file.path}`,
    depth: 0,
    dir: false,
    name: file.path,
    file,
  }));
});

const STATUS_CLASS: Record<FileStatusCode, string> = {
  A: 'a',
  M: 'm',
  D: 'd',
  R: 'r',
  C: 'c',
  T: 't',
  U: 'u',
  X: 'x',
  B: 'b',
};

function statusClass(status: FileStatusCode): string {
  return `dsh-git-graph-status-${STATUS_CLASS[status] ?? 'other'}`;
}

function indent(entry: TreeEntry): string {
  return `${12 + entry.depth * 14}px`;
}

function fileTitle(file: CommitFile): string {
  return file.originalPath ? `${file.originalPath} → ${file.path}` : file.path;
}

function openEntry(entry: TreeEntry): void {
  if (entry.file) emit('open-file', entry.file);
}
</script>

<template>
  <div class="dsh-git-graph-details" :data-hash="row.hash">
    <div class="dsh-git-graph-details-summary">
      <div class="dsh-git-graph-detail-message">{{ meta.message }}</div>

      <dl class="dsh-git-graph-detail-meta">
        <dt>作者</dt>
        <dd>
          {{ meta.author || '—' }}
          <span v-if="meta.email" class="dsh-git-graph-detail-email">&lt;{{ meta.email }}&gt;</span>
        </dd>

        <dt>提交者</dt>
        <dd>
          {{ meta.committer || '—' }}
          <span v-if="meta.committerEmail" class="dsh-git-graph-detail-email">
            &lt;{{ meta.committerEmail }}&gt;
          </span>
        </dd>

        <dt>日期</dt>
        <dd class="dsh-git-graph-detail-date">{{ formatDate(meta.authorDate, dateFormat) }}</dd>

        <dt>父提交</dt>
        <dd class="dsh-git-graph-detail-parents">
          <template v-if="meta.parents.length > 0">
            <span v-for="parent in meta.parents" :key="parent" :title="parent">
              {{ parent.slice(0, 8) }}
            </span>
          </template>
          <span v-else class="dsh-git-graph-detail-empty">无（根提交）</span>
        </dd>

        <dt>提交</dt>
        <dd class="dsh-git-graph-detail-hash" :title="row.hash">{{ row.hash }}</dd>
      </dl>
    </div>

    <div class="dsh-git-graph-files-panel">
      <div class="dsh-git-graph-files-head">
      <span class="dsh-git-graph-files-title">变更文件</span>
      <span v-if="loaded" class="dsh-git-graph-files-count">（{{ files.length }}）</span>
      <span v-if="loaded" class="dsh-git-graph-files-totals">
        <span class="dsh-git-graph-add">+{{ totals.additions }}</span>
        <span class="dsh-git-graph-del">-{{ totals.deletions }}</span>
      </span>

      <div class="dsh-git-graph-files-toggles" role="group" aria-label="文件列表视图">
        <button
          type="button"
          class="dsh-git-graph-files-toggle"
          :class="{ active: view === 'list' }"
          :aria-pressed="view === 'list'"
          @click="view = 'list'"
        >
          列表
        </button>
        <button
          type="button"
          class="dsh-git-graph-files-toggle"
          :class="{ active: view === 'tree' }"
          :aria-pressed="view === 'tree'"
          @click="view = 'tree'"
        >
          树
        </button>
      </div>
    </div>

    <div v-if="error" class="dsh-git-graph-files-state is-error" role="alert">{{ error }}</div>
    <div v-else-if="loading" class="dsh-git-graph-files-state" role="status" aria-live="polite">
      正在读取变更文件…
    </div>
    <div v-else-if="!loaded" class="dsh-git-graph-files-state">无文件变更</div>
    <div v-else-if="files.length === 0" class="dsh-git-graph-files-state">无文件变更</div>

    <div v-else class="dsh-git-graph-files">
      <template v-for="entry in displayEntries" :key="entry.key">
        <div
          v-if="entry.dir"
          class="dsh-git-graph-dir"
          :style="{ paddingLeft: indent(entry) }"
        >
          {{ entry.name }}/
        </div>
        <button
          v-else
          type="button"
          class="dsh-git-graph-file"
          :style="{ paddingLeft: indent(entry) }"
          :title="entry.file ? fileTitle(entry.file) : entry.name"
          @click="openEntry(entry)"
        >
          <span
            class="dsh-git-graph-file-status"
            :class="entry.file ? statusClass(entry.file.status) : ''"
          >
            {{ entry.file?.status }}
          </span>
          <span class="dsh-git-graph-file-path">{{ entry.name }}</span>
          <template v-if="entry.file">
            <span
              v-if="entry.file.binary"
              class="dsh-git-graph-file-stat dsh-git-graph-file-binary"
            >
              bin
            </span>
            <template v-else>
              <span class="dsh-git-graph-file-stat dsh-git-graph-add">
                +{{ entry.file.additions }}
              </span>
              <span class="dsh-git-graph-file-stat dsh-git-graph-del">
                -{{ entry.file.deletions }}
              </span>
            </template>
          </template>
        </button>
      </template>
    </div>
    </div>
  </div>
</template>
