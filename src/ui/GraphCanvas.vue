<script setup lang="ts">
/**
 * Graph drawing layer: one absolutely positioned `<svg>` that sits on top of
 * the table body. The SVG itself ignores pointer events; only commit circles
 * are clickable, so row clicks keep working everywhere else.
 */
import { computed } from 'vue';
import type { GraphLayout } from '../graph/types';

interface PathPrimitive {
  key: string;
  kind: 'shadow' | 'line';
  d: string;
  stroke: string;
  dashed: boolean;
}

const props = withDefaults(
  defineProps<{
    layout: GraphLayout;
    width: number;
    height: number;
    background: string;
    masked?: boolean;
  }>(),
  { masked: false },
);

const emit = defineEmits<{
  (event: 'select', row: number): void;
}>();

/**
 * Fade the right edge when the drawing was clipped (`masked`) or when the
 * available width is narrower than the content the engine produced.
 */
const constrained = computed<boolean>(
  () => props.masked || props.width < props.layout.contentWidth,
);

/**
 * Flatten paths into shadow/line primitives. Interleaving them per path lets
 * each line's background halo mask the lines it crosses, and giving every
 * primitive its own stable key keeps Vue from reusing the wrong path when the
 * layout changes.
 */
const pathPrimitives = computed<PathPrimitive[]>(() =>
  props.layout.paths.flatMap((path, index): PathPrimitive[] => [
    {
      key: `shadow-${index}`,
      kind: 'shadow',
      d: path.d,
      stroke: props.background,
      dashed: false,
    },
    {
      key: `line-${index}`,
      kind: 'line',
      d: path.d,
      stroke: path.colour,
      dashed: path.dashed,
    },
  ]),
);

function selectPoint(row: number): void {
  emit('select', row);
}
</script>

<template>
  <svg
    class="dsh-git-graph-svg"
    :class="{ 'dsh-git-graph-svg-masked': constrained }"
    xmlns="http://www.w3.org/2000/svg"
    :width="width"
    :height="height"
    pointer-events="none"
    aria-hidden="true"
    focusable="false"
  >
    <path
      v-for="primitive in pathPrimitives"
      :key="primitive.key"
      :class="
        primitive.kind === 'shadow' ? 'dsh-git-graph-shadow' : 'dsh-git-graph-line'
      "
      :d="primitive.d"
      :stroke="primitive.stroke"
      :stroke-width="primitive.kind === 'shadow' ? 4 : 2"
      :opacity="primitive.kind === 'shadow' ? 0.75 : undefined"
      fill="none"
      :stroke-dasharray="primitive.dashed ? '4 4' : undefined"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <g v-for="(point, index) in layout.points" :key="`point-${index}`">
      <circle
        :key="`dot-${index}`"
        class="dsh-graph-point"
        :cx="point.x"
        :cy="point.y"
        :r="point.stash ? 4.5 : 4"
        :fill="point.current ? background : point.colour"
        :stroke="point.current ? point.colour : 'none'"
        :stroke-width="point.current ? 2 : 0"
        @click="selectPoint(point.row)"
      />
      <circle
        v-if="point.stash"
        :key="`inner-${index}`"
        class="dsh-git-graph-point-inner"
        :cx="point.x"
        :cy="point.y"
        r="2"
        :fill="background"
        pointer-events="none"
      />
      <circle
        v-if="point.stashInternal"
        :key="`ring-${index}`"
        class="dsh-git-graph-point-ring"
        :cx="point.x"
        :cy="point.y"
        r="5.5"
        fill="none"
        stroke="#808080"
        stroke-width="1"
        stroke-dasharray="2 2"
        pointer-events="none"
      />
    </g>
  </svg>
</template>
