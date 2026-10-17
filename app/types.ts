/** Wire types: field names mirror the Go backend contract exactly. */

export type BandKey = 'h' | '9' | '2' | '3' | '5' | 's' | 'n' | 'w' | 'u' | 'p'

export interface NodeServices {
  [protocol: string]: string[]
}

export interface NodeLocalDevice {
  hostname?: string
  ip?: string
  mac?: string
  model?: string
}

export interface NodeNeighborRef {
  name: string
  hostname: string
  ip: string
  type: string
  snr?: number | null
}

export interface MeshNode {
  name: string
  hostname: string
  url: string
  mesh_ip: string
  aliases: string[]
  description: string
  hardware: string
  firmware: string
  band: BandKey
  band_label: string
  channel: number | null
  freq_low: number | null
  freq_high: number | null
  chan_bw: number | null
  tx_power_dbm: number | null
  antenna: string
  azimuth: number | null
  height_m: number | null
  max_dist_miles: number | null
  ssid: string
  lat: number
  lon: number
  gcj_lat: number
  gcj_lon: number
  grid_locator: string
  has_location: boolean
  is_supernode: boolean
  hops: number | null
  etx: number | null
  babel_metric: number | null
  babel_routes: number | null
  olsr_routes: number | null
  services: NodeServices
  local_services: string[]
  local_devices: NodeLocalDevice[]
  neighbors: NodeNeighborRef[]
  link_types: Record<string, number>
  online: boolean
  /** Mesh verdict on this node's uplink; the only basis for calling it down. */
  mesh_state?: string
  disconnected: boolean
  link_down_since?: string
  latency_ms: number | null
  packet_loss_pct: number | null
  packets_sent: number | null
  packets_recv: number | null
  ttl: number | null
  jitter_ms: number | null
  probed_at: string | null
  probe_error: string | null
  discovered_at: string | null
  updated_at: string | null
  detail_fetched: boolean
  /** Scanner reached and expanded this node's own page. */
  crawled: boolean
  source: string
  last_error: string
}

export interface MeshLink {
  from: string
  to: string
  container: string
  mac: string
  ip: string
  type: string
  band: BandKey
  /** Reporting node's own quality grade. */
  status: string
  /** Mesh verdict on the neighbour: routing / idle / disconnected / unused. */
  state: string
  distance_mi: number | null
  rx_success_pct: number | null
  tx_success_pct: number | null
  local_snr: number | null
  neighbor_snr: number | null
  errors_pct: number | null
  rtt_ms: number | null
  ping_ms: number | null
  neighbor_ping_ms: number | null
  avg_tx_pps: number | null
  etx: number | null
  metric: number | null
  /** Mesh routes carried by this link at reporting time. */
  routes: number
  bitrate_rx_mbps: number | null
  bitrate_tx_mbps: number | null
  retransmit_pct: number | null
  last_seen: string | null
  scanned_at: string | null
}

export interface ScanState {
  id: number | null
  kind: string
  phase: string
  status: string
  started_at: string | null
  completed_at: string | null
  total: number
  completed: number
  succeeded: number
  failed: number
  current_target: string | null
  message: string | null
  /** Live progress counters; `total` only closes when the sweep ends. */
  node_total: number
  node_progress: number
  /** Work in flight now, against the configured ceilings. */
  workers_busy: number
  worker_slots: number
  probes_active: number
  probe_slots: number
}

export interface StatusPayload {
  counts: {
    total: number
    online: number
    offline: number
    /** Registered but never ICMP-tested; distinct from offline. */
    unprobed: number
    unreachable: number
    /** Nodes the scanner reached and expanded. */
    crawled: number
    located: number
    supernodes: number
    pending: number
    links: number
    services: number
  }
  scan: ScanState
  scanning_enabled: boolean
  band_counts: Record<string, number>
  link_type_counts: Record<string, number>
  icmp_mode: string
  cron: string
  server_time: string
  next_sweep_at: string | null
  last_sweep_at: string | null
  uptime_seconds: number
  version: string
}

export interface TopologyNode {
  id: string
  name: string
  band: BandKey
  band_label: string
  color: string
  is_supernode: boolean
  hops: number | null
  etx: number | null
  online: boolean
  /** Whether an ICMP verdict exists. */
  probed: boolean
  latency_ms: number | null
  lat: number
  lon: number
  neighbor_cnt: number
}

export interface TopologyPayload {
  nodes: TopologyNode[]
  links: MeshLink[]
  generated_at: string
  /** Directory-table names only: never reached, no observed link. */
  unconnected_nodes: number
}

export interface NodesPayload {
  nodes: MeshNode[]
}

export interface LinksPayload {
  links: MeshLink[]
}

/** One /api/ws push: rows written since `rev`; `full` demands a fresh inventory pull. */
export interface WsFrame {
  rev: number
  gen: number
  full?: boolean
  status?: StatusPayload
  nodes?: MeshNode[]
  links?: MeshLink[]
  removed?: string[]
}

/** Fallback band colours shared by map, graph and list; a topology node's own `color` wins. */
export const BAND_COLORS: Record<BandKey, string> = {
  h: '#c0c0c0',
  '9': '#f97316',
  '2': '#22c55e',
  '3': '#eab308',
  '5': '#3b82f6',
  s: '#a855f7',
  n: '#64748b',
  w: '#14b8a6',
  u: '#94a3b8',
  p: '#78716c',
}

/** Band row order mirrors worldmap.arednmesh.org's table; labels are i18n keys. */
export const BAND_ROWS: Array<{ key: BandKey; noteKey?: string }> = [
  { key: 'h', noteKey: 'bandNote.h' },
  { key: '9', noteKey: 'bandNote.9' },
  { key: '2' },
  { key: '3', noteKey: 'bandNote.3' },
  { key: '5', noteKey: 'bandNote.5' },
  { key: 's', noteKey: 'bandNote.s' },
  { key: 'n', noteKey: 'bandNote.n' },
  { key: 'w', noteKey: 'bandNote.w' },
  { key: 'u' },
  { key: 'p' },
]

/** True when an ICMP verdict exists. Mirrors `hasProbeVerdict` in Go. */
export function probeSeen(n: { probed_at?: string | null; online?: boolean; probe_error?: string | null }): boolean {
  const t = n.probed_at
  const stamped = typeof t === 'string' && t.length > 0 && !t.startsWith('0001-01-01')
  return stamped || n.online === true || (typeof n.probe_error === 'string' && n.probe_error !== '')
}

/** True when neither the crawl nor the detail page was ever read. Mirrors `model.BandOf` in Go. */
export function neverRead(n: { crawled?: boolean; detail_fetched?: boolean }): boolean {
  return !n.crawled && !n.detail_fetched
}

/** Round-trip time in ms, or null when nothing measured it. */
export function latencyMs(n: {
  latency_ms: number | null
  probed_at?: string | null
  online?: boolean
}): number | null {
  if (n.latency_ms == null) return null
  if (n.probed_at === undefined) return n.online ? n.latency_ms : null
  return probeSeen(n) ? n.latency_ms : null
}

/** Packet loss as a reading, or null when the node was never probed. */
export function lossPct(n: {
  packet_loss_pct: number | null
  probed_at?: string | null
  online?: boolean
}): number | null {
  if (n.packet_loss_pct == null) return null
  if (n.probed_at === undefined) return n.online ? n.packet_loss_pct : null
  return probeSeen(n) ? n.packet_loss_pct : null
}

/** Radio hops from a seed; null when unknown (-1 on the wire). */
export function hopDepth(n: { hops: number | null }): number | null {
  return n.hops == null || n.hops < 0 ? null : n.hops
}
