<script setup lang="ts">
/**
 * Pane header: repository and branch on the first line, search and ref filter
 * on the second. The component is presentational; the pane owns the state.
 */
import { computed } from 'vue';
import Icon from './Icon.vue';

const props = defineProps<{
  repoName: string;
  branch: string | null;
  refFilter: 'local' | 'all';
  filterText: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  (event: 'refresh'): void;
  (event: 'update:refFilter', value: 'local' | 'all'): void;
  (event: 'update:filterText', value: string): void;
}>();

const branchLabel = computed<string>(() => props.branch ?? 'detached');
const refreshLabel = computed<string>(() => (props.loading ? '正在加载提交…' : '刷新'));

function pickRefFilter(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  emit('update:refFilter', value === 'all' ? 'all' : 'local');
}

function updateSearch(event: Event): void {
  emit('update:filterText', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="dsh-gg-head">
    <div class="dsh-gg-head-identity">
      <Icon name="git-graph" />
      <span class="dsh-gg-repo" :title="repoName">{{ repoName }}</span>
      <span class="dsh-gg-branch">{{ branchLabel }}</span>
    </div>

    <div class="dsh-gg-head-tools">
      <select
        class="dsh-gg-ref-select dropdown"
        :value="refFilter"
        aria-label="引用过滤"
        title="Local：本地分支和标签；All：还包含远端跟踪引用"
        @change="pickRefFilter"
      >
        <option value="local">Local</option>
        <option value="all">All</option>
      </select>

      <input
        class="dsh-gg-search"
        type="search"
        placeholder="Filter commits"
        :value="filterText"
        @input="updateSearch"
      >

      <button
        type="button"
        class="dsh-gg-icon-btn clickable-icon"
        :aria-label="refreshLabel"
        :title="refreshLabel"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <Icon name="refresh-cw" />
      </button>
    </div>
  </div>
</template>
