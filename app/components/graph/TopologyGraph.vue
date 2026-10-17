<script setup lang="ts">
import type { Simulation, SimulationNodeDatum } from 'd3-force'
import type { MeshLink, TopologyNode } from '~/types'
import { BAND_COLORS, hopDepth, latencyMs } from '~/types'
import { linkLive } from '~/composables/useMeshStore'
import LinkCard from '../LinkCard.vue'

interface GNode extends SimulationNodeDatum {
  id: string
  name: string
  band: string
  color: string
  r: number
  degree: number
  is_supernode: boolean
  online: boolean
  hops: number | null
  etx: number | null
  latency_ms: number | null
}
/** MeshLink with d3's grafted endpoints. */
type GLink = MeshLink & { source: GNode | string; target: GNode | string }

const props = defineProps<{
  nodes: TopologyNode[]
  links: MeshLink[]
  selected: string | null
  layout: 'force' | 'radial'
  snrByNode: Map<string, number | null>
}>()

const emit = defineEmits<{ (e: 'select', name: string | null): void; (e: 'detail', name: string): void }>()
const { t } = useLang()

const canvas = ref<HTMLCanvasElement | null>(null)
const wrap = ref<HTMLDivElement | null>(null)
const hover = ref<{ x: number; y: number; node: GNode } | null>(null)
const stats = ref({ nodes: 0, links: 0, alpha: 0 })
/** Open wire, keyed `from|to|mac`: glinks are rebuilt on every data change. */
const selectedKey = ref<string | null>(null)
const wireKey = (l: { from: string; to: string; mac: string }) => l.from + '\u0000' + l.to + '\u0000' + l.mac
const selectedLink = computed(() => {
  const k = selectedKey.value
  return k ? props.links.find(l => wireKey(l) === k) ?? null : null
})
const nameOf = (id: string) => props.nodes.find(n => n.id === id)?.name ?? id
const d3Ready = ref(false)

const view = { k: 1, x: 0, y: 0 }
let ctx: CanvasRenderingContext2D | null = null
let sim: Simulation<GNode, undefined> | null = null
let d3: typeof import('d3-force') | null = null
let gnodes: GNode[] = []
let glinks: GLink[] = []
const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>()
let connected = new Set<string>()
let rafDraw = 0
let pointer: { mode: 'none' | 'pan' | 'node'; sx: number; sy: number; moved: number; node: GNode | null } = {
  mode: 'none',
  sx: 0,
  sy: 0,
  moved: 0,
  node: null,
}

const LINK_COLOR: Record<string, string> = { RF: '#3b82f6', DtD: '#64748b', Wireguard: '#14b8a6' }

// ---------------------------------------------------------------- hop shells
// Most nodes report no hop count, so unknown hops fill an annulus rather than one ring.
const SHELL_INNER = 96
let shellCount = 1
let shellStep = 72

const UNKNOWN_BAND = 6
function isUnknown(hops: number | null) {
  return hops === null
}
function measureShells(nodes: TopologyNode[]) {
  let maxKnown = 0
  for (const n of nodes) {
    const h = hopDepth(n)
    if (h !== null && h > maxKnown) maxKnown = h
  }
  // The unknown band sits outside every known hop, so it needs radius budget.
  shellCount = maxKnown + 1 + UNKNOWN_BAND
  const budget = 120 + Math.sqrt(Math.max(1, nodes.length)) * 46
  shellStep = Math.max(10, (budget - SHELL_INNER) / shellCount)
}
/** Known hops are rings; unknown hops spread over an annulus. */
function shellRadius(hops: number | null, i: number) {
  const frac = (i * 0.6180339887) % 1
  if (isUnknown(hops)) return SHELL_INNER + (shellCount - UNKNOWN_BAND) * shellStep + frac * UNKNOWN_BAND * shellStep
  const h = Math.max(0, hops ?? 0)
  return SHELL_INNER + (h + 1) * shellStep + (frac - 0.5) * shellStep * 0.8
}

function radiusOf(n: TopologyNode, degree: number) {
  if (n.is_supernode) return 7
  return Math.min(9, 2.5 + Math.sqrt(degree) * 0.9)
}

/** Screen pixels to world units. */
function toWorld(px: number, py: number) {
  return { x: (px - view.x) / view.k, y: (py - view.y) / view.k }
}

function buildGraph() {
  const degree = new Map<string, number>()
  for (const l of props.links) {
    degree.set(l.from, (degree.get(l.from) ?? 0) + 1)
    degree.set(l.to, (degree.get(l.to) ?? 0) + 1)
  }
  const ids = new Set(props.nodes.map(n => n.id))
  measureShells(props.nodes)
  gnodes = props.nodes.map((n, i) => {
    const kept = pos.get(n.id)
    const angle = (i * 2.399963229728653) % (Math.PI * 2)
    const ring = shellRadius(hopDepth(n), i)
    const node: GNode = {
      id: n.id,
      name: n.name,
      band: n.band,
      color: n.color || BAND_COLORS[n.band as keyof typeof BAND_COLORS] || '#94a3b8',
      r: radiusOf(n, degree.get(n.id) ?? 0),
      degree: degree.get(n.id) ?? 0,
      is_supernode: n.is_supernode,
      online: n.online,
      hops: n.hops,
      etx: n.etx,
      latency_ms: n.latency_ms,
      x: kept?.x ?? Math.cos(angle) * ring,
      y: kept?.y ?? Math.sin(angle) * ring,
      vx: kept?.vx ?? 0,
      vy: kept?.vy ?? 0,
    }
    return node
  })
  glinks = props.links
    .filter(l => ids.has(l.from) && ids.has(l.to))
    .map(l => ({
      ...l,
      source: l.from,
      target: l.to,
    }))
  connected = new Set<string>()
  if (props.selected) {
    connected.add(props.selected)
    for (const l of glinks) {
      const s = typeof l.source === 'string' ? l.source : l.source.id
      const t = typeof l.target === 'string' ? l.target : l.target.id
      if (s === props.selected) connected.add(t)
      if (t === props.selected) connected.add(s)
    }
  }
}

function forces() {
  if (!d3 || !sim) return
  sim.force('charge', d3.forceManyBody<GNode>().strength(props.layout === 'radial' ? -14 : -26).theta(0.9))
  sim
    .force(
      'link',
      d3
        .forceLink<GNode, GLink>(glinks)
        .id(d => d.id)
        .distance(l => {
          if (l.type === 'Wireguard') return 90
          if (l.type === 'DtD') return 46
          return 34 + Math.min(90, (l.distance_mi ?? 0) * 1.6)
        })
        .strength(props.layout === 'radial' ? 0.12 : 0.45),
    )
    .force('center', d3.forceCenter(0, 0).strength(0.04))
    .force('collide', d3.forceCollide<GNode>(d => d.r + 1.2).iterations(1))
  if (props.layout === 'radial') {
    sim.force(
      'radial',
      d3
        .forceRadial<GNode>((d, i) => shellRadius(hopDepth(d), i), 0, 0)
        .strength(0.85),
    )
  } else {
    sim.force('radial', null)
  }
}

function rebuild(run = true) {
  if (!d3) return
  buildGraph()
  if (!sim) sim = d3.forceSimulation<GNode>(gnodes)
  else sim.nodes(gnodes)
  forces()
  sim.on('tick', () => {
    for (const n of gnodes) pos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, vx: n.vx ?? 0, vy: n.vy ?? 0 })
    draw()
    stats.value = { nodes: gnodes.length, links: glinks.length, alpha: Math.round((sim.alpha()) * 100) / 100 }
  })
  stats.value = { nodes: gnodes.length, links: glinks.length, alpha: 0 }
  if (run) sim.alpha(0.9).restart()
  // Paint once here too: the simulation timer rides on requestAnimationFrame.
  draw()
}

// ---------------------------------------------------------------- renderer
function draw() {
  if (!ctx || !canvas.value) return
  const w = canvas.value.clientWidth
  const h = canvas.value.clientHeight
  const dpr = window.devicePixelRatio || 1
  if (canvas.value.width !== Math.round(w * dpr) || canvas.value.height !== Math.round(h * dpr)) {
    canvas.value.width = Math.round(w * dpr)
    canvas.value.height = Math.round(h * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.save()
  ctx.translate(view.x, view.y)
  ctx.scale(view.k, view.k)

  const focus = props.selected
  // --- links
  ctx.lineCap = 'butt'
  for (const l of glinks) {
    const s = l.source as GNode
    const t = l.target as GNode
    if (!s?.x || !t?.x) continue
    const isActive = focus && (s.id === focus || t.id === focus)
    const dim = focus && !isActive
    const base = l.type === 'RF' ? 1.7 : l.type === 'DtD' ? 1.15 : 0.85
    const etxBoost = l.etx ? Math.max(0.35, 2.6 - l.etx) : 0.6
    // Dash already carries the link type, so a down link is faded, not re-patterned.
    const live = linkLive(l)
    ctx.globalAlpha = (dim ? 0.06 : isActive ? 0.95 : 0.34) * (live ? 1 : 0.3)
    ctx.lineWidth = Math.min(4.5, base * (0.6 + etxBoost * 0.35)) / Math.max(0.6, Math.min(view.k, 2))
    ctx.strokeStyle = l.type === 'RF' ? s.color || LINK_COLOR.RF! : LINK_COLOR[l.type] || LINK_COLOR.RF!
    ctx.setLineDash(l.type === 'RF' ? [] : l.type === 'DtD' ? [7, 5] : [1.5, 3.5])
    ctx.beginPath()
    ctx.moveTo(s.x ?? 0, s.y ?? 0)
    ctx.lineTo(t.x ?? 0, t.y ?? 0)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // The open wire on top, in the selected node's amber.
  const openWire = selectedKey.value ? glinks.find(g => wireKey(g) === selectedKey.value) : undefined
  if (openWire) {
    const s = openWire.source as GNode
    const t = openWire.target as GNode
    if (s?.x != null && t?.x != null) {
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 2.6 / Math.max(0.6, Math.min(view.k, 2))
      ctx.beginPath()
      ctx.moveTo(s.x, s.y ?? 0)
      ctx.lineTo(t.x, t.y ?? 0)
      ctx.stroke()
    }
  }

  // --- nodes
  for (const n of gnodes) {
    if (n.x == null || n.y == null) continue
    const isFocus = n.id === focus
    const dim = focus && !isFocus && !connected.has(n.id)
    ctx.globalAlpha = dim ? 0.16 : 1
    ctx.beginPath()
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
    ctx.fillStyle = n.color
    ctx.fill()
    // A hole means probed with no answer; an unprobed node stays solid.
    if (!n.online && n.probed) {
      ctx.globalAlpha = dim ? 0.16 : 0.75
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r * 0.55, 0, Math.PI * 2)
      ctx.fill()
    }
    if (n.is_supernode) {
      ctx.globalAlpha = dim ? 0.2 : 1
      ctx.strokeStyle = '#f8fafc'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r + 1.6, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (isFocus) {
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r + 5, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // --- labels above a usable zoom
  if (view.k > 0.75) {
    ctx.globalAlpha = 1
    ctx.fillStyle = '#e2e8f0'
    ctx.font = `${11 / Math.max(0.8, view.k)}px ui-monospace, SFMono-Regular, monospace`
    const labeled = focus
      ? gnodes.filter(n => n.id === focus || connected.has(n.id)).slice(0, 60)
      : gnodes.filter(n => n.is_supernode || n.degree > 9).slice(0, 90)
    for (const n of labeled) {
      if (n.x == null || n.y == null) continue
      ctx.fillText(n.name, (n.x ?? 0) + n.r + 2, n.y)
    }
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

function scheduleDraw() {
  if (rafDraw) return
  rafDraw = requestAnimationFrame(() => {
    rafDraw = 0
    draw()
  })
}

function hitTest(px: number, py: number): GNode | null {
  const { x, y } = toWorld(px, py)
  let best: GNode | null = null
  let bestD = Infinity
  const tol = 6 / view.k
  for (const n of gnodes) {
    if (n.x == null || n.y == null) continue
    const d = Math.hypot(n.x - x, n.y - y)
    if (d < n.r + tol && d < bestD) {
      best = n
      bestD = d
    }
  }
  return best
}

/** Nearest wire to a screen point; nodes win wherever both match. */
function hitWire(px: number, py: number): GLink | null {
  const { x, y } = toWorld(px, py)
  const tol = 6 / view.k
  let best: GLink | null = null
  let bestD = Infinity
  for (const l of glinks) {
    const s = l.source as GNode
    const t = l.target as GNode
    if (s?.x == null || t?.x == null) continue
    const d = pointToSegment(x, y, s.x, s.y ?? 0, t.x, t.y ?? 0)
    if (d <= tol && d < bestD) {
      bestD = d
      best = l
    }
  }
  return best
}

function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// ---------------------------------------------------------------- interaction
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const rect = canvas.value!.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const k0 = view.k
  const k1 = Math.max(0.08, Math.min(12, k0 * Math.exp(-e.deltaY * 0.0018)))
  view.x = px - ((px - view.x) / k0) * k1
  view.y = py - ((py - view.y) / k0) * k1
  view.k = k1
  scheduleDraw()
}

function onPointerDown(e: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const node = hitTest(px, py)
  pointer = { mode: node ? 'node' : 'pan', sx: px, sy: py, moved: 0, node }
  canvas.value?.setPointerCapture?.(e.pointerId)
  if (node && sim) {
    node.fx = node.x
    node.fy = node.y
    sim.alphaTarget(0.25).restart()
  }
}

function onPointerMove(e: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  if (pointer.mode === 'pan') {
    view.x += px - pointer.sx
    view.y += py - pointer.sy
    pointer.moved += Math.abs(px - pointer.sx) + Math.abs(py - pointer.sy)
    pointer.sx = px
    pointer.sy = py
    scheduleDraw()
  } else if (pointer.mode === 'node' && pointer.node) {
    const w = toWorld(px, py)
    pointer.node.fx = w.x
    pointer.node.fy = w.y
    pointer.moved += 1
  } else {
    const node = hitTest(px, py)
    hover.value = node ? { x: px, y: py, node } : null
    canvas.value!.style.cursor = node ? 'pointer' : 'grab'
  }
}

function onPointerUp(e: PointerEvent) {
  if (pointer.mode === 'node' && pointer.node) {
    pointer.node.fx = null
    pointer.node.fy = null
    sim?.alphaTarget(0)
  }
  // Under 4 px of movement counts as a click.
  const clicked = pointer.moved < 4
  if (clicked) {
    const rect = canvas.value!.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const node = hitTest(px, py)
    if (node) {
      selectedKey.value = null
      emit('select', node.id)
    } else {
      const wire = hitWire(px, py)
      // A wire opens or closes its own card and leaves the node selection alone.
      if (wire) {
        const k = wireKey(wire)
        selectedKey.value = selectedKey.value === k ? null : k
      } else {
        selectedKey.value = null
        emit('select', null)
      }
    }
  }
  pointer = { mode: 'none', sx: 0, sy: 0, moved: 0, node: null }
}

function onDoubleClick() {
  if (hover.value) emit('detail', hover.value.node.id)
}

function fit() {
  if (!gnodes.length || !canvas.value) return
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const n of gnodes) {
    minX = Math.min(minX, n.x ?? 0)
    maxX = Math.max(maxX, n.x ?? 0)
    minY = Math.min(minY, n.y ?? 0)
    maxY = Math.max(maxY, n.y ?? 0)
  }
  const w = canvas.value.clientWidth
  const h = canvas.value.clientHeight
  const k = Math.max(0.08, Math.min(4, 0.86 * Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1))))
  view.k = k
  view.x = w / 2 - ((minX + maxX) / 2) * k
  view.y = h / 2 - ((minY + maxY) / 2) * k
  scheduleDraw()
}

function reheat() {
  sim?.alpha(0.8).restart()
}

let ro: ResizeObserver | null = null

onMounted(async () => {
  // d3-force loads at runtime so the prerender pass never evaluates it server-side.
  d3 = await import('d3-force')
  d3Ready.value = true
  ctx = canvas.value?.getContext('2d') ?? null
  rebuild()
  ro = new ResizeObserver(() => scheduleDraw())
  if (wrap.value) ro.observe(wrap.value)
  window.setTimeout(fit, 1400)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  sim?.stop()
  sim = null
})

watch(
  () => [props.nodes, props.links],
  () => rebuild(),
)
// The amber overlay is canvas ink, so a card change needs its own repaint.
watch(selectedKey, () => draw())
watch(
  () => props.layout,
  () => {
    forces()
    sim?.alpha(0.7).restart()
  },
)
watch(
  () => props.selected,
  () => {
    connected = new Set<string>([...(props.selected ? [props.selected] : [])])
    if (props.selected) {
      for (const l of glinks) {
        const s = l.source as GNode
        const t = l.target as GNode
        if (s?.id === props.selected) connected.add(t?.id)
        if (t?.id === props.selected) connected.add(s?.id)
      }
    }
    draw()
  },
)
</script>

<template>
  <div ref="wrap" class="relative h-full w-full">
    <canvas
      ref="canvas"
      class="h-full w-full touch-none rounded-lg bg-base-300/20"
      style="cursor: grab"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="hover = null"
      @dblclick="onDoubleClick"
    />

    <div v-if="!d3Ready" class="absolute inset-0 flex items-center justify-center text-sm opacity-70">
      {{ t('graph.loading') }}
    </div>

    <div class="absolute left-2 top-2 z-20 flex flex-wrap gap-1.5 text-[10px]">
      <span class="badge gap-1 border border-base-300 bg-base-100/85 text-base-content backdrop-blur">
        {{ t('linkType.RF') }} <i class="inline-block h-0.5 w-5" style="background: #3b82f6"
      /></span>
      <span class="badge gap-1 border border-base-300 bg-base-100/85 text-base-content backdrop-blur">
        {{ t('linkType.DtD') }} <i class="inline-block h-0.5 w-5 dashes" style="background: repeating-linear-gradient(90deg, #64748b 0 5px, transparent 5px 9px)"
      /></span>
      <span class="badge gap-1 border border-base-300 bg-base-100/85 text-base-content backdrop-blur">
        {{ t('linkType.Wireguard') }}
        <i
          class="inline-block h-0.5 w-5"
          style="background: repeating-linear-gradient(90deg, #14b8a6 0 2px, transparent 2px 6px)"
        />
      </span>
    </div>

    <div class="absolute right-2 top-2 z-20 flex gap-1">
      <button class="btn btn-xs border border-base-300 bg-base-200/80" @click="fit">{{ t('graph.fit') }}</button>
      <button class="btn btn-xs border border-base-300 bg-base-200/80" @click="reheat">{{ t('graph.relayout') }}</button>
    </div>

    <div class="absolute bottom-2 left-2 z-20 flex flex-wrap gap-1 text-[10px]">
      <span
        v-for="b in Object.keys(BAND_COLORS)"
        :key="b"
        class="badge badge-xs border-0 bg-base-200/80 text-base-content"
      >
        <i class="h-2 w-2 rounded-full" :style="{ backgroundColor: BAND_COLORS[b as keyof typeof BAND_COLORS] }" />
        {{ t('band.' + b) }}
      </span>
    </div>

    <LinkCard v-if="selectedLink" :link="selectedLink" :resolve-name="nameOf" @close="selectedKey = null" />

    <div class="absolute right-2 bottom-2 z-20 text-[10px] tabular opacity-70">
      {{ t('graph.nodesCount', { n: stats.nodes }) }} · {{ t('graph.linksCount', { n: stats.links }) }} · α {{ stats.alpha }} · {{ t('graph.zoom', { k: view.k.toFixed(2) }) }}
    </div>

    <div
      v-if="hover"
      class="pointer-events-none absolute z-30 w-52 rounded-lg border border-base-300 bg-base-200/95 p-2 text-[11px] shadow-xl"
      :style="{ left: `${Math.min(hover.x + 14, (wrap?.clientWidth ?? 300) - 220)}px`, top: `${hover.y + 14}px` }"
    >
      <div class="flex items-center gap-1 font-bold">
        <i class="h-2 w-2 rounded-full" :style="{ backgroundColor: hover.node.color }" />
        <span class="truncate">{{ hover.node.name }}</span>
      </div>
      <div class="mt-1 grid grid-cols-2 gap-x-2 text-[10px]">
        <span class="opacity-60">{{ t('graph.band') }}</span><span>{{ t('band.' + hover.node.band) }}</span>
        <span class="opacity-60">SNR</span><span class="tabular">{{ snrByNode.get(hover.node.id) ?? '—' }}</span>
        <span class="opacity-60">{{ t('graph.latency') }}</span><span class="tabular">{{ latencyMs(hover.node) != null ? latencyMs(hover.node) + ' ms' : '—' }}</span>
        <span class="opacity-60">{{ t('graph.hopsEtx') }}</span><span class="tabular">{{ hopDepth(hover.node) ?? '—' }} / {{ hover.node.etx || '—' }}</span>
        <span class="opacity-60">{{ t('graph.degree') }}</span><span class="tabular">{{ hover.node.degree }}</span>
        <span class="opacity-60">{{ t('graph.state') }}</span>
        <span>{{ hover.node.online ? t('state.online') : hover.node.probed ? t('state.offline') : t('state.unprobed') }}</span>
      </div>
      <p class="mt-1 text-[9px] opacity-50">{{ t('graph.hint') }}</p>
    </div>
  </div>
</template>
