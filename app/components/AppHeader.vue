<script setup lang="ts">
import type { LangCode } from '~/i18n'
import type { StatusPayload } from '~/types'
import type { ConnState } from '~/composables/useMeshStore'

const props = defineProps<{
  status: StatusPayload | null
  conn: ConnState
  lastSync: number
  /** An inventory pull is in flight. */
  busy: boolean
}>()

const emit = defineEmits<{ (e: 'refresh'): void }>()

const { isDark, toggle: toggleTheme } = useTheme()
const { t, locale, setLang, langs } = useLang()

const connText = computed(() => t('conn.' + props.conn))

// Client-only: a wall clock rendered during SSR mismatches on hydration.
const mounted = ref(false)
const elapsed = ref(0)
const syncedAt = ref('')
let tick: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  mounted.value = true
  tick = setInterval(() => (elapsed.value = Math.round((Date.now() - (props.lastSync || Date.now())) / 1000)), 1000)
})

onBeforeUnmount(() => {
  if (tick) clearInterval(tick)
})

/** Go's zero time arrives as 0001-01-01 and reads as "none yet". */
function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 100) return '—'
  return d.toLocaleString(locale.value, { hour12: false })
}

watch(
  () => props.lastSync,
  ms => {
    if (ms) syncedAt.value = new Date(ms).toLocaleTimeString(locale.value, { hour12: false })
  },
  { immediate: true },
)
</script>

<template>
  <header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-base-300 bg-base-200/70 px-4 py-2.5">
    <div class="flex min-w-0 basis-full items-center gap-3 sm:basis-auto">
      <span class="flex shrink-0 items-end gap-[3px]" aria-hidden="true">
        <i class="block h-4 w-1 rounded-sm bg-success" />
        <i class="block h-6 w-1 rounded-sm bg-info" />
        <i class="block h-3 w-1 rounded-sm bg-warning" />
      </span>
      <div class="min-w-0 leading-tight">
        <h1 class="truncate text-base font-semibold tracking-tight sm:text-lg">{{ t('app.title') }}</h1>
        <p class="truncate text-[11px] opacity-70 sm:text-xs">{{ t('app.subtitle') }}</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <span class="badge badge-ghost gap-2 border-base-300 text-xs" :title="syncedAt ? t('header.syncedAt', { time: syncedAt }) : ''">
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="{
            'bg-success animate-pulse': conn === 'live',
            'bg-warning': conn === 'connecting',
            'bg-error': conn === 'down',
            'bg-info': conn === 'stale',
          }"
        />
        {{ connText }}
        <span v-if="mounted && lastSync" class="tabular opacity-60">· {{ t('header.agoS', { n: elapsed }) }}</span>
      </span>

      <span v-if="status" class="badge badge-ghost hidden gap-2 border-base-300 text-xs tabular sm:inline-flex" :title="t('header.workHint')">
        {{ t('header.fetch', { busy: status.scan.workers_busy, total: status.scan.worker_slots }) }}
        ·
        {{ t('header.probe', { busy: status.scan.probes_active, total: status.scan.probe_slots }) }}
      </span>

      <span v-if="status" class="hidden text-xs opacity-60 lg:inline">
        {{ t('header.lastSweep', { time: fmtTime(status.last_sweep_at) }) }}
        ·
        {{ t('header.nextSweep', { time: fmtTime(status.next_sweep_at) }) }}
      </span>

      <select
        class="select select-sm w-auto border-base-300"
        :aria-label="t('header.language')"
        :value="locale"
        @change="setLang(($event.target as HTMLSelectElement).value as LangCode)"
      >
        <option v-for="l in langs" :key="l.code" :value="l.code">{{ l.name }}</option>
      </select>

      <button class="btn btn-sm border border-base-300" :disabled="busy" @click="emit('refresh')">
        <span class="iconfont">⟳</span>
        {{ t('header.refresh') }}
      </button>

      <button
        class="btn btn-sm btn-square border border-base-300"
        :title="isDark ? t('header.toLight') : t('header.toDark')"
        @click="toggleTheme"
      >
        {{ isDark ? '🌙' : '☀️' }}
      </button>
    </div>
  </header>
</template>
