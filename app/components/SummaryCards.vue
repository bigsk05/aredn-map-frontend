<script setup lang="ts">
import type { StatusPayload } from '~/types'

const props = defineProps<{ status: StatusPayload | null }>()

const { t } = useLang()
const c = computed(() => props.status?.counts)
const scan = computed(() => props.status?.scan)

// No progress bar: with max_hops -1 the frontier grows during discovery, so a percentage would be a guess.
const running = computed(() => scan.value?.status === 'running')

/** Scan phase values from the Go engine; an unknown one renders as it arrived. */
const PHASE_KEYS: Record<string, string> = {
  idle: 'phase.idle',
  discovery: 'phase.discovery',
  probe: 'phase.probe',
  detail: 'phase.detail',
  revisit: 'phase.revisit',
  completed: 'phase.completed',
  failed: 'phase.failed',
  stopped: 'phase.stopped',
}
const STATUS_KEYS: Record<string, string> = {
  idle: 'status.idle',
  running: 'status.running',
  completed: 'status.completed',
  'completed with failures': 'status.completedWithFailures',
  stopped: 'status.stopped',
  failed: 'status.failed',
  'timed out': 'status.timedOut',
}

function labelled(map: Record<string, string>, value: string) {
  const key = map[value]
  return key ? t(key) : value
}
</script>

<template>
  <!-- Not .stats: daisyUI sizes those to content and the cards would slide on every push. -->
  <section
    class="grid w-full grid-cols-1 gap-x-4 border border-base-300 shadow-sm sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-base-300"
  >
    <article class="stat min-w-0">
      <div class="stat-title whitespace-normal text-info">{{ t('summary.discovered') }}</div>
      <div class="stat-value tabular text-info">{{ c?.total ?? '—' }}</div>
      <div class="stat-desc whitespace-normal">
        {{ t('summary.pendingDetail', { n: c?.pending ?? 0 }) }} ·
        {{ t('summary.crawlFailed', { n: c?.failed ?? 0 }) }} ·
        {{ t('summary.supernodes', { n: c?.supernodes ?? 0 }) }}
      </div>
    </article>

    <article class="stat min-w-0">
      <div class="stat-title whitespace-normal text-success">{{ t('summary.online') }}</div>
      <div class="stat-value tabular text-success">{{ c?.online ?? '—' }}</div>
      <div class="stat-desc whitespace-normal">
        {{ t('summary.noAnswer', { n: c?.offline ?? 0 }) }} ·
        {{ t('summary.unprobed', { n: c?.unprobed ?? 0 }) }} ·
        {{ t('summary.reached', { done: c?.crawled ?? 0, total: c?.total ?? 0 }) }}
      </div>
    </article>

    <article class="stat min-w-0">
      <div class="stat-title whitespace-normal text-warning">{{ t('summary.located') }}</div>
      <div class="stat-value tabular text-warning">{{ c?.located ?? '—' }}</div>
      <div class="stat-desc whitespace-normal">
        {{ t('summary.links', { n: c?.links ?? 0 }) }} ·
        {{ t('summary.services', { n: c?.services ?? 0 }) }}
      </div>
    </article>

    <article class="stat min-w-0">
      <div class="stat-title whitespace-normal text-error">
        {{ t('summary.scanState') }}
        <span class="badge badge-ghost ml-2 h-5 text-[10px] leading-5">
          {{ labelled(STATUS_KEYS, scan?.status ?? 'idle') }}
        </span>
      </div>
      <div class="stat-value text-base-content/85 text-xl">
        {{ labelled(PHASE_KEYS, scan?.phase ?? 'idle') }}
      </div>
      <div class="stat-desc mt-1 w-full whitespace-normal">
        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span class="tabular">
            {{ t('summary.ok') }} <span class="text-success">{{ scan?.succeeded ?? 0 }}</span> ·
            {{ t('summary.failed') }} <span class="text-error">{{ scan?.failed ?? 0 }}</span>
          </span>
          <span v-if="running" class="min-w-0 max-w-full flex-1 truncate" :title="scan?.current_target ?? ''">
            {{ t('summary.currentTarget', { target: scan?.current_target || '—' }) }}
          </span>
        </div>
      </div>
    </article>
  </section>
</template>
