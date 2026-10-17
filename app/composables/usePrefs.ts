/** Display-only operator settings in localStorage, one key so a reset is a single removeItem. */
const KEY = 'aredn.prefs'

export interface Prefs {
  /** Whether the map draws links. */
  linkMode?: boolean
  /** Below this zoom, draw heat instead of dots. */
  heatBelowZoom?: number
  filters?: Record<string, unknown>
}

function read(): Prefs {
  if (!import.meta.client) return {}
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Prefs) : {}
  } catch {
    // Corrupt stored JSON falls back to defaults.
    return {}
  }
}

function write(next: Prefs) {
  if (!import.meta.client) return
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* localStorage unavailable: defaults still work */
  }
}

/** Merge-on-write so one caller cannot drop another's keys. */
export function savePrefs(patch: Prefs) {
  write({ ...read(), ...patch })
}

export function loadPrefs(): Prefs {
  return read()
}

export function clearPrefs() {
  if (!import.meta.client) return
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clean up */
  }
}
