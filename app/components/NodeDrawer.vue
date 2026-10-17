<script setup lang="ts">
import type { MeshLink, MeshNode } from '~/types'
import { BAND_COLORS, hopDepth, latencyMs, lossPct, probeSeen } from '~/types'
import { apiBase, bandColor, CHANNEL_KEYS, channelBucket, nodeId } from '~/composables/useMeshStore'
import { gridOf, wgs84Text } from '~/composables/useGrid'

const props = defineProps<{ node: MeshNode | null; links: MeshLink[] }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'select', name: string): void }>()

const { t, locale } = useLang()

function fmt(n: number | null | undefined, unit = '') {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${n}${unit}`
}

const freqRange = computed(() => {
  const n = props.node
  if (!n?.freq_low) return '—'
  return n.freq_high && n.freq_high !== n.freq_low ? `${n.freq_low} – ${n.freq_high} MHz` : `${n.freq_low} MHz`
})

const services = computed(() => {
  const n = props.node
  if (!n) return []
  return Object.entries(n.services ?? {}).flatMap(([proto, list]) => (list ?? []).map(l => `${proto}: ${l}`))
})

/** Node's published Maidenhead cell, else the one computed from its WGS-84 position. */
const grid = computed(() => (props.node ? gridOf(props.node) : null))
const coords = computed(() => {
  const n = props.node
  if (!n || !n.has_location) return ''
  return wgs84Text(n.lat, n.lon)
})
const gridFromNode = computed(() => Boolean(props.node?.grid_locator?.trim()))

function linkFor(name: string): MeshLink | undefined {
  return props.links.find(l => l.from === name || l.to === name)
}

/** Link ends are hostnames; `name` is a display label and can differ. */
function peerOf(l: MeshLink) {
  return l.from === (props.node ? nodeId(props.node) : '') ? l.to : l.from
}

/** A channel the node really reported, or which kind of "no channel" it is. */
const channelValue = computed(() => {
  const n = props.node
  if (!n) return '—'
  const bucket = channelBucket(n)
  const key = CHANNEL_KEYS[bucket]
  return key ? t(key) : bucket
})

const reprobing = ref(false)
const reprobeError = ref(false)

/** One fresh ICMP verdict for this node; the push updates the row underneath. */
async function reprobe() {
  const host = props.node?.hostname
  if (!host || reprobing.value) return
  reprobing.value = true
  reprobeError.value = false
  try {
    await $fetch(`${apiBase()}/probe`, { method: 'POST', body: { host } })
  } catch {
    reprobeError.value = true
  } finally {
    reprobing.value = false
  }
}

function stamp(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(locale.value, { hour12: false })
}
</script>

<template>
  <aside
    v-if="node"
    class="scroll-thin fixed right-3 top-24 z-50 max-h-[calc(100vh-7rem)] w-[min(24rem,calc(100vw-1.5rem))] overflow-auto rounded-xl border bg-base-200/95 shadow-2xl backdrop-blur"
    :style="{ borderColor: bandColor(node.band) }"
  >
    <div class="flex items-start justify-between gap-2 border-b border-base-300 p-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <i class="h-3 w-3 rounded-full" :style="{ backgroundColor: bandColor(node.band) }" />
          <h3 class="truncate text-sm font-bold" :title="node.name">{{ node.name }}</h3>
        </div>
        <div class="mt-1 flex flex-wrap gap-1 text-[10px]">
          <span class="badge badge-xs" :style="{ backgroundColor: BAND_COLORS[node.band], color: '#0b1120' }">
            {{ t('band.' + node.band) }}
          </span>
          <span class="badge badge-xs" :class="node.online ? 'badge-success' : probeSeen(node) ? 'badge-error' : 'badge-ghost'">
            {{ node.online ? t('state.online') : probeSeen(node) ? t('state.offline') : t('state.unprobed') }}
          </span>
          <span class="badge badge-ghost badge-xs">hop {{ hopDepth(node) ?? '—' }}</span>
          <span class="badge badge-ghost badge-xs">etx {{ fmt(node.etx) }}</span>
          <span v-if="grid" class="badge badge-ghost badge-xs font-mono" :title="t('drawer.gridTitle')">{{ grid }}</span>
        </div>
      </div>
      <button class="btn btn-xs btn-ghost" :aria-label="t('common.close')" @click="emit('close')">✕</button>
    </div>

    <div class="space-y-3 p-3 text-xs">
      <p v-if="node.description" class="rounded bg-base-300/40 p-2 leading-relaxed">{{ node.description }}</p>

      <div class="grid grid-cols-2 gap-x-3 gap-y-1">
        <span class="opacity-60">{{ t('drawer.hardware') }}</span><span class="truncate" :title="node.hardware">{{ node.hardware || '—' }}</span>
        <span class="opacity-60">{{ t('drawer.firmware') }}</span><span class="font-mono">{{ node.firmware || '—' }}</span>
        <span class="opacity-60">Mesh IP</span><span class="font-mono">{{ node.mesh_ip || '—' }}</span>
        <span class="opacity-60">{{ t('drawer.channel') }}</span><span class="tabular">{{ channelValue }}</span>
        <span class="opacity-60">{{ t('drawer.freqRange') }}</span><span class="tabular">{{ freqRange }}</span>
        <span class="opacity-60">{{ t('drawer.bandwidth') }}</span><span class="tabular">{{ fmt(node.chan_bw, ' MHz') }}</span>
        <span class="opacity-60">{{ t('drawer.txPower') }}</span><span class="tabular">{{ fmt(node.tx_power_dbm, ' dBm') }}</span>
        <span class="opacity-60">{{ t('drawer.antenna') }}</span><span class="truncate" :title="node.antenna">{{ node.antenna || '—' }}</span>
        <span class="opacity-60">{{ t('drawer.azimuth') }}</span><span class="tabular">{{ fmt(node.azimuth, '°') }}</span>
        <span class="opacity-60">{{ t('drawer.height') }}</span><span class="tabular">{{ fmt(node.height_m, ' m') }}</span>
        <span class="opacity-60">SSID</span><span class="truncate font-mono">{{ node.ssid || '—' }}</span>
        <span class="opacity-60">{{ t('drawer.maxLink') }}</span><span class="tabular">{{ fmt(node.max_dist_miles, ' mi') }}</span>
      </div>

      <div class="divider my-1" />

      <div>
        <div class="flex items-baseline justify-between gap-2">
          <span class="opacity-60">{{ t('drawer.location') }}</span>
          <span v-if="grid" class="font-mono text-sm font-semibold tracking-wide">{{ grid }}</span>
          <span v-else class="text-xs opacity-40">{{ t('drawer.noLocation') }}</span>
        </div>
        <p v-if="grid && coords" class="mt-0.5 text-right font-mono text-[10px] tabular opacity-50">
          WGS-84 {{ coords }} · {{ gridFromNode ? t('drawer.gridReported') : t('drawer.gridComputed') }}
        </p>
      </div>

      <div class="divider my-1" />

      <div class="grid grid-cols-2 gap-x-3 gap-y-1">
        <span class="opacity-60">{{ t('drawer.latency') }}</span><span class="tabular">{{ fmt(latencyMs(node), ' ms') }}</span>
        <span class="opacity-60">{{ t('drawer.loss') }}</span><span class="tabular">{{ fmt(lossPct(node), '%') }}</span>
        <span class="opacity-60">{{ t('drawer.jitter') }}</span><span class="tabular">{{ fmt(node.jitter_ms, ' ms') }}</span>
        <span class="opacity-60">{{ t('drawer.packets') }}</span><span class="tabular">{{ fmt(node.packets_recv) }} / {{ fmt(node.packets_sent) }}</span>
        <span class="opacity-60">babel</span>
        <span class="tabular">metric {{ fmt(node.babel_metric) }} · routes {{ fmt(node.babel_routes) }}</span>
        <span class="opacity-60">{{ t('drawer.lastProbe') }}</span>
        <span class="flex items-center justify-end gap-2">
          <span class="tabular">{{ stamp(node.probed_at) }}</span>
          <button class="btn btn-xs border border-base-300" :disabled="reprobing" @click="reprobe">
            <span v-if="reprobing" class="loading loading-spinner loading-xs" />
            {{ t(reprobing ? 'drawer.reprobing' : 'drawer.reprobe') }}
          </button>
        </span>
        <span class="opacity-60">{{ t('drawer.source') }}</span><span>{{ node.source }} · {{ node.detail_fetched ? t('drawer.detailYes') : t('drawer.detailNo') }}</span>
      </div>

      <p v-if="reprobeError" class="rounded bg-error/10 p-2 text-[10px] text-error">{{ t('drawer.reprobeError') }}</p>

      <p v-if="node.probe_error" class="break-all rounded bg-error/10 p-2 text-[10px] text-error">{{ node.probe_error }}</p>

      <template v-if="services.length">
        <div class="divider my-1" />
        <div>
          <span class="opacity-60">{{ t('drawer.services') }}</span>
          <ul class="mt-1 space-y-0.5">
            <li v-for="s in services" :key="s" class="truncate font-mono text-[10px]">• {{ s }}</li>
          </ul>
        </div>
      </template>

      <template v-if="node.local_devices?.length">
        <div>
          <span class="opacity-60">{{ t('drawer.lanHosts') }}</span>
          <ul class="mt-1 space-y-0.5">
            <li v-for="d in node.local_devices" :key="d.ip" class="font-mono text-[10px]">
              {{ d.ip }} · {{ d.hostname }} <span class="opacity-50">{{ d.model }}</span>
            </li>
          </ul>
        </div>
      </template>

      <div class="divider my-1" />

      <div>
        <h4 class="mb-1 flex items-center justify-between">
          <span class="opacity-60">{{ t('drawer.neighbors', { n: links.length }) }}</span>
        </h4>
        <table class="table table-xs">
          <thead>
            <tr>
              <th>{{ t('drawer.thNeighbor') }}</th><th>{{ t('drawer.thType') }}</th><th class="text-right">SNR</th>
              <th class="text-right">LQ%</th><th class="text-right">ETX</th><th class="text-right">{{ t('drawer.thDistance') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="l in links"
              :key="l.from + l.to + l.ip"
              class="cursor-pointer hover:bg-base-300/40"
              @click="emit('select', peerOf(l))"
            >
              <td class="max-w-[8rem] truncate font-mono text-[10px]">{{ peerOf(l) }}</td>
              <td>
                <span
                  class="badge badge-xs"
                  :style="{
                    backgroundColor: l.type === 'RF' ? bandColor(l.band) : l.type === 'DtD' ? '#64748b' : '#14b8a6',
                    color: '#0b1120',
                  }"
                >
                  {{ l.type }}
                </span>
              </td>
              <td class="text-right tabular">{{ l.local_snr ?? linkFor(l.from)?.local_snr ?? '—' }}</td>
              <td class="text-right tabular">{{ l.rx_success_pct ?? '—' }}</td>
              <td class="text-right tabular">{{ l.etx ?? '—' }}</td>
              <td class="text-right tabular">{{ l.distance_mi != null ? l.distance_mi + ' mi' : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid gap-1 pt-1">
        <a class="btn btn-xs btn-primary" :href="`http://${node.hostname}.local.mesh`" target="_blank" rel="noreferrer">
          {{ t('drawer.openNode', { host: node.hostname }) }}
        </a>
        <div class="grid grid-cols-2 gap-1">
          <a class="btn btn-xs border border-base-300" :href="`http://${node.hostname}.local.mesh/a/status`" target="_blank" rel="noreferrer">
            {{ t('drawer.nodeStatus') }}
          </a>
          <a
            v-if="node.has_location"
            class="btn btn-xs border border-base-300"
            :href="`https://worldmap.arednmesh.org/#14/${node.lat.toFixed(5)}/${node.lon.toFixed(5)}`"
            target="_blank"
            rel="noreferrer"
          >
            {{ t('drawer.worldmap') }}
          </a>
        </div>
      </div>
    </div>
  </aside>
</template>
