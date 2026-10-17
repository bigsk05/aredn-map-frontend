/** Hand-drawn canvas overlay on the SDK basemap; positions come from `projectToContainer`. */

export interface Camera {
  lat: number
  lon: number
  zoom: number
}

/** Container-pixel projection supplied by the map itself. */
export type Project = (lat: number, lon: number) => { x: number; y: number }

/** The screen-space frame for one redraw. */
export interface Frame {
  project: Project
  /** Width of one world in container pixels at the current zoom. */
  world: number
  width: number
  height: number
}

/** Signed longitude difference wrapped into [-180, 180). */
export function lonDelta(lon: number, origin: number): number {
  let d = lon - origin
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

/** `lon` expressed in the frame whose centre meridian is `origin`. */
export function unwrapLon(lon: number, origin: number): number {
  return origin + lonDelta(lon, origin)
}

/** Circular mean longitude; an arithmetic average is wrong across the antimeridian. */
export function meanLon(lons: number[]): number {
  let x = 0
  let y = 0
  for (const lon of lons) {
    const r = (lon * Math.PI) / 180
    x += Math.cos(r)
    y += Math.sin(r)
  }
  return ((Math.atan2(y, x) * 180) / Math.PI + 540) % 360 - 180
}

/** The whole-world shift that brings `x` closest to the middle of the viewport. */
export function copyOf(x: number, f: Frame): number {
  if (f.world <= 0) return 0
  return Math.round((f.width / 2 - x) / f.world)
}

/** How many neighbouring copies could still intersect the viewport. */
export function copyRange(f: Frame): number {
  if (f.world <= 0) return 0
  return f.world < f.width ? Math.ceil(f.width / f.world) + 1 : 1
}

/** Dot state: on = ICMP answered, off = asked and silent, disc = mesh reports the link down, unprobed = never asked. */
export type DotState = 'on' | 'off' | 'disc' | 'unprobed'

export interface DotItem {
  id: string
  lat: number
  lon: number
  color: string
  state: DotState
}

export interface LineItem {
  /** Identifies the wire on click; see LineHit. */
  id: string
  latA: number
  lonA: number
  latB: number
  lonB: number
  color: string
  width: number
  /** false = mesh reports this link down; drawn dashed and faded. */
  live: boolean
}

export interface HitTarget {
  id: string
  x: number
  y: number
  r: number
}

/** A drawn segment in container pixels, kept so a click can be matched to a wire. */
export interface LineHit {
  id: string
  ax: number
  ay: number
  bx: number
  by: number
}

/** Distance from (x,y) to the segment, used as the click tolerance. */
export function hitLine(h: LineHit, x: number, y: number): number {
  const dx = h.bx - h.ax
  const dy = h.by - h.ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(x - h.ax, y - h.ay)
  let t = ((x - h.ax) * dx + (y - h.ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (h.ax + t * dx), y - (h.ay + t * dy))
}

const OFFLINE_FILL = '#1f2937'
const STROKE = '#0b1120'

export function drawDots(ctx: CanvasRenderingContext2D, items: DotItem[], f: Frame): HitTarget[] {
  const hits: HitTarget[] = []
  const range = copyRange(f)
  for (const it of items) {
    const p = f.project(it.lat, it.lon)
    const home = copyOf(p.x, f)
    for (let k = -range; k <= range; k++) {
      const x = p.x + (home + k) * f.world
      const y = p.y
      if (x < -20 || x > f.width + 20 || y < -20 || y > f.height + 20) continue
      const r = it.state === 'off' ? 5 : 6
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      if (it.state === 'disc') {
        ctx.strokeStyle = it.color
        ctx.lineWidth = 2.5
        ctx.stroke()
      } else if (it.state === 'unprobed') {
        ctx.globalAlpha = 0.4
        ctx.fillStyle = it.color
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = it.color
        ctx.lineWidth = 1.5
        ctx.stroke()
      } else {
        ctx.fillStyle = it.state === 'off' ? OFFLINE_FILL : it.color
        ctx.fill()
        ctx.strokeStyle = it.state === 'off' ? it.color : STROKE
        ctx.lineWidth = it.state === 'off' ? 2 : 1.5
        ctx.stroke()
      }
      // Every on-screen world copy is clickable, not just the base one.
      hits.push({ id: it.id, x, y, r: r + 3 })
    }
  }
  return hits
}

export function drawLines(ctx: CanvasRenderingContext2D, items: LineItem[], f: Frame): LineHit[] {
  const range = copyRange(f)
  const hits: LineHit[] = []
  ctx.lineCap = 'round'
  for (const it of items) {
    const a = f.project(it.latA, it.lonA)
    const b = f.project(it.latB, it.lonB)
    // B is offset by the shortest longitude difference, so the drawn path is the physical one.
    const dx = (lonDelta(it.lonB, it.lonA) / 360) * f.world
    ctx.setLineDash(it.live ? [] : [7, 5])
    ctx.globalAlpha = it.live ? 1 : 0.45
    for (let k = -range; k <= range; k++) {
      const ax = a.x + k * f.world
      const bx = ax + dx
      const minX = Math.min(ax, bx)
      const maxX = Math.max(ax, bx)
      if (maxX < -20 || minX > f.width + 20) continue
      ctx.beginPath()
      ctx.moveTo(ax, a.y)
      ctx.lineTo(bx, b.y)
      ctx.strokeStyle = it.color
      ctx.lineWidth = it.width
      ctx.stroke()
      // Every world copy that reached the screen gets a hit record, or the visible line would be dead.
      hits.push({ id: it.id, ax, ay: a.y, bx, by: b.y })
    }
  }
  ctx.setLineDash([])
  ctx.globalAlpha = 1
  return hits
}

const HEAT_STOPS: Array<[number, string]> = [
  [0, 'rgba(29,78,216,0)'],
  [0.2, 'rgba(29,78,216,0.55)'],
  [0.4, 'rgba(34,197,94,0.7)'],
  [0.6, 'rgba(234,179,8,0.8)'],
  [0.8, 'rgba(249,115,22,0.9)'],
  [1, 'rgba(239,68,68,0.95)'],
]

let ramp: Uint8ClampedArray | null = null

/** Alpha-to-colour lookup sampled once from HEAT_STOPS. */
function heatRamp(opacity: number): Uint8ClampedArray {
  if (ramp) return ramp
  const table = new Uint8ClampedArray(4 * 256)
  const meas = document.createElement('canvas').getContext('2d')
  if (meas) {
    const g = meas.createLinearGradient(0, 0, 256, 0)
    for (const [stop, color] of HEAT_STOPS) g.addColorStop(stop, color)
    meas.fillStyle = g
    meas.fillRect(0, 0, 256, 1)
    const px = meas.getImageData(0, 0, 256, 1).data
    for (let i = 0; i < 256; i++) {
      table[i * 4] = px[i * 4] ?? 0
      table[i * 4 + 1] = px[i * 4 + 1] ?? 0
      table[i * 4 + 2] = px[i * 4 + 2] ?? 0
      table[i * 4 + 3] = Math.round((px[i * 4 + 3] ?? 0) * opacity)
    }
  }
  ramp = table
  return table
}

export interface HeatItem {
  lat: number
  lon: number
  /** Relative weight; online nodes count heavier. */
  weight: number
}

/** Density field composited through a half-scale scratch canvas; raw `putImageData` would erase the layer below. */
export function drawHeat(
  ctx: CanvasRenderingContext2D,
  items: HeatItem[],
  f: Frame,
  scratch: HTMLCanvasElement,
  radius = 26,
  opacity = 0.85,
  scale = 0.5,
) {
  const width = Math.max(1, Math.round(f.width * scale))
  const height = Math.max(1, Math.round(f.height * scale))
  scratch.width = width
  scratch.height = height
  const sctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!sctx) return
  sctx.clearRect(0, 0, width, height)
  const range = copyRange(f)
  const r = Math.max(4, radius * scale)
  for (const it of items) {
    const p = f.project(it.lat, it.lon)
    const home = copyOf(p.x, f)
    for (let k = -range; k <= range; k++) {
      const x = (p.x + (home + k) * f.world) * scale
      const y = p.y * scale
      if (x < -r || x > width + r || y < -r || y > height + r) continue
      const g = sctx.createRadialGradient(x, y, 0, x, y, r)
      // Peak alpha per node stays low, or the field reports presence instead of density.
      g.addColorStop(0, `rgba(0,0,0,${Math.min(1, 0.12 * it.weight)})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      sctx.fillStyle = g
      sctx.beginPath()
      sctx.arc(x, y, r, 0, Math.PI * 2)
      sctx.fill()
    }
  }
  const field = sctx.getImageData(0, 0, width, height)
  const out = new ImageData(width, height)
  const table = heatRamp(opacity)
  for (let i = 0; i < field.data.length; i += 4) {
    const a = field.data[i + 3] ?? 0
    if (!a) continue
    const t = a * 4
    out.data[i] = table[t] ?? 0
    out.data[i + 1] = table[t + 1] ?? 0
    out.data[i + 2] = table[t + 2] ?? 0
    out.data[i + 3] = table[t + 3] ?? 0
  }
  sctx.putImageData(out, 0, 0)
  // Smooth upscaling; the half-resolution field otherwise shows its block edges.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(scratch, 0, 0, Math.round(f.width), Math.round(f.height))
}
