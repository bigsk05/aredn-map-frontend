<script setup lang="ts">
import type { MeshLink } from '~/types'
import { linkLive } from '~/composables/useMeshStore'

/** One wire as its reporting side saw it; shared by map and graph. */
const props = defineProps<{ link: MeshLink; resolveName: (id: string) => string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useLang()

function fmt(n: number | null | undefined, unit = '') {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${n}${unit}`
}
</script>

<template>
  <div
    class="absolute bottom-2 left-2 z-20 w-[min(21rem,calc(100%-1rem))] rounded-lg border border-base-300 bg-base-100/95 p-2 text-[11px] shadow backdrop-blur"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <span class="truncate font-semibold">{{ props.resolveName(props.link.from) }}</span>
        <span class="opacity-60" aria-hidden="true"> ⇄ </span>
        <span class="truncate font-semibold">{{ props.resolveName(props.link.to) }}</span>
      </div>
      <button class="btn btn-xs btn-ghost h-5 w-5 shrink-0 p-0" :aria-label="t('common.close')" @click="emit('close')">✕</button>
    </div>
    <div class="mt-1 flex flex-wrap gap-1">
      <span class="badge badge-xs border-0 bg-base-200">{{ props.link.type }}</span>
      <span class="badge badge-xs border-0 bg-base-200">
        {{ t('band.' + props.link.band) }}
      </span>
      <span v-if="props.link.state" class="badge badge-xs border-0 bg-base-200">{{ props.link.state }}</span>
      <span class="badge badge-xs border-0" :class="linkLive(props.link) ? 'bg-success/15' : 'bg-error/15'">
        {{ props.link.status }}
      </span>
    </div>
    <dl class="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 opacity-80">
      <div class="flex justify-between gap-2"><dt class="opacity-60">{{ t('link.distance') }}</dt><dd class="tabular">{{ fmt(props.link.distance_mi, ' mi') }}</dd></div>
      <div class="flex justify-between gap-2"><dt class="opacity-60">{{ t('link.etx') }}</dt><dd class="tabular">{{ props.link.etx ?? '—' }}</dd></div>
      <div class="flex justify-between gap-2"><dt class="opacity-60">{{ t('link.localSnr') }}</dt><dd class="tabular">{{ props.link.local_snr ?? '—' }}</dd></div>
      <div class="flex justify-between gap-2"><dt class="opacity-60">{{ t('link.neighborSnr') }}</dt><dd class="tabular">{{ props.link.neighbor_snr ?? '—' }}</dd></div>
      <div class="flex justify-between gap-2"><dt class="opacity-60">{{ t('link.rxTx') }}</dt><dd class="tabular">{{ fmt(props.link.rx_success_pct, '%') }} / {{ fmt(props.link.tx_success_pct, '%') }}</dd></div>
      <div class="flex justify-between gap-2"><dt class="opacity-60">{{ t('link.rtt') }}</dt><dd class="tabular">{{ fmt(props.link.rtt_ms, ' ms') }}</dd></div>
      <div class="flex justify-between gap-2"><dt class="opacity-60">{{ t('link.routes') }}</dt><dd class="tabular">{{ props.link.routes || '—' }}</dd></div>
      <div class="flex justify-between gap-2"><dt class="opacity-60">{{ t('link.metric') }}</dt><dd class="tabular">{{ props.link.metric ?? '—' }}</dd></div>
    </dl>
    <p v-if="props.link.last_seen" class="mt-1 opacity-50">
      {{ t('link.lastSeen', { time: props.link.last_seen?.replace('T', ' ').slice(0, 19), from: props.link.from }) }}
    </p>
  </div>
</template>
