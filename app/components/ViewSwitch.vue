<script setup lang="ts">
import type { ViewMode } from '~/composables/useMeshStore'

const props = defineProps<{ view: ViewMode; graphCount: number; mapCount: number }>()
const emit = defineEmits<{ (e: 'update:view', v: ViewMode): void }>()
const { t } = useLang()
</script>

<template>
  <div class="join">
    <button
      class="btn join-item btn-sm"
      :class="props.view === 'map' ? 'btn-primary' : 'btn-ghost border border-base-300'"
      :aria-pressed="props.view === 'map'"
      @click="emit('update:view', 'map')"
    >
      {{ t('view.map') }}
      <span class="badge badge-ghost badge-xs tabular">{{ props.mapCount }}</span>
    </button>
    <button
      class="btn join-item btn-sm"
      :class="props.view === 'graph' ? 'btn-primary' : 'btn-ghost border border-base-300'"
      :aria-pressed="props.view === 'graph'"
      @click="emit('update:view', 'graph')"
    >
      {{ t('view.graph') }}
      <span class="badge badge-ghost badge-xs tabular">{{ props.graphCount }}</span>
    </button>
  </div>
</template>
