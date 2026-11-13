<script setup lang="ts">
/**
 * One ref capsule. `type` decides the glyph, the tooltip label and the colour
 * hook; HEAD is rendered as the highlighted branch it points at.
 */
import { computed } from 'vue';
import type { GraphRefBadge } from './types';
import Icon from './Icon.vue';

interface RefMeta {
  kind: 'branch' | 'remote' | 'tag';
  icon: string;
  label: string;
}

const META: Record<GraphRefBadge['type'], RefMeta> = {
  head: { kind: 'branch', icon: 'git-branch', label: 'Branch' },
  branch: { kind: 'branch', icon: 'git-branch', label: 'Branch' },
  remote: { kind: 'remote', icon: 'cloud', label: 'Remote branch' },
  tag: { kind: 'tag', icon: 'tag', label: 'Tag' },
};

const props = defineProps<{ badge: GraphRefBadge }>();

const meta = computed<RefMeta>(() => META[props.badge.type]);
</script>

<template>
  <span
    class="vgg-ref"
    :class="{ 'vgg-ref-head': badge.type === 'head' }"
    :data-kind="meta.kind"
    :title="`${meta.label} ${badge.name}`"
  >
    <Icon :name="meta.icon" />
    <span class="vgg-ref-name">{{ badge.name }}</span>
  </span>
</template>
