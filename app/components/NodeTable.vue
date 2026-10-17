<script setup lang="ts">
import type { MeshNode } from '~/types'
import { BAND_COLORS, hopDepth, latencyMs } from '~/types'
import { gridOf, wgs84Text } from '~/composables/useGrid'

const { t } = useLang()
const props = defineProps<{
  nodes: MeshNode[]
  selected: string | null
  snrByNode: Map<string, number | null>
}>()

/** `null` clears the selection: clicking the active row again deselects it. */
const emit = defineEmits<{ (e: 'select', name: string | null): void }>()

type SortKey = 'name' | 'band' | 'hops' | 'latency' | 'snr' | 'firmware' | 'location'
const sortKey = ref<SortKey>('hops')
const asc = ref(true)

const ROW_H = 30
const OVERSCAN = 8
const scrollTop = ref(0)
const viewportH = ref(430)
const scroller = ref<HTMLElement | null>(null)

/** Absent readings sort last in both directions. */
function num(n: MeshNode, k: SortKey): number | string | null {
  switch (k) {
    case 'name':
      return n.name
    case 'band':
      return n.band
    case 'hops':
      return hopDepth(n)
    case 'latency':
      return latencyMs(n)
    case 'snr': {
      const v = props.snrByNode.get(nodeId(n))
      return v === null || v === undefined ? null : v
    }
    case 'firmware':
      return n.firmware || null
    default:
      return n.has_location ? 0 : 1
  }
}

const sorted = computed(() => {
  const arr = props.nodes.slice()
  arr.sort((a, b) => {
    const x = num(a, sortKey.value)
    const y = num(b, sortKey.value)
    if (x === null || y === null) {
      if (x === y) return String(a.name).localeCompare(String(b.name))
      return x === null ? 1 : -1
    }
    const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
    return asc.value ? cmp : -cmp
  })
  return arr
})

// Windowing: only rows inside the scroller plus overscan exist in the DOM.
const start = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN))
const count = computed(() => Math.ceil(viewportH.value / ROW_H) + OVERSCAN * 2)
const slice = computed(() => sorted.value.slice(start.value, start.value + count.value))
const padTop = computed(() => start.value * ROW_H)
const padBottom = computed(() => Math.max(0, (sorted.value.length - start.value - slice.value.length) * ROW_H))

function onScroll(e: Event) {
  const el = e.target as HTMLElement
  scrollTop.value = el.scrollTop
}
function setSort(k: SortKey) {
  if (sortKey.value === k) asc.value = !asc.value
  else {
    sortKey.value = k
    asc.value = k === 'name' || k === 'band' || k === 'firmware'
  }
  scroller.value?.scrollTo({ top: 0 })
}
onMounted(() => {
  viewportH.value = scroller.value?.clientHeight ?? 430
})

// A map or graph selection must also be visible in the list.
watch(
  () => props.selected,
  id => {
    if (!id || !scroller.value) return
    const i = sorted.value.findIndex(n => nodeId(n) === id)
    if (i < 0) return
    const top = i * ROW_H
    const h = scroller.value.clientHeight
    if (top < scroller.value.scrollTop || top > scroller.value.scrollTop + h - ROW_H) {
      scroller.value.scrollTo({ top: Math.max(0, top - h / 2) })
    }
  },
)
function arrow(k: SortKey) {
  if (sortKey.value !== k) return ''
  return asc.value ? ' ▲' : ' ▼'
}
function pickRow(n: MeshNode) {
  const id = nodeId(n)
  emit('select', id === props.selected ? null : id)
}

// The list shows display names; the shared selection carries the id.
const selectedLabel = computed(() => {
  const hit = props.nodes.find(n => nodeId(n) === props.selected)
  return hit ? hit.name : (props.selected ?? '')
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex items-center justify-between gap-2 px-1 pb-1 text-xs opacity-70">
      <span>{{ t('table.rows', { n: nodes.length }) }}</span>
      <span v-if="selected" class="truncate">{{ t('table.selected', { name: selectedLabel }) }}</span>
    </div>
    <div
      ref="scroller"
      class="scroll-thin min-h-0 flex-1 overflow-auto rounded-lg border border-base-300"
      :style="{ maxHeight: '430px' }"
      @scroll.passive="onScroll"
    >
      <!-- table-fixed: content-sized columns would reflow on every latency digit. -->
      <table class="table table-xs table-compact table-fixed min-w-[460px]">
        <thead class="sticky top-0 z-10 bg-base-300/90 backdrop-blur">
          <tr>
            <th class="w-[34%] cursor-pointer select-none md:w-[22%]" @click="setSort('name')">{{ t('table.name') }}{{ arrow('name') }}</th>
            <th class="w-[16%] cursor-pointer select-none md:w-[12%]" @click="setSort('band')">{{ t('table.band') }}{{ arrow('band') }}</th>
            <th class="w-[16%] cursor-pointer select-none text-right md:w-[10%]" @click="setSort('hops')">{{ t('table.hops') }}{{ arrow('hops') }}</th>
            <th class="w-[22%] cursor-pointer select-none text-right md:w-[14%]" @click="setSort('latency')">{{ t('table.latency') }}{{ arrow('latency') }}</th>
            <th class="hidden w-[12%] cursor-pointer select-none text-right sm:table-cell" @click="setSort('snr')">SNR{{ arrow('snr') }}</th>
            <th class="hidden w-[14%] cursor-pointer select-none md:table-cell" @click="setSort('firmware')">
              {{ t('table.firmware') }}{{ arrow('firmware') }}
            </th>
            <th class="hidden w-[16%] cursor-pointer select-none lg:table-cell" @click="setSort('location')">
              {{ t('table.location') }}{{ arrow('location') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="padTop" :style="{ height: padTop + 'px' }" class="!border-0"><td colspan="7" /></tr>
          <tr
            v-for="n in slice"
            :key="nodeId(n)"
            class="cursor-pointer border-t border-base-300/50 hover:bg-base-300/40"
            :class="{ 'aredn-row-active font-semibold': nodeId(n) === selected }"
            :style="{ height: ROW_H + 'px' }"
            @click="pickRow(n)"
          >
            <td class="max-w-[16rem] truncate">
              <span class="flex items-center gap-2">
                <i
                  class="inline-block h-2 w-2 shrink-0 rounded-full"
                  :class="n.online ? '' : 'opacity-30'"
                  :style="{ backgroundColor: n.online ? BAND_COLORS[n.band] : '#475569' }"
                />
                <span class="truncate">{{ n.name }}</span>
              </span>
            </td>
            <td>
              <span
                class="badge h-5 border-0 px-1 text-[10px] font-normal text-base-100"
                :style="{ backgroundColor: BAND_COLORS[n.band] }"
              >
                {{ t('band.' + n.band) }}
              </span>
            </td>
            <td class="text-right tabular">{{ hopDepth(n) ?? '—' }}</td>
            <td class="text-right tabular">{{ latencyMs(n) != null ? latencyMs(n)!.toFixed(1) + 'ms' : '—' }}</td>
            <td class="hidden text-right tabular sm:table-cell">{{ snrByNode.get(nodeId(n)) ?? '—' }}</td>
            <td class="hidden max-w-[8rem] truncate font-mono text-[10px] md:table-cell">{{ n.firmware || '—' }}</td>
            <td class="hidden max-w-[10rem] truncate lg:table-cell">
              <span
                v-if="n.has_location"
                class="font-mono text-[10px]"
                :title="`WGS-84 ${wgs84Text(n.lat, n.lon)}`"
              >
                {{ gridOf(n) ?? '—' }}
              </span>
              <span v-else class="opacity-40">{{ t('table.noLocation') }}</span>
            </td>
          </tr>
          <tr v-if="padBottom" :style="{ height: padBottom + 'px' }" class="!border-0">
            <td colspan="7" />
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
