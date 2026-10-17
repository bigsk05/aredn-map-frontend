import type { MeshNode } from '~/types'

/** Maidenhead locators are WGS-84 only — never the GCJ-02 pair used for the Chinese tiles. */

const FIELD_LETTERS = 'ABCDEFGHIJKLMNOPQR'
const HEX_LETTERS = 'abcdefghijklmnopqrstuvwx'

const FIELD_LON = 20
const FIELD_LAT = 10
const SQUARE_LON = 2
const SQUARE_LAT = 1

/** Precision of the returned locator: characters that follow the 2-letter field. */
export type GridPrecision = 2 | 4

function clampIndex(v: number, last: number): number {
  const i = Math.floor(v)
  if (!Number.isFinite(i)) return 0
  return i < 0 ? 0 : i > last ? last : i
}

/** Precision 4 yields `IO94gw`, 2 yields `IO94`; null = no position, distinct from 0,0. */
export function maidenhead(lat: number, lon: number, field: GridPrecision | number = 4): string | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90) return null

  // Longitude wraps: -180 == 180, anything further out is normalised back into range.
  let lng = lon
  if (lng < -180 || lng > 180) lng = ((((lng + 180) % 360) + 360) % 360) - 180

  // Offsets from the grid's south-west corner, so Math.floor truncates negatives correctly.
  let rLon = lng + 180
  let rLat = lat + 90

  const fLon = clampIndex(rLon / FIELD_LON, FIELD_LETTERS.length - 1)
  const fLat = clampIndex(rLat / FIELD_LAT, FIELD_LETTERS.length - 1)
  rLon -= fLon * FIELD_LON
  rLat -= fLat * FIELD_LAT

  const sLon = clampIndex(rLon / SQUARE_LON, 9)
  const sLat = clampIndex(rLat / SQUARE_LAT, 9)
  rLon -= sLon * SQUARE_LON
  rLat -= sLat * SQUARE_LAT

  const out = `${FIELD_LETTERS[fLon] ?? ''}${FIELD_LETTERS[fLat] ?? ''}${sLon}${sLat}`
  if (field <= 2) return out

  const hLon = clampIndex(rLon / (SQUARE_LON / HEX_LETTERS.length), HEX_LETTERS.length - 1)
  const hLat = clampIndex(rLat / (SQUARE_LAT / HEX_LETTERS.length), HEX_LETTERS.length - 1)
  return out + HEX_LETTERS[hLon] + HEX_LETTERS[hLat]
}

/** Node's own published `grid_locator` if the crawler got one, else the computed cell; null = no position. */
export function gridOf(
  n: Pick<MeshNode, 'lat' | 'lon'> & Partial<Pick<MeshNode, 'grid_locator' | 'has_location'>>,
): string | null {
  if (!n) return null
  const published = (n.grid_locator ?? '').trim()
  if (published) return published
  if (n.has_location === false) return null
  if (n.lat === 0 && n.lon === 0) return null
  return maidenhead(n.lat, n.lon)
}

/** WGS-84 pair as a muted secondary line: "59.93477, -2.42516". */
export function wgs84Text(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—'
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}
