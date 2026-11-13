<script setup lang="ts">
/**
 * Inline glyphs for the pane header and ref capsules.
 *
 * Obsidian's `setIcon` is not used: the pane needs five small icons and these
 * components render in unit tests without an app instance.
 */
import { computed } from 'vue';

type Shape =
  | { tag: 'path'; d: string }
  | { tag: 'circle'; cx: number; cy: number; r: number };

const GLYPHS: Record<string, Shape[]> = {
  'git-graph': [
    { tag: 'path', d: 'M6 6h12M6 6l6 12M18 6l-6 12' },
    { tag: 'circle', cx: 6, cy: 6, r: 2 },
    { tag: 'circle', cx: 18, cy: 6, r: 2 },
    { tag: 'circle', cx: 12, cy: 18, r: 2 },
  ],
  'git-branch': [
    { tag: 'path', d: 'M6 7v5a7 7 0 0 0 7 7h3' },
    { tag: 'circle', cx: 6, cy: 5, r: 2 },
    { tag: 'circle', cx: 16, cy: 19, r: 2 },
  ],
  cloud: [
    { tag: 'path', d: 'M7.5 18h9a3.5 3.5 0 0 0 .3-7 6 6 0 0 0-11.4 2A2.9 2.9 0 0 0 7.5 18Z' },
  ],
  tag: [
    { tag: 'path', d: 'M4 4h7l9 9-7 7-9-9V4Z' },
    { tag: 'circle', cx: 8, cy: 8, r: 1 },
  ],
  'refresh-cw': [
    { tag: 'path', d: 'M20 8a8 8 0 0 0-13.6-3L4 7' },
    { tag: 'path', d: 'M4 4v3h3' },
    { tag: 'path', d: 'M4 16a8 8 0 0 0 13.6 3L20 17' },
    { tag: 'path', d: 'M20 20v-3h-3' },
  ],
};

const props = defineProps<{ name: string }>();

const shapes = computed<Shape[]>(() => GLYPHS[props.name] ?? []);
</script>

<template>
  <span class="vgg-icon" :data-icon="name" aria-hidden="true">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <template v-for="(shape, index) in shapes" :key="index">
        <path v-if="shape.tag === 'path'" :d="shape.d" />
        <circle v-else :cx="shape.cx" :cy="shape.cy" :r="shape.r" />
      </template>
    </svg>
  </span>
</template>
