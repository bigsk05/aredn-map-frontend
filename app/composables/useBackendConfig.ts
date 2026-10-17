import { apiBase } from './useMeshStore'

/** Runtime view settings from the Go backend's /api/config; build-time config is only the fallback. */
export interface BackendConfig {
  amap_key?: string
  amap_security_code?: string
  center_lat?: number
  center_lon?: number
  zoom?: number
}

let inflight: Promise<BackendConfig> | null = null

export function backendConfig(): Promise<BackendConfig> {
  if (!import.meta.client) return Promise.resolve({})
  if (!inflight) {
    inflight = $fetch<BackendConfig>(`${apiBase()}/config`).catch(err => {
      console.warn('[aredn] /api/config unavailable, falling back to build-time settings:', err?.message ?? err)
      inflight = null
      return {} as BackendConfig
    })
  }
  return inflight
}

/** Backend value when present and non-empty, else the build-time value. */
export function pick<T>(fromBackend: T | undefined, fallback: T): T {
  if (fromBackend === undefined || fromBackend === null) return fallback
  if (typeof fromBackend === 'string' && fromBackend.trim() === '') return fallback
  if (typeof fromBackend === 'number' && !Number.isFinite(fromBackend)) return fallback
  return fromBackend
}
