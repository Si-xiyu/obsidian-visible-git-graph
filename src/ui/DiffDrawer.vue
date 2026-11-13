<script setup lang="ts">
/**
 * Bottom diff drawer.
 *
 * The diff is already parsed by `src/git/diff.ts`; this component only flattens
 * hunks to fixed-height rows and virtualises them. Long diffs stay cheap
 * because only the visible window (±20 rows) is in the DOM; the rest of the
 * scroll height is two spacers. Dragging the header or the top edge resizes the
 * drawer between 200px and 70vh.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { DiffLineKind, FileDiff } from '../git/diff';
import type { CommitFile } from '../git/detail';

const props = withDefaults(
  defineProps<{
    open: boolean;
    file: CommitFile | null;
    diff: FileDiff | null;
    loading: boolean;
    error: string | null;
    /** Drawer is the default; `tab` renders the same viewer full-height in an Obsidian leaf. */
    mode?: 'drawer' | 'tab';
  }>(),
  { mode: 'drawer' },
);

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const isDrawer = computed<boolean>(() => props.mode === 'drawer');

/** Fixed row height in px; shared by rendering and the virtual window math. */
const ROW_HEIGHT = 20;
/** Rows rendered above and below the viewport. */
const OVERSCAN = 20;
const MIN_HEIGHT = 200;
const MAX_HEIGHT_RATIO = 0.7;
const DEFAULT_HEIGHT_RATIO = 0.4;

interface RenderRow {
  key: string;
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

/**
 * Flatten hunks into one fixed-height row stream.
 *
 * `diff.ts` exposes the hunk header twice: as `hunk.header` and as the first
 * `kind: 'hunk'` entry of `hunk.lines`. Render it from `header` only, so the
 * duplicated entry is skipped. Line text has its +/-/space marker stripped by
 * the parser; `textPrefix` puts the marker back at render time.
 */
const rows = computed<RenderRow[]>(() => {
  const diff = props.diff;
  if (!diff) return [];
  const flattened: RenderRow[] = [];
  for (let h = 0; h < diff.hunks.length; h++) {
    const hunk = diff.hunks[h];
    flattened.push({ key: `hunk:${h}`, kind: 'hunk', text: hunk.header });
    for (let l = 0; l < hunk.lines.length; l++) {
      const line = hunk.lines[l];
      if (line.kind === 'hunk') continue;
      flattened.push({
        key: `line:${h}:${l}`,
        kind: line.kind,
        text: line.text,
        oldLine: line.oldLine,
        newLine: line.newLine,
      });
    }
  }
  return flattened;
});

const bodyEl = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);

const startIndex = computed<number>(() =>
  Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN),
);

const endIndex = computed<number>(() => {
  const height = Math.max(viewportHeight.value, ROW_HEIGHT);
  return Math.min(
    rows.value.length,
    Math.ceil((scrollTop.value + height) / ROW_HEIGHT) + OVERSCAN,
  );
});

const visibleRows = computed<RenderRow[]>(() => rows.value.slice(startIndex.value, endIndex.value));

const topSpacer = computed<number>(() => startIndex.value * ROW_HEIGHT);
const bottomSpacer = computed<number>(
  () => Math.max(0, (rows.value.length - endIndex.value) * ROW_HEIGHT),
);

const totalHeight = computed<number>(() => rows.value.length * ROW_HEIGHT);

/** A pure rename or mode change has no hunks, so the viewer must explain that. */
const noTextDiff = computed<boolean>(
  () => props.diff !== null && !props.diff.binary && props.diff.hunks.length === 0,
);

/** Drawer height in px; `0` means "not measured yet" and falls back to 40vh. */
const height = ref(0);
const dragging = ref(false);

function viewportLimit(): number {
  const windowHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  return Math.max(MIN_HEIGHT, windowHeight * MAX_HEIGHT_RATIO);
}

function clampHeight(value: number): number {
  return Math.min(viewportLimit(), Math.max(MIN_HEIGHT, value));
}

/** Initial drawer height: 40% of the window, then clamped to 200px-70vh. */
function defaultHeight(): number {
  const windowHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  return clampHeight(windowHeight * DEFAULT_HEIGHT_RATIO);
}

const drawerStyle = computed<Record<string, string> | undefined>(() =>
  isDrawer.value
    ? { height: height.value > 0 ? `${height.value}px` : `${DEFAULT_HEIGHT_RATIO * 100}vh` }
    : undefined,
);

function resetScroll(): void {
  scrollTop.value = 0;
  if (bodyEl.value) bodyEl.value.scrollTop = 0;
}

function measure(): void {
  const el = bodyEl.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  viewportHeight.value = el.clientHeight;
}

function onScroll(event: Event): void {
  const el = event.target as HTMLElement | null;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  viewportHeight.value = el.clientHeight;
}

let observer: ResizeObserver | null = null;

function observeBody(): void {
  observer?.disconnect();
  observer = null;
  if (typeof ResizeObserver === 'undefined' || bodyEl.value === null) return;
  observer = new ResizeObserver(() => measure());
  observer.observe(bodyEl.value);
}

let dragStartY = 0;
let dragStartHeight = 0;

function onResizeStart(event: PointerEvent): void {
  if (!isDrawer.value || event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  // The close button lives in the draggable header; never start a drag from it.
  if (target?.closest('button')) return;
  event.preventDefault();
  dragging.value = true;
  dragStartY = event.clientY;
  dragStartHeight = height.value > 0 ? height.value : defaultHeight();
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', onResizeEnd);
  window.addEventListener('pointercancel', onResizeEnd);
}

function onResizeMove(event: PointerEvent): void {
  if (!dragging.value) return;
  // Dragging up (smaller clientY) grows the drawer.
  height.value = clampHeight(dragStartHeight + (dragStartY - event.clientY));
  measure();
}

function onResizeEnd(): void {
  if (!dragging.value) return;
  dragging.value = false;
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', onResizeEnd);
  window.removeEventListener('pointercancel', onResizeEnd);
  measure();
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      observer?.disconnect();
      observer = null;
      resetScroll();
      return;
    }
    if (height.value <= 0) {
      height.value = defaultHeight();
    }
    void nextTick(() => {
      resetScroll();
      measure();
      observeBody();
    });
  },
  { immediate: true },
);

// Switching files (or closing) must not keep the previous diff's scroll offset.
watch(
  () => props.file?.path,
  () => {
    if (!props.open) return;
    resetScroll();
    void nextTick(measure);
  },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', onResizeEnd);
  window.removeEventListener('pointercancel', onResizeEnd);
});

function lineClass(row: RenderRow): Record<string, boolean> {
  return {
    'dsh-git-graph-diff-line-add': row.kind === 'add',
    'dsh-git-graph-diff-line-del': row.kind === 'del',
    'dsh-git-graph-diff-line-meta': row.kind === 'meta',
  };
}

function oldLine(row: RenderRow): string {
  return row.oldLine === undefined ? '' : String(row.oldLine);
}

function newLine(row: RenderRow): string {
  return row.newLine === undefined ? '' : String(row.newLine);
}

/** The parser strips the marker; put it back for display. */
function textPrefix(row: RenderRow): string {
  if (row.kind === 'add') return '+';
  if (row.kind === 'del') return '-';
  if (row.kind === 'context') return ' ';
  return '';
}
</script>

<template>
  <div
    v-if="open"
    class="dsh-git-graph-diff-drawer"
    :class="{
      'dsh-git-graph-diff-resizing': dragging,
      'dsh-git-graph-diff-tab': !isDrawer,
    }"
    :style="isDrawer ? drawerStyle : undefined"
  >
    <div v-if="isDrawer" class="dsh-git-graph-diff-resize" @pointerdown="onResizeStart"></div>

    <div
      class="dsh-git-graph-diff-head"
      :class="{ 'dsh-git-graph-diff-head-tab': !isDrawer }"
      @pointerdown="isDrawer ? onResizeStart($event) : undefined"
    >
      <span class="dsh-git-graph-diff-title" :title="file?.path ?? ''">
        {{ file?.path ?? '' }}
      </span>
      <span v-if="file" class="dsh-git-graph-diff-stats">
        <span class="dsh-git-graph-add">+{{ file.additions }}</span>
        <span class="dsh-git-graph-del">-{{ file.deletions }}</span>
      </span>
      <button
        v-if="isDrawer"
        type="button"
        class="dsh-git-graph-diff-close"
        aria-label="关闭差异"
        title="关闭差异"
        @click="emit('close')"
      >
        ×
      </button>
    </div>

    <div ref="bodyEl" class="dsh-git-graph-diff-body" @scroll="onScroll">
      <div v-if="loading" class="dsh-git-graph-diff-state" role="status" aria-live="polite">
        正在读取差异…
      </div>
      <div v-else-if="error" class="dsh-git-graph-diff-state is-error" role="alert">
        {{ error }}
      </div>
      <div v-else-if="diff?.binary" class="dsh-git-graph-diff-state">
        二进制文件，暂不支持预览
      </div>
      <div v-else-if="noTextDiff" class="dsh-git-graph-diff-state">
        无文本差异（可能是纯重命名、模式或权限变更）
      </div>
      <div
        v-else-if="diff"
        class="dsh-git-graph-diff-viewport"
        :style="{ height: `${totalHeight}px` }"
      >
        <div :style="{ height: `${topSpacer}px` }"></div>

        <template v-for="row in visibleRows" :key="row.key">
          <div v-if="row.kind === 'hunk'" class="dsh-git-graph-diff-hunk">{{ row.text }}</div>
          <div v-else class="dsh-git-graph-diff-line" :class="lineClass(row)">
            <span class="dsh-git-graph-diff-gutter">{{ oldLine(row) }}</span>
            <span class="dsh-git-graph-diff-gutter">{{ newLine(row) }}</span>
            <span class="dsh-git-graph-diff-text">{{ textPrefix(row) }}{{ row.text }}</span>
          </div>
        </template>

        <div :style="{ height: `${bottomSpacer}px` }"></div>
      </div>
    </div>
  </div>
</template>
