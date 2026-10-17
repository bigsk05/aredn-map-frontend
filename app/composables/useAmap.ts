/** AMap JS API v2 loader — client side only. */
export type AmapNamespace = any

let inflight: Promise<AmapNamespace> | null = null
let loadedKey: string | null = null

function src(key: string) {
  return `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`
}

export function loadAmap(key: string, securityCode: string): Promise<AmapNamespace> {
  if (!import.meta.client) return Promise.reject(new Error('ssr'))
  const w = window as unknown as { AMap?: AmapNamespace; _AMapSecurityConfig?: Record<string, string> }
  if (w.AMap?.Map && loadedKey === key) return Promise.resolve(w.AMap)
  if (inflight && loadedKey === key) return inflight

  const want = src(key)
  inflight = new Promise<AmapNamespace>((resolve, reject) => {
    const deadline = performance.now() + 20000
    let settled = false
    const succeed = () => {
      if (settled) return
      settled = true
      loadedKey = key
      resolve(w.AMap as AmapNamespace)
    }
    /** Load failures carry a code; the page showing them owns the wording. */
    const fail = (code: string) => {
      if (settled) return
      settled = true
      const err = new Error(code) as Error & { code?: string }
      err.code = code
      reject(err)
    }
    // setTimeout, not requestAnimationFrame: rAF is suspended in a background tab.
    const tick = () => {
      if (settled) return
      if (w.AMap?.Map) return succeed()
      if (performance.now() > deadline) {
        return fail('timeout')
      }
      window.setTimeout(tick, 60)
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-aredn-amap]')
    if (existing && existing.getAttribute('src') === want) {
      tick()
      return
    }
    if (existing) existing.remove()

    // Must exist before injection, or this key is rejected for the whole page lifetime.
    w._AMapSecurityConfig = { securityJsCode: securityCode }

    const el = document.createElement('script')
    el.setAttribute('data-aredn-amap', '1')
    el.async = true
    el.onload = () => tick()
    el.onerror = () => fail('network')
    el.src = want
    document.head.appendChild(el)
    tick()
  }).catch(err => {
    inflight = null
    loadedKey = null
    throw err
  })

  return inflight
}

export function loadedAmapKey(): string | null {
  return loadedKey
}
