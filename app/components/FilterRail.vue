<script setup lang="ts">
import type { StatusPayload } from '~/types'
import { BAND_COLORS, BAND_ROWS } from '~/types'
import { useFilters } from '~/composables/useMeshStore'

const props = defineProps<{ status: StatusPayload | null }>()

const { t, text } = useLang()
const {
  filters,
  toggleBand,
  toggleLinkType,
  toggleChannel,
  reset,
  activeCount,
  activeChips,
  channels,
  visibleNodes,
} = useFilters()

const counts = computed(() => props.status?.band_counts ?? {})
const linkCounts = computed(() => props.status?.link_type_counts ?? {})
const total = computed(() => props.status?.counts?.total ?? 0)

const rows = computed(() =>
  BAND_ROWS.map(r => ({
    ...r,
    color: BAND_COLORS[r.key],
    count: counts.value[r.key] ?? 0,
    active: filters.value.bands.includes(r.key),
  })),
)

/** Link chips come from reported data, so new types appear without a release. */
const LINK_ORDER = ['RF', 'DtD', 'Wireguard', 'Local']
const linkChips = computed(() => {
  const seen = Object.keys(linkCounts.value)
  const extras = seen.filter(k => !LINK_ORDER.includes(k)).sort()
  return [...LINK_ORDER.filter(k => seen.includes(k)), ...extras]
})

const LOCATED_STEPS = ['all', 'with', 'without', 'unread'] as const
const locatedLabel = computed(() => t('loc.' + filters.value.located))
function cycleLocated() {
  const i = LOCATED_STEPS.indexOf(filters.value.located)
  filters.value.located = LOCATED_STEPS[(i + 1) % LOCATED_STEPS.length]!
}

const ONLINE_STEPS = [
  { v: 'all', key: 'filters.all', n: null as number | null },
  { v: 'online', key: 'state.online', n: 0 },
  { v: 'offline', key: 'state.offline', n: 1 },
  { v: 'unprobed', key: 'state.unprobed', n: 2 },
]
const onlineCounts = computed(() => {
  const c = props.status?.counts
  return [c?.online ?? 0, c?.offline ?? 0, c?.unprobed ?? 0]
})

const hopsText = computed(() =>
  filters.value.maxHops ? t('filters.hopsAtMost', { n: filters.value.maxHops }) : t('filters.hopsNoLimit'),
)
</script>

<template>
  <aside class="card border border-base-300 bg-base-200/40">
    <div class="card-body gap-4 p-4">
      <div class="flex items-center justify-between">
        <h2 class="card-title text-sm">{{ t('filters.title') }}</h2>
        <button class="btn btn-xs btn-ghost" :disabled="!activeCount" @click="reset">
          {{ t('filters.clear') }}<span v-if="activeCount" class="badge badge-xs badge-primary tabular">{{ activeCount }}</span>
        </button>
      </div>

      <div v-if="activeChips.length" class="flex flex-wrap gap-1">
        <button
          v-for="chip in activeChips"
          :key="chip.key"
          class="badge badge-outline gap-1 border-base-300 text-[10px]"
          :title="t('filters.remove')"
          @click="chip.clear"
        >
          {{ text(chip.labelKey, chip.raw ?? '', chip.params ?? {}) }}
          <span class="opacity-60">✕</span>
        </button>
      </div>

      <label class="input input-sm w-full">
        <span class="text-xs opacity-60">{{ t('filters.search') }}</span>
        <input v-model="filters.q" type="search" class="grow bg-transparent text-sm outline-none" :placeholder="t('filters.searchPlaceholder')" />
      </label>

      <div class="overflow-hidden rounded-lg border border-base-300">
        <table class="table table-xs">
          <thead>
            <tr class="bg-base-300/60">
              <th>{{ t('filters.band') }}</th>
              <th class="text-right">{{ t('filters.nodeCount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.key"
              class="cursor-pointer border-t border-base-300/60 hover:bg-base-300/40"
              :class="{ 'aredn-row-active': r.active }"
              :title="r.noteKey ? t(r.noteKey) : ''"
              role="button"
              tabindex="0"
              @click="toggleBand(r.key)"
              @keydown.enter.prevent="toggleBand(r.key)"
            >
              <td>
                <span class="flex items-center gap-2">
                  <i
                    class="inline-block h-3 w-3 shrink-0 rounded-full border border-base-content/20"
                    :style="{ backgroundColor: r.color }"
                  />
                  {{ t('band.' + r.key) }}
                  <span class="font-mono text-[10px] opacity-50">{{ r.key }}</span>
                </span>
              </td>
              <td class="text-right tabular">{{ r.count }}</td>
            </tr>
            <tr class="border-t border-base-300/60 bg-base-300/30 font-semibold">
              <td>{{ t('filters.total') }}</td>
              <td class="text-right tabular">{{ total }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="form-control gap-1">
        <span class="text-xs opacity-70">{{ t('filters.channel') }}</span>
        <div class="flex flex-wrap gap-1">
          <button
            class="btn btn-xs"
            :class="!filters.channels.length ? 'btn-primary' : 'btn-ghost border border-base-300'"
            @click="filters.channels = []"
          >
            {{ t('filters.all') }}
          </button>
          <button
            v-for="ch in channels.slice(0, 12)"
            :key="ch.value"
            class="btn btn-xs tabular"
            :class="filters.channels.includes(ch.value) ? 'btn-primary' : 'btn-ghost border border-base-300'"
            :title="t('filters.channelTip', { label: t(ch.labelKey, ch.params ?? {}), count: ch.count })"
            @click="toggleChannel(ch.value)"
          >
            {{ t(ch.labelKey, ch.params ?? {}) }}<span class="opacity-50">·{{ ch.count }}</span>
          </button>
        </div>
      </div>

      <div class="divider my-0" />

      <div class="form-control gap-1">
        <span class="text-xs opacity-70">{{ t('filters.linkType') }}</span>
        <!-- flex-wrap, not .join: a join cannot break and long counts clip. -->
        <div class="flex flex-wrap gap-1">
          <button
            v-for="lt in linkChips"
            :key="lt"
            class="btn btn-xs"
            :class="filters.linkTypes.includes(lt) ? 'btn-primary' : 'border border-base-300'"
            @click="toggleLinkType(lt)"
          >
            {{ text('linkType.' + lt, lt) }}
            <span class="tabular opacity-60">{{ linkCounts[lt] ?? 0 }}</span>
          </button>
        </div>
        <label class="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[10px] opacity-70">
          <input v-model="filters.showDown" type="checkbox" class="checkbox checkbox-xs" />
          {{ t('filters.showDown') }}
        </label>
      </div>

      <!-- .form-control is display:block here, so the button needs the column layout. -->
      <div class="form-control flex flex-col items-start gap-1.5">
        <span class="text-xs opacity-70">{{ t('filters.location') }}</span>
        <button
          class="btn btn-xs border border-base-300"
          :class="filters.located !== 'all' ? 'btn-secondary' : ''"
          @click="cycleLocated"
        >
          {{ locatedLabel }}
        </button>
      </div>

      <div class="form-control gap-1">
        <label class="label py-1">
          <span class="label-text-alt text-xs opacity-70">{{ t('filters.onlineState') }}</span>
        </label>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="opt in ONLINE_STEPS"
            :key="opt.v"
            class="btn btn-xs"
            :class="filters.online === opt.v ? 'btn-primary' : 'border border-base-300'"
            :title="opt.n === null ? '' : t('filters.stateTip', { label: t(opt.key), count: onlineCounts[opt.n] })"
            @click="filters.online = opt.v as never"
          >
            {{ t(opt.key) }}
            <span v-if="opt.n !== null" class="tabular opacity-60">{{ onlineCounts[opt.n] }}</span>
          </button>
        </div>
      </div>

      <div class="form-control gap-1">
        <label class="label py-1">
          <span class="label-text-alt text-xs opacity-70">{{ t('filters.hops') }}</span>
          <span class="label-text-alt badge badge-ghost badge-sm text-[10px]">{{ hopsText }}</span>
        </label>
        <input v-model.number="filters.maxHops" type="range" class="range range-xs range-accent" min="0" max="10" step="1" />
        <div class="flex justify-between text-[10px] opacity-60">
          <span>{{ t('filters.zeroUnlimited') }}</span><span>5</span><span>10+</span>
        </div>
      </div>

      <p class="text-xs opacity-70">{{ t('filters.hit', { n: visibleNodes.length }) }}</p>
    </div>
  </aside>
</template>
