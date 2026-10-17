import type { Ref } from 'vue'
import type {
  MeshLink,
  MeshNode,
  NodesPayload,
  LinksPayload,
  StatusPayload,
  TopologyNode,
  TopologyPayload,
  WsFrame,
} from '~/types'
import { BAND_COLORS, hopDepth, neverRead, probeSeen } from '~/types'

export type ViewMode = 'map' | 'graph'

/** Answered, asked-and-silent, never asked. */
export type OnlineState = 'all' | 'online' | 'offline' | 'unprobed'

/** Position published, read-but-not-published, page never read. */
export type Locality = 'all' | 'with' | 'without' | 'unread'

/** i18n key per bucket; the filter buttons and the chips share these. */
export const ONLINE_KEYS: Record<Exclude<OnlineState, 'all'>, string> = {
  online: 'onlineOpt.online',
  offline: 'onlineOpt.offline',
  unprobed: 'onlineOpt.unprobed',
}
export const LOCALITY_KEYS: Record<Exclude<Locality, 'all'>, string> = {
  with: 'locOpt.with',
  without: 'locOpt.without',
  unread: 'locOpt.unread',
}


export interface Filters {
  bands: string[]
  channels: string[]
  linkTypes: string[]
  /** Keep links the mesh reports as down. */
  showDown: boolean
  online: OnlineState
  located: Locality
  /** 0 = no hop limit. */
  maxHops: number
  q: string
}

export const emptyFilters = (): Filters => ({
  bands: [],
  channels: [],
  linkTypes: [],
  showDown: false,
  online: 'online',
  located: 'all',
  maxHops: 0,
  q: '',
})

/** Whether the mesh reports this link as carrying traffic; `idle` is still a wire. */
export function linkLive(l: { status?: string; state?: string }): boolean {
  return !(l.status === 'disconnected' || l.state === 'disconnected' || l.state === 'unused')
}

export type ConnState = 'connecting' | 'live' | 'stale' | 'down'

let socketStarted = false

/** API base: same-origin /api unless runtime config says otherwise. */
export function apiBase(): string {
  const cfg = useRuntimeConfig().public
  const base = (cfg.apiBase || '/api').replace(/\/$/, '')
  return base
}

/** Socket URL derived from the same API base. */
export function wsUrl(base: string): string {
  const clean = base.replace(/\/$/, '')
  if (/^https?:\/\//.test(clean)) {
    const u = new URL(clean)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${u.toString().replace(/\/$/, '')}/ws`
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${clean}/ws`
}

/** Module-level socket: one per page, survives view switches. */
function startStatusSocket(
  base: string,
  sink: { frame: (f: WsFrame) => void; open: (up: boolean) => void },
) {
  if (!import.meta.client || socketStarted) return
  socketStarted = true

  let sock: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let attempt = 0

  const schedule = () => {
    if (retry) return
    const wait = Math.min(15000, 1000 * 2 ** Math.min(attempt, 4))
    attempt += 1
    retry = setTimeout(() => {
      retry = null
      connect()
    }, wait)
  }

  function connect() {
    let s: WebSocket
    try {
      s = new WebSocket(wsUrl(base))
    } catch {
      schedule()
      return
    }
    sock = s
    s.onopen = () => {
      attempt = 0
      sink.open(true)
    }
    s.onmessage = ev => {
      try {
        const f = JSON.parse(String(ev.data)) as WsFrame
        if (typeof f?.rev === 'number') sink.frame(f)
      } catch {
      // Unreadable frames are skipped.
      }
    }
    s.onclose = () => {
      if (sock === s) sock = null
      sink.open(false)
      schedule()
    }
    s.onerror = () => {
      // onclose follows every error and holds the retry.
    }
  }

  connect()
}

/** Node identity: `hostname`, falling back to `name`. Links and selection carry it. */
export function nodeId(n: { hostname?: string; name: string }): string {
  return n.hostname || n.name
}

/** Edge identity `from|to|mac`. Mirrors `Link.Key()` in Go. */
function linkKey(l: MeshLink): string {
  return l.from + '\u0000' + l.to + '\u0000' + l.mac
}

/** Incoming rows replace stored ones by node id; `removed` drops rows. */
function mergeNodes(cur: MeshNode[], incoming: MeshNode[] | undefined, removed: string[] | undefined): MeshNode[] {
  if (!incoming?.length && !removed?.length) return cur
  let out = cur
  if (removed?.length) {
    const gone = new Set(removed)
    out = out.filter(n => !gone.has(nodeId(n)))
  }
  if (incoming?.length) {
    const byId = new Map(out.map(n => [nodeId(n), n]))
    for (const n of incoming) byId.set(nodeId(n), n)
    out = [...byId.values()]
  }
  return out
}

function mergeLinks(cur: MeshLink[], incoming: MeshLink[] | undefined): MeshLink[] {
  if (!incoming?.length) return cur
  const byKey = new Map(cur.map(l => [linkKey(l), l]))
  for (const l of incoming) byKey.set(linkKey(l), l)
  return [...byKey.values()]
}

/** Wire identity `min|max|type`: one physical link, either reporting side. */
function wireKey(l: MeshLink): string {
  const [a, b] = l.from < l.to ? [l.from, l.to] : [l.to, l.from]
  return a + '\u0000' + b + '\u0000' + l.type
}

/** Freshest observation wins; RFC3339 stamps compare as strings. */
function fresher(a: MeshLink, b: MeshLink): boolean {
  const sa = a.scanned_at ?? ''
  const sb = b.scanned_at ?? ''
  if (sa !== sb) return sa > sb
  return (a.last_seen ?? '') > (b.last_seen ?? '')
}

/** Graph view from the map/list rows: one edge per wire, nodes without an edge counted but not drawn. */
export function buildTopology(nodes: MeshNode[], links: MeshLink[]): TopologyPayload {
  const known = new Set(nodes.map(nodeId))
  const chosen = new Map<string, MeshLink>()
  const degree = new Map<string, number>()
  for (const l of links) {
    if (!known.has(l.from) || !known.has(l.to)) continue
    const key = wireKey(l)
    const cur = chosen.get(key)
    if (cur) {
      if (fresher(l, cur)) chosen.set(key, l)
      continue
    }
    chosen.set(key, l)
    degree.set(l.from, (degree.get(l.from) ?? 0) + 1)
    if (l.to !== l.from) degree.set(l.to, (degree.get(l.to) ?? 0) + 1)
  }

  const tnodes: TopologyNode[] = []
  let unconnected = 0
  for (const n of nodes) {
    const id = nodeId(n)
    const cnt = degree.get(id) ?? 0
    if (cnt === 0) {
      unconnected++
      continue
    }
    // Same unread-page fallback as the store's derive().
    const band = n.band || (neverRead(n) ? 'p' : 'u')
    tnodes.push({
      id,
      name: n.name,
      band,
      band_label: n.band_label,
      color: BAND_COLORS[band] ?? BAND_COLORS.u,
      is_supernode: n.is_supernode,
      hops: n.hops ?? null,
      etx: n.etx ?? null,
      online: n.online,
      probed: probeSeen(n),
      latency_ms: n.latency_ms ?? null,
      lat: n.lat,
      lon: n.lon,
      neighbor_cnt: cnt,
    })
  }
  tnodes.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'))

  const out = [...chosen.values()]
  out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.mac.localeCompare(b.mac))
  return { nodes: tnodes, links: out, generated_at: new Date().toISOString(), unconnected_nodes: unconnected }
}

function matchText(n: MeshNode, q: string) {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    n.name.toLowerCase().includes(needle) ||
    nodeId(n).toLowerCase().includes(needle) ||
    n.mesh_ip.includes(needle) ||
    (n.aliases ?? []).some(a => a.includes(needle)) ||
    (n.description ?? '').toLowerCase().includes(needle) ||
    (n.hardware ?? '').toLowerCase().includes(needle) ||
    (n.firmware ?? '').toLowerCase().includes(needle)
  )
}

/** Channel buckets: never scanned, no mesh radio, radio reported nothing. */
export const CH_UNREAD = 'p'
export const CH_NONE = 'n'
export const CH_UNKNOWN = 'u'

export const CHANNEL_KEYS: Record<string, string> = {
  [CH_UNREAD]: 'channel.unscanned',
  [CH_NONE]: 'channel.none',
  [CH_UNKNOWN]: 'channel.unknown',
}

/** i18n text for a channel bucket: a named one, or "channel 149". */
export function channelText(v: string): { labelKey: string; params?: Record<string, string> } {
  const key = CHANNEL_KEYS[v]
  return key ? { labelKey: key } : { labelKey: 'channel.num', params: { v } }
}

export function channelBucket(n: MeshNode): string {
  // AREDN's 2.4 GHz numbering includes 0 and negatives, so 0 is unset only without a frequency.
  const c = n.channel
  if (c !== null && c !== undefined && (c !== 0 || n.freq_low)) return String(c)
  if (neverRead(n)) return CH_UNREAD
  return n.band === 'n' || n.band === 's' ? CH_NONE : CH_UNKNOWN
}

function liveness(n: MeshNode): OnlineState {
  if (n.online) return 'online'
  return probeSeen(n) ? 'offline' : 'unprobed'
}

function locality(n: MeshNode): Locality {
  if (n.has_location) return 'with'
  return neverRead(n) ? 'unread' : 'without'
}

function passNode(n: MeshNode, f: Filters): boolean {
  if (f.bands.length && !f.bands.includes(n.band)) return false
  if (f.channels.length && !f.channels.includes(channelBucket(n))) return false
  if (f.online !== 'all' && liveness(n) !== f.online) return false
  if (f.located !== 'all' && locality(n) !== f.located) return false
  // An unknown hop count never satisfies a hop limit.
  if (f.maxHops) {
    const h = hopDepth(n)
    if (h === null || h > f.maxHops) return false
  }
  return matchText(n, f.q.trim())
}

/** Data + push; call once from the page. Reads stay client-side so SSR never bakes them in. */
export function useMeshData() {
  const base = apiBase()
  const status = useState<StatusPayload | null>('status', () => null)
  const nodes = useState<MeshNode[]>('nodes', () => [])
  const links = useState<MeshLink[]>('links', () => [])
  const conn = useState<ConnState>('conn', () => 'connecting')
  const lastSync = useState<number>('lastSync', () => 0)
  const syncing = useState<boolean>('syncing', () => false)
  // Frames arriving during an HTTP pull are queued until it ends.
  let pulling = false
  let backlog: WsFrame[] = []

  // Synchronous assign: a watcher flush after the SSR render would mismatch the HTML.
  function adoptStatus(v: StatusPayload | null | undefined) {
    if (!v) return
    status.value = v
    lastSync.value = Date.now()
    conn.value = 'live'
  }

  /** Full HTTP replacement of the inventory; used only for `full` frames. */
  async function refreshInventory() {
    if (import.meta.server) return
    pulling = true
    syncing.value = true
    try {
      const [n, l] = await Promise.all([
        $fetch<NodesPayload>(`${base}/nodes`),
        $fetch<LinksPayload>(`${base}/links`),
      ])
      nodes.value = n?.nodes ?? []
      links.value = l?.links ?? []
      conn.value = 'live'
      lastSync.value = Date.now()
    } catch (err) {
      conn.value = 'down'
      console.warn('[aredn] inventory refresh failed:', (err as Error).message)
    } finally {
      pulling = false
      syncing.value = false
      // Re-apply the backlog; these rows are past the server's cursor.
      const queued = backlog
      backlog = []
      for (const f of queued) applyFrame(f)
    }
  }

  function mergeFrame(f: WsFrame) {
    const n = mergeNodes(nodes.value, f.nodes, f.removed)
    if (n !== nodes.value) nodes.value = n
    const l = mergeLinks(links.value, f.links)
    if (l !== links.value) links.value = l
  }

  function applyFrame(f: WsFrame) {
    adoptStatus(f.status)
    if (pulling) {
      backlog.push(f)
      return
    }
    if (f.full) {
      void refreshInventory()
      return
    }
    mergeFrame(f)
  }

  // --------------------------------------------------------------- the push
  startStatusSocket(base, {
    frame: applyFrame,
    open: up => {
      // A dropped socket means `down`; the last status stays on screen.
      conn.value = up ? 'live' : 'down'
    },
  })

  /** REST read of the same frame the socket pushes, for the manual button. */
  async function refreshStatus() {
    try {
      adoptStatus(await $fetch<StatusPayload>(`${base}/status`))
    } catch (err) {
      conn.value = 'down'
      console.warn('[aredn] status read failed:', (err as Error).message)
    }
  }

  return {
    status,
    nodes,
    links,
    conn,
    lastSync,
    syncing,
    refreshStatus,
    refreshInventory,
    base,
  }
}

export interface ActiveChip {
  key: string
  /** i18n key, resolved with params by the component that draws it. */
  labelKey: string
  params?: Record<string, string | number>
  /** Shown when labelKey has no translation: a link type the backend invented. */
  raw?: string
  clear: () => void
}

export interface FilteredBundle {
  filters: Ref<Filters>
  topology: ComputedRef<TopologyPayload>
  visibleNodes: ComputedRef<MeshNode[]>
  visibleIDs: ComputedRef<Set<string>>
  visibleLinks: ComputedRef<MeshLink[]>
  visibleTopoNodes: ComputedRef<TopologyPayload['nodes']>
  visibleTopoLinks: ComputedRef<MeshLink[]>
  nodeById: ComputedRef<Map<string, MeshNode>>
  selected: Ref<string | null>
  selectedNode: ComputedRef<MeshNode | null>
  selectedLinks: ComputedRef<MeshLink[]>
  view: Ref<ViewMode>
  channels: ComputedRef<Array<{ value: string; count: number }>>
  activeCount: ComputedRef<number>
  activeChips: ComputedRef<ActiveChip[]>
  reset: () => void
  toggleBand: (k: string) => void
  toggleChannel: (c: string) => void
  toggleLinkType: (t: string) => void
}

/** Shared filter state: rail, map, graph and list read the same refs. */
export function useFilters(): FilteredBundle {
  const nodes = useState<MeshNode[]>('nodes', () => [])
  const links = useState<MeshLink[]>('links', () => [])
  const topology = computed(() => buildTopology(nodes.value, links.value))
  const filters = useState<Filters>('filters', emptyFilters)
  const selected = useState<string | null>('selected', () => null)
  const view = useState<ViewMode>('view', () => 'map')

  const visibleNodes = computed(() => nodes.value.filter(n => passNode(n, filters.value)))
  const visibleIDs = computed(() => new Set(visibleNodes.value.map(nodeId)))

  const visibleLinks = computed(() => {
    const f = filters.value
    const ids = visibleIDs.value
    return links.value.filter(l => {
      if (f.linkTypes.length && !f.linkTypes.includes(l.type)) return false
      if (!f.showDown && !linkLive(l)) return false
      return ids.has(l.from) && ids.has(l.to)
    })
  })

  const visibleTopoNodes = computed(() => {
    const ids = visibleIDs.value
    return topology.value.nodes.filter(n => ids.has(n.id))
  })

  const visibleTopoLinks = computed(() => {
    const ids = visibleIDs.value
    const f = filters.value
    return topology.value.links.filter(l => {
      if (f.linkTypes.length && !f.linkTypes.includes(l.type)) return false
      if (!f.showDown && !linkLive(l)) return false
      return ids.has(l.from) && ids.has(l.to)
    })
  })

  const nodeById = computed(() => new Map(nodes.value.map(n => [nodeId(n), n])))

  const selectedNode = computed(() => (selected.value ? nodeById.value.get(selected.value) ?? null : null))

  const selectedLinks = computed(() => {
    const id = selected.value
    if (!id) return []
    return links.value.filter(l => l.from === id || l.to === id)
  })

  /** Channel buckets, the special ones first, then by node count. */
  const channels = computed(() => {
    const counts = new Map<string, number>()
    for (const n of nodes.value) {
      const k = channelBucket(n)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const specialOrder: Record<string, number> = { [CH_UNREAD]: 0, [CH_UNKNOWN]: 1, [CH_NONE]: 2 }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, ...channelText(value), count }))
      .sort((a, b) => {
        const sa = a.value in specialOrder
        const sb = b.value in specialOrder
        if (sa !== sb) return sa ? -1 : 1
        if (sa && sb) return (specialOrder[a.value] ?? 0) - (specialOrder[b.value] ?? 0)
        return b.count - a.count || Number(a.value) - Number(b.value)
      })
      .slice(0, 12)
  })

  const activeCount = computed(() => {
    const f = filters.value
    let c = 0
    if (f.bands.length) c += f.bands.length
    if (f.channels.length) c += f.channels.length
    if (f.linkTypes.length) c += f.linkTypes.length
    if (f.showDown) c += 1
    if (f.online !== 'all') c += 1
    if (f.located !== 'all') c += 1
    if (f.maxHops) c += 1
    if (f.q.trim()) c += 1
    return c
  })

  function toggleBand(k: string) {
    const i = filters.value.bands.indexOf(k)
    if (i >= 0) filters.value.bands.splice(i, 1)
    else filters.value.bands.push(k)
  }
  function toggleChannel(c: string) {
    const i = filters.value.channels.indexOf(c)
    if (i >= 0) filters.value.channels.splice(i, 1)
    else filters.value.channels.push(c)
  }
  function toggleLinkType(t: string) {
    const i = filters.value.linkTypes.indexOf(t)
    if (i >= 0) filters.value.linkTypes.splice(i, 1)
    else filters.value.linkTypes.push(t)
  }
  /** What is filtering the page right now. */
  const activeChips = computed<ActiveChip[]>(() => {
    const f = filters.value
    const out: ActiveChip[] = []
    for (const b of f.bands) out.push({ key: `band:${b}`, labelKey: 'band.' + b, clear: () => toggleBand(b) })
    for (const c of f.channels)
      out.push({ key: `ch:${c}`, ...channelText(c), clear: () => toggleChannel(c) })
    for (const t of f.linkTypes) out.push({ key: `lt:${t}`, labelKey: 'linkType.' + t, raw: t, clear: () => toggleLinkType(t) })
    if (f.showDown) out.push({ key: 'down', labelKey: 'filters.showDown', clear: () => (f.showDown = false) })
    if (f.online !== 'all')
      out.push({ key: 'on', labelKey: ONLINE_KEYS[f.online], clear: () => (f.online = 'all') })
    if (f.located !== 'all')
      out.push({ key: 'loc', labelKey: LOCALITY_KEYS[f.located], clear: () => (f.located = 'all') })
    if (f.maxHops)
      out.push({ key: 'hops', labelKey: 'filters.hopsChip', params: { n: f.maxHops }, clear: () => (f.maxHops = 0) })
    if (f.q.trim())
      out.push({ key: 'q', labelKey: 'filters.searchChip', params: { q: f.q.trim() }, clear: () => (f.q = '') })
    return out
  })

  function reset() {
    Object.assign(filters.value, emptyFilters())
  }

  return {
    filters,
    topology,
    visibleNodes,
    visibleIDs,
    visibleLinks,
    visibleTopoNodes,
    visibleTopoLinks,
    nodeById,
    selected,
    selectedNode,
    selectedLinks,
    view,
    channels,
    activeCount,
    activeChips,
    reset,
    toggleBand,
    toggleChannel,
    toggleLinkType,
  }
}

/** Band fill colour with a grey fallback. */
export function bandColor(band: string): string {
  return BAND_COLORS[band as keyof typeof BAND_COLORS] ?? '#94a3b8'
}
