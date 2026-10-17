<script setup lang="ts">
import type { MeshLink, MeshNode } from '~/types'
import { BAND_COLORS, probeSeen } from '~/types'
import { linkLive, nodeId, useFilters } from '~/composables/useMeshStore'
import { backendConfig, pick } from '~/composables/useBackendConfig'
import { loadAmap } from '~/composables/useAmap'
import { clearPrefs, loadPrefs, savePrefs } from '~/composables/usePrefs'
import {
  copyOf,
  drawDots,
  drawHeat,
  drawLines,
  meanLon,
  unwrapLon,
  type Camera,
  type DotState,
  type Frame,
  type HitTarget,
  type LineHit,
  hitLine,
  type LineItem,
} from '~/utils/mapDraw'

const props = defineProps<{
  nodes: MeshNode[]
  links: MeshLink[]
  selected: string | null
}>()

const emit = defineEmits<{ (e: 'select', name: string | null): void }>()

const appCfg = useAppConfig()
const { isDark } = useTheme()
const { t } = useLang()

// The key comes from /api/config; app config only sets the opening view.
const amapKey = ref('')
const amapCode = ref('')
const mapView = ref({ lat: appCfg.map.lat as number, lon: appCfg.map.lon as number, zoom: appCfg.map.zoom as number })

const phase = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const message = ref('')

const prefs = loadPrefs()
const host = ref<HTMLDivElement | null>(null)
const overlay = ref<HTMLCanvasElement | null>(null)
const selPin = ref<{ x: number; y: number } | null>(null)
const selectedLink = ref<{ id: string; link: MeshLink } | null>(null)
const linkMode = ref(prefs.linkMode ?? false)
const leafCount = ref(0)
const renderMode = ref<'dot' | 'heat'>('dot')
const zoomLabel = ref('—')
const heatBelowZoom = ref(prefs.heatBelowZoom ?? 6)

watch([linkMode, heatBelowZoom], () => savePrefs({ linkMode: linkMode.value, heatBelowZoom: heatBelowZoom.value }))

/** Reset to defaults and drop everything remembered. */
function resetControls() {
  linkMode.value = false
  heatBelowZoom.value = DEFAULT_HEAT_BELOW
  clearPrefs()
}

const { nodeById } = useFilters()

let AMAP: any = null
let map: any = null
let ro: ResizeObserver | null = null
let loop = 0
let camKey = ''
let dirty = true
let ctx: CanvasRenderingContext2D | null = null
let scratch: HTMLCanvasElement | null = null
let hits: HitTarget[] = []
let lineHits: LineHit[] = []
let linkById = new Map<string, MeshLink>()
let pointerDown: { x: number; y: number } | null = null

// AMap's official dark style; no colour filter over the tiles.
const styleFor = (dark: boolean) => `amap://styles/${dark ? 'dark' : 'normal'}`
/** AMap's minimum zoom, and the default dot/heat switch point. */
const MIN_ZOOM = 2
const DEFAULT_HEAT_BELOW = 6

// ---------------------------------------------------------------- coordinate rules
// AMap renders GCJ-02; AREDN publishes WGS-84. Prefer the converted pair.
function coords(n: MeshNode) {
  const gcjEmpty = n.gcj_lat === 0 && n.gcj_lon === 0
  if (n.has_location && gcjEmpty) return { lat: n.lat, lon: n.lon, fellBack: true }
  return { lat: n.gcj_lat, lon: n.gcj_lon, fellBack: false }
}

function clearOverlay() {
  hits = []
  ctx?.clearRect(0, 0, host.value?.clientWidth ?? 0, host.value?.clientHeight ?? 0)
}

function camera(): Camera | null {
  if (!map) return null
  const c = map.getCenter()
  return { lat: c.getLat(), lon: c.getLng(), zoom: map.getZoom() }
}

/** One frame of geometry, measured through the map's container projection. */
function frameOf(cam: Camera, width: number, height: number): Frame {
  const at = (lat: number, lon: number) => {
    // AMap takes [lng, lat], the opposite of the pair used everywhere else here.
    const p = map.lngLatToContainer(new AMAP.LngLat(lon, lat))
    return { x: p.x, y: p.y }
  }
  // Wrap period measured off the map, not from a tile formula.
  const step = cam.lon > 179 ? -1 : 1
  const world = Math.abs(at(cam.lat, cam.lon + step).x - at(cam.lat, cam.lon).x) * 360
  return { project: at, world, width, height }
}

/** Backing store in device pixels; drawing stays in CSS pixels. */
function sizeOverlay() {
  const el = host.value
  const cv = overlay.value
  if (!el || !cv) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, el.clientWidth)
  const h = Math.max(1, el.clientHeight)
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  cv.style.width = w + 'px'
  cv.style.height = h + 'px'
  ctx = cv.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

/** One pass over the data, drawn in the world copy the camera is looking at. */
function renderOverlay() {
  const el = host.value
  const cam = camera()
  if (!ctx || !el || !cam) return
  const width = el.clientWidth
  const height = el.clientHeight
  const f = frameOf(cam, width, height)
  ctx.clearRect(0, 0, width, height)

  const positioned = props.nodes.filter(n => n.has_location)
  const wantHeat = cam.zoom < heatBelowZoom.value
  // Paint order: density, then lines, then nodes.
  if (wantHeat) {
    if (!scratch) scratch = document.createElement('canvas')
    drawHeat(
      ctx,
      positioned.map(n => ({ lat: coords(n).lat, lon: coords(n).lon, weight: n.online ? 3 : 1 })),
      f,
      scratch,
    )
    hits = []
  }
  if (linkMode.value) {
    // RF widest, WireGuard thinnest.
    const LINK_COLORS: Record<string, string> = { RF: '#3b82f6', DtD: '#64748b', Wireguard: '#14b8a6' }
    const byId = nodeById.value
    const lines: LineItem[] = []
    const byWire = new Map<string, MeshLink>()
    for (const l of props.links) {
      const a = byId.get(l.from)
      const b = byId.get(l.to)
      if (!a?.has_location || !b?.has_location) continue
      const ca = coords(a)
      const cb = coords(b)
      // Direction is part of the identity: each side reports its own SNR and ETX.
      const id = `${l.from}|${l.to}|${l.type}`
      byWire.set(id, l)
      lines.push({ id, latA: ca.lat, lonA: ca.lon, latB: cb.lat, lonB: cb.lon, color: LINK_COLORS[l.type] ?? '#64748b', width: l.type === 'RF' ? 3 : l.type === 'DtD' ? 2 : 1, live: linkLive(l) })
    }
    lineHits = drawLines(ctx, lines, f)
    linkById = byWire
  } else {
    lineHits = []
    linkById = new Map()
  }

  if (!wantHeat) {
    hits = drawDots(
      ctx,
      positioned.map(n => {
        const c = coords(n)
        return {
          id: nodeId(n),
          lat: c.lat,
          lon: c.lon,
          color: BAND_COLORS[n.band as keyof typeof BAND_COLORS] ?? '#94a3b8',
          state: (n.disconnected ? 'disc' : n.online ? 'on' : probeSeen(n) ? 'off' : 'unprobed') as DotState,
        }
      }),
      f,
    )
  }
  renderMode.value = wantHeat ? 'heat' : 'dot'
  leafCount.value = positioned.length
  zoomLabel.value = String(Math.round(cam.zoom))
  placeSelectedPin()
}

/** Clicks are matched against the last drawn positions; a drag is not a click. */
function onPointerDown(e: PointerEvent) {
  pointerDown = { x: e.clientX, y: e.clientY }
}

function onPointerUp(e: PointerEvent) {
  const start = pointerDown
  pointerDown = null
  const el = host.value
  if (!start || !el) return
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return
  const b = el.getBoundingClientRect()
  const x = e.clientX - b.left
  const y = e.clientY - b.top
  // Nodes beat wires when both are under the pointer.
  let best: HitTarget | null = null
  let bestD = Infinity
  for (const h of hits) {
    const d = Math.hypot(h.x - x, h.y - y)
    if (d <= h.r + 2 && d < bestD) {
      bestD = d
      best = h
    }
  }
  if (best) {
    selectedLink.value = null
    emit('select', best.id === props.selected ? null : best.id)
    return
  }
  let wire: LineHit | null = null
  let wireD = Infinity
  for (const h of lineHits) {
    const d = hitLine(h, x, y)
    if (d <= 4 && d < wireD) {
      wireD = d
      wire = h
    }
  }
  if (wire) {
    const l = linkById.get(wire.id)
    if (!l) return
    selectedLink.value = selectedLink.value?.id === wire.id ? null : { id: wire.id, link: l }
    return
  }
  // Clicking empty ground closes the card.
  selectedLink.value = null
}

/** Display name for either end of a wire. */
const nameOf = (id: string) => nodeById.value.get(id)?.name ?? id

function drawSelected() {
  const n = props.selected ? nodeById.value.get(props.selected) : null
  if (!n) {
    selPin.value = null
    return
  }
  const c = coords(n)
  placeSelectedPin()
  // The frame loop repaints during the pan, so the pin follows.
  try {
    map.panTo(new AMAP.LngLat(c.lon, c.lat))
  } catch {
    /* panTo unavailable — keep current view */
  }
}

/** The pin is a DOM element above the canvas, so it needs the same projection. */
function placeSelectedPin() {
  const el = host.value
  const cam = camera()
  const n = props.selected ? nodeById.value.get(props.selected) : null
  if (!el || !cam || !n || !n.has_location) {
    selPin.value = null
    return
  }
  const c = coords(n)
  const f = frameOf(cam, el.clientWidth, el.clientHeight)
  const p = f.project(c.lat, c.lon)
  selPin.value = { x: p.x + copyOf(p.x, f) * f.world, y: p.y }
}

/** Fit the filtered nodes; AMap's own fit rejects longitudes past ±180, so the span is measured in pixels. */
function fitAll() {
  // Only positioned nodes enter the box; the rest sit at 0,0.
  const list = props.nodes.filter(n => n.has_location)
  if (!list.length) return
  const cam = camera()
  const w = host.value?.clientWidth ?? 800
  const h = host.value?.clientHeight ?? 600
  if (!cam) return
  // Origin on the meridian the data sits around, so an antimeridian mesh stays contiguous.
  const origin = meanLon(list.map(n => coords(n).lon))
  let sw = { lat: 90, lon: 180 }
  let ne = { lat: -90, lon: -180 }
  for (const n of list) {
    const c = coords(n)
    const lon = unwrapLon(c.lon, origin)
    sw = { lat: Math.min(sw.lat, c.lat), lon: Math.min(sw.lon, lon) }
    ne = { lat: Math.max(ne.lat, c.lat), lon: Math.max(ne.lon, lon) }
  }
  const f = frameOf(cam, w, h)
  const pxPerDeg = f.world / 360
  const spanX = Math.max(1, (ne.lon - sw.lon) * pxPerDeg)
  const spanY = Math.max(1, Math.abs(f.project(sw.lat, cam.lon).y - f.project(ne.lat, cam.lon).y))
  const pad = 1.08
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(17, Math.floor(Math.min(Math.log2(w / (spanX * pad)), Math.log2(h / (spanY * pad))) + cam.zoom)),
  )
  map.setCenter(new AMAP.LngLat(origin, (sw.lat + ne.lat) / 2), true)
  map.setZoom(zoom, true)
  invalidate()
}

/** Camera polled per frame; the SDK's move events are too sparse to keep nodes on the tiles. */
function startLoop() {
  stopLoop()
  const poll = () => {
    const cam = camera()
    if (!cam || !ctx) return
    const key = `${cam.lat.toFixed(5)},${cam.lon.toFixed(5)},${cam.zoom.toFixed(3)}`
    if (key === camKey && !dirty) return
    camKey = key
    dirty = false
    renderOverlay()
  }
  const step = () => {
    loop = requestAnimationFrame(step)
    poll()
  }
  loop = requestAnimationFrame(step)
}

function stopLoop() {
  if (loop) cancelAnimationFrame(loop)
  loop = 0
}

function invalidate() {
  dirty = true
}

function attachResize() {
  ro?.disconnect()
  ro = new ResizeObserver(() => {
    sizeOverlay()
    invalidate()
  })
  if (host.value) ro.observe(host.value)
}

function createMap() {
  const el = host.value
  if (!AMAP || !el) return
  try {
    map = new AMAP.Map(el, {
      // AMap takes [lng, lat].
      center: new AMAP.LngLat(mapView.value.lon, mapView.value.lat),
      zoom: mapView.value.zoom,
      viewMode: '2D',
      zooms: [MIN_ZOOM, 20],
      // resizeEnable must be on or the map stops filling its card when the layout changes.
      resizeEnable: true,
      // Overseas coverage is a separate AMap capability.
      showOversea: true,
      mapStyle: styleFor(isDark.value),
    })
  } catch (err) {
    phase.value = 'error'
    message.value = t('map.initFailed')
    return
  }
  attachResize()
  sizeOverlay()
  startLoop()
  phase.value = 'ready'
}

async function loadAndCreate() {
  if (!amapKey.value || !amapCode.value) {
    phase.value = 'error'
    message.value = t('map.noKey')
    return
  }
  try {
    AMAP = await loadAmap(amapKey.value, amapCode.value)
  } catch (err) {
    phase.value = 'error'
    message.value = t('amap.' + ((err as Error & { code?: string }).code ?? 'network'))
    return
  }
  if (!host.value) return
  createMap()
}

async function boot() {
  const remote = await backendConfig()
  amapKey.value = pick(remote.amap_key, '')
  amapCode.value = pick(remote.amap_security_code, '')
  mapView.value = {
    lat: pick(remote.center_lat, mapView.value.lat),
    lon: pick(remote.center_lon, mapView.value.lon),
    zoom: pick(remote.zoom, mapView.value.zoom),
  }
  phase.value = 'loading'
  await loadAndCreate()
}

/** A theme switch restyles the map only; the camera stays where the user left it. */
function applyTheme() {
  if (!map || phase.value !== 'ready') return
  map.setMapStyle(styleFor(isDark.value))
}

onMounted(boot)
watch(isDark, applyTheme)
onBeforeUnmount(() => {
  stopLoop()
  ro?.disconnect()
  clearOverlay()
  try {
    map?.destroy()
  } catch {
    /* already gone */
  }
  map = null
})

watch(() => props.nodes, invalidate)
// Moving the threshold changes dot/heat, so re-render instead of waiting for the camera.
watch(heatBelowZoom, invalidate)
watch(() => [props.links, linkMode.value], invalidate)
watch(() => props.selected, drawSelected)
</script>

<template>
  <div class="relative h-full w-full" @pointerdown="onPointerDown" @pointerup="onPointerUp">
    <div ref="host" class="aredn-map-host h-full w-full rounded-lg bg-base-300/30"  />
    <!-- Nodes and links, drawn above the SDK surface so they can wrap worlds. -->
    <canvas ref="overlay" class="pointer-events-none absolute inset-0 z-10" />

    <!-- Never a blank box while the map loads or fails. -->
    <div
      v-if="phase !== 'ready'"
      class="tmap-fallback-grid absolute inset-0 flex items-center justify-center rounded-lg"
    >
      <div class="card max-w-md border border-base-300 bg-base-200/90 shadow">
        <div class="card-body items-center gap-2 text-center text-sm">
          <template v-if="phase === 'loading'">
            <span class="loading loading-spinner loading-md text-info" />
            <p>{{ t('map.loading') }}</p>
          </template>
          <template v-else-if="phase === 'error'">
            <span class="text-2xl">🗺️</span>
            <h3 class="font-bold">{{ t('map.unavailable') }}</h3>
            <p class="text-xs opacity-80">{{ message }}</p>
            <p class="text-xs opacity-60">{{ t('map.locatedCount', { n: nodes.filter(x => x.has_location).length }) }}</p>
            <button class="btn btn-xs" @click="boot()">{{ t('map.retry') }}</button>
          </template>
          <template v-else>
            <p class="opacity-70">{{ t('map.idle') }}</p>
          </template>
        </div>
      </div>
    </div>

    <!-- Top-left: the SDK puts its own zoom control bottom-left. -->
    <div v-if="phase === 'ready'" class="absolute left-2 top-2 z-20 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5 text-[10px]">
      <label class="badge cursor-pointer gap-1 border border-base-300 bg-base-100/85 text-base-content backdrop-blur" :title="t('map.heatTitle')">
        {{ t('map.heatBelow') }}
        <input v-model.number="heatBelowZoom" class="range range-xs w-20" max="12" min="2" step="1" type="range" />
        <span class="tabular">z{{ heatBelowZoom }}</span>
      </label>
      <label class="badge cursor-pointer gap-1 border border-base-300 bg-base-100/85 text-base-content backdrop-blur">
        <input v-model="linkMode" type="checkbox" class="checkbox checkbox-xs" /> {{ t('map.links') }}
      </label>
      <button class="btn btn-xs bg-base-200/80" :title="t('map.fitTitle')" @click="fitAll">
        {{ t('map.fitAll') }}
      </button>
      <button class="btn btn-xs bg-base-200/80" :title="t('map.resetTitle')" @click="resetControls">
        {{ t('map.reset') }}
      </button>
      <span class="badge badge-ghost border-0 text-[10px]">
        {{ t(renderMode === 'heat' ? 'map.pointsHeat' : 'map.points', { n: leafCount }) }} · zoom
        <span class="tabular">{{ zoomLabel }}</span>
      </span>
    </div>

    <!-- The pin sits on the node. -->
    <button
      v-if="phase === 'ready' && selPin"
      class="aredn-sel-pin"
      :style="{ transform: `translate3d(${selPin.x}px, ${selPin.y}px, 0)` }"
      :title="t('map.unpin')"
      @click="emit('select', null)"
    >
      <svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true">
        <path
          d="M15 2C8.4 2 3 7.3 3 13.8 3 22.3 15 38 15 38s12-15.7 12-24.2C27 7.3 21.6 2 15 2z"
          fill="#fbbf24"
          stroke="#0b1120"
          stroke-width="2"
        />
        <circle cx="15" cy="13.6" r="5" fill="#0b1120" />
        <circle cx="15" cy="13.6" r="2.2" fill="#fbbf24" />
      </svg>
    </button>

    <LinkCard
      v-if="phase === 'ready' && selectedLink"
      :link="selectedLink.link"
      :resolve-name="nameOf"
      @close="selectedLink = null"
    />

    <!-- Bottom-right: the SDK pins its logo and scale bar bottom-left. -->
    <div
      v-if="phase === 'ready'"
      class="absolute bottom-2 right-2 z-20 flex max-w-[60%] flex-wrap justify-end gap-1 text-[10px]"
    >
      <span
        v-for="b in Object.keys(BAND_COLORS)"
        :key="b"
        class="badge badge-xs gap-1 border-0 bg-base-200/80 text-base-content"
      >
        <i class="h-2 w-2 rounded-full" :style="{ backgroundColor: BAND_COLORS[b as keyof typeof BAND_COLORS] }" />
        {{ t('band.' + b) }}
      </span>
    </div>
  </div>
</template>
