<script setup lang="ts">
/**
 * Commit pane: header, compact graph rows and the inline commit details.
 * Rows are absolutely positioned by the virtualiser; the graph itself is a
 * single SVG drawn from the dsh-vsc-git-graph layout engine.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CommitFile } from '../git/detail';
import { buildLayout } from '../graph/engine';
import type { GraphLayout } from '../graph/types';
import CommitDetails from './CommitDetails.vue';
import GraphCanvas from './GraphCanvas.vue';
import GraphHeader from './GraphHeader.vue';
import RefBadge from './RefBadge.vue';
import { formatDate, formatRelative } from './format';
import { rowIndexAt, rowTop as virtualRowTop } from './virtual';
import type {
  GraphPreferences,
  GraphRow,
  GraphViewModel,
} from './types';

const props = withDefaults(
  defineProps<{
    model: GraphViewModel;
    prefs: GraphPreferences;
    selectedHash?: string | null;
    details?: import('../git/detail').CommitDetails | null;
    detailsLoading?: boolean;
    detailsError?: string | null;
    dateFormat?: string;
    refFilter?: 'local' | 'all';
    filterText?: string;
    hasMore?: boolean;
    loadingMore?: boolean;
  }>(),
  {
    selectedHash: null,
    details: null,
    detailsLoading: false,
    detailsError: null,
    dateFormat: 'DD Mon YYYY HH:mm',
    refFilter: 'local',
    filterText: '',
    hasMore: false,
    loadingMore: false,
  },
);

const emit = defineEmits<{
  (event: 'select', hash: string): void;
  (event: 'deselect'): void;
  (event: 'open-file', file: CommitFile): void;
  (event: 'load-more'): void;
  (event: 'refresh'): void;
  (event: 'update:refFilter', value: 'local' | 'all'): void;
  (event: 'update:filterText', value: string): void;
}>();

const ROW_HEIGHT = 24;
const VIRTUAL_THRESHOLD = 1000;
const OVERSCAN = 20;
const LOAD_MORE_THRESHOLD = 25;
const CANVAS_BACKGROUND = 'var(--background-primary)';

const repoName = computed<string>(() => {
  const root = props.model.repoRoot.replace(/[\\/]+$/, '');
  return root.split(/[\\/]/).pop() ?? root;
});

const filtered = computed<boolean>(() => props.filterText.trim() !== '');

const rows = computed<GraphRow[]>(() => {
  const text = props.filterText.trim().toLowerCase();
  if (text === '') return props.model.rows;
  return props.model.rows.filter((row) => {
    if (
      row.description.toLowerCase().includes(text) ||
      row.author.toLowerCase().includes(text) ||
      row.hash.toLowerCase().includes(text)
    ) {
      return true;
    }
    return row.refs.some((ref) => ref.name.toLowerCase().includes(text));
  });
});

const expandedIndex = computed<number>(() =>
  props.selectedHash === null ? -1 : rows.value.findIndex((row) => row.hash === props.selectedHash),
);

/** Details-only layout: the engine shifts every row below the expanded one. */
const detailsHeight = ref(0);
const detailsEl = ref<HTMLElement | null>(null);
let detailsObserver: ResizeObserver | null = null;

const layout = computed<GraphLayout>(() => {
  if (filtered.value || expandedIndex.value < 0) return props.model.layout;
  return buildLayout(props.model.layoutCommits, {
    head: props.model.head,
    expandedRow: expandedIndex.value,
    firstParentOnly: props.prefs.firstParentOnly,
    muteMerges: props.prefs.muteMerges,
    muteNonAncestors: props.prefs.muteNonAncestors,
    style: props.prefs.style,
    uncommittedMark: props.prefs.uncommittedMark,
    maxWidth: props.prefs.maxWidth,
    grid: { expand: Math.max(0, detailsHeight.value) },
  });
});

const totalHeight = computed<number>(() => {
  if (filtered.value) {
    return rows.value.length * ROW_HEIGHT + (expandedIndex.value >= 0 ? detailsHeight.value : 0);
  }
  return layout.value.height;
});

const viewportRows = computed<Array<{ row: GraphRow; index: number }>>(() => {
  if (!virtual.value || filtered.value) {
    return rows.value.map((row, index) => ({ row, index }));
  }
  const start = startIndex.value;
  return rows.value.slice(start, endIndex.value).map((row, offset) => ({ row, index: start + offset }));
});

const virtual = computed<boolean>(() => rows.value.length > VIRTUAL_THRESHOLD);

const scrollEl = ref<HTMLElement | null>(null);
const startIndex = ref(0);
const endIndex = ref(60);
let frame = 0;
let bottomNotified = false;


function updateViewport(el: HTMLElement): void {
  if (virtual.value && !filtered.value) {
    const first = Math.max(0, rowIndexAt(el.scrollTop, ROW_HEIGHT, expandedIndex.value, detailsHeight.value, rows.value.length) - OVERSCAN);
    const last = Math.min(rows.value.length, rowIndexAt(el.scrollTop + el.clientHeight, ROW_HEIGHT, expandedIndex.value, detailsHeight.value, rows.value.length) + OVERSCAN + 1);
    startIndex.value = first;
    endIndex.value = Math.max(first, last);
  } else {
    startIndex.value = 0;
    endIndex.value = rows.value.length;
  }

  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (distance <= LOAD_MORE_THRESHOLD) {
    if (!bottomNotified && props.hasMore && !props.loadingMore) {
      bottomNotified = true;
      emit('load-more');
    }
  } else {
    bottomNotified = false;
  }
}

function onScroll(event: Event): void {
  const el = event.currentTarget as HTMLElement | null;
  if (el === null || frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    updateViewport(el);
  });
}

let listObserver: ResizeObserver | null = null;

function measureDetails(): void {
  detailsHeight.value = detailsEl.value?.getBoundingClientRect().height ?? 0;
  if (scrollEl.value) updateViewport(scrollEl.value);
}

function observeDetails(): void {
  detailsObserver?.disconnect();
  detailsObserver = null;
  if (typeof ResizeObserver === 'undefined') return;
  detailsObserver = new ResizeObserver(() => measureDetails());
  if (detailsEl.value) detailsObserver.observe(detailsEl.value);
}

watch(
  () => [props.selectedHash, props.details, props.detailsLoading],
  () => {
    if (props.selectedHash === null) {
      detailsHeight.value = 0;
      return;
    }
    void nextTick(() => {
      measureDetails();
      observeDetails();
    });
  },
);

watch(
  () => rows.value.length,
  () => {
    void nextTick(() => {
      if (scrollEl.value) updateViewport(scrollEl.value);
    });
  },
);

watch(
  () => props.filterText,
  () => {
    void nextTick(() => {
      if (scrollEl.value) {
        scrollEl.value.scrollTop = 0;
        updateViewport(scrollEl.value);
      }
    });
  },
);

onMounted(() => {
  if (scrollEl.value) updateViewport(scrollEl.value);
  if (scrollEl.value && typeof ResizeObserver !== 'undefined') {
    listObserver = new ResizeObserver(() => {
      if (scrollEl.value) updateViewport(scrollEl.value);
    });
    listObserver.observe(scrollEl.value);
  }
});

onBeforeUnmount(() => {
  detailsObserver?.disconnect();
  listObserver?.disconnect();
  detailsObserver = null;
  listObserver = null;
  if (frame !== 0) cancelAnimationFrame(frame);
});

function select(row: GraphRow): void {
  // Clicking the open row again collapses its inline details.
  if (props.selectedHash === row.hash) {
    emit('deselect');
    return;
  }
  emit('select', row.hash);
}

function openFile(file: CommitFile): void {
  emit('open-file', file);
}
</script>

<template>
  <div class="dsh-gg-view">
    <GraphHeader
      :repo-name="repoName"
      :branch="model.headBranch"
      :ref-filter="refFilter"
      :filter-text="filterText"
      :loading="loadingMore"
      @refresh="emit('refresh')"
      @update:ref-filter="emit('update:refFilter', $event)"
      @update:filter-text="emit('update:filterText', $event)"
    />

    <div ref="scrollEl" class="dsh-gg-list" @scroll="onScroll">
      <div class="dsh-gg-list-spacer" :style="{ height: `${totalHeight}px` }">
        <div
          v-for="entry in viewportRows"
          :key="entry.row.hash"
          class="dsh-gg-item"
          :style="{ top: `${virtualRowTop(entry.index, ROW_HEIGHT, expandedIndex, detailsHeight)}px` }"
        >
          <div
            class="dsh-gg-row"
            :class="{
              'dsh-gg-row-expanded': entry.row.hash === selectedHash,
              'dsh-gg-row-head': entry.row.hash === model.head,
            }"
            role="button"
            tabindex="0"
            :data-hash="entry.row.hash"
            :aria-expanded="entry.row.hash === selectedHash"
            @click="select(entry.row)"
            @keydown.enter.prevent="select(entry.row)"
            @keydown.space.prevent="select(entry.row)"
          >
            <div
              class="dsh-gg-lane-space"
              :style="{ width: `${filtered ? 0 : model.graphWidth}px` }"
            ></div>
            <span v-if="entry.row.refs.length > 0" class="dsh-gg-refs">
              <RefBadge v-for="badge in entry.row.refs" :key="badge.key" :badge="badge" />
            </span>
            <span class="dsh-gg-subject" :title="entry.row.description">{{ entry.row.description }}</span>
            <span class="dsh-gg-date" :title="formatDate(entry.row.date, dateFormat)">
              {{ formatRelative(entry.row.date) }}
            </span>
            <span class="dsh-gg-author" :title="entry.row.commit.email">{{ entry.row.author }}</span>
          </div>
        </div>

        <div
          v-if="expandedIndex >= 0"
          ref="detailsEl"
          class="dsh-gg-details-host"
          :style="{ top: `${(expandedIndex + 1) * ROW_HEIGHT}px` }"
        >
          <CommitDetails
            :row="rows[expandedIndex]"
            :details="details"
            :loading="detailsLoading"
            :error="detailsError"
            :date-format="dateFormat"
            @open-file="openFile"
          />
        </div>

        <GraphCanvas
          v-if="!filtered"
          :layout="layout"
          :width="layout.width"
          :height="layout.height"
          :background="CANVAS_BACKGROUND"
          :masked="layout.width < layout.contentWidth"
        />
      </div>
    </div>
  </div>
</template>
