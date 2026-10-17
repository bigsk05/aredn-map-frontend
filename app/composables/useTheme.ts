export type ThemeName = 'light' | 'dark'

const STORAGE_KEY = 'aredn.theme'

/** daisyUI theme lives on the root element's data-theme, which the map reads too. */
let adoptedFromDom = false

export function useTheme() {
  const theme = useState<ThemeName>('theme', () => 'dark')

  // The prerendered payload carries the build-time default; data-theme written by the head script is the truth.
  if (import.meta.client && !adoptedFromDom) {
    adoptedFromDom = true
    const attr = document.documentElement.getAttribute('data-theme')
    theme.value = attr === 'light' ? 'light' : 'dark'
  }

  function apply(name: ThemeName) {
    theme.value = name
    if (import.meta.client) {
      document.documentElement.setAttribute('data-theme', name)
      try {
        localStorage.setItem(STORAGE_KEY, name)
      } catch {
        /* private mode: the in-memory value holds for this session */
      }
    }
  }

  function toggle() {
    apply(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { theme, apply, toggle, isDark: computed(() => theme.value === 'dark') }
}

/** Inline head script run before first paint; must agree with the composable on key and default. */
export const themeBootstrap = `(function(){try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(t!=='light'&&t!=='dark'){t='dark'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()`
