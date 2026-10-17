import { useI18n } from 'vue-i18n'
import type { LangCode } from '../i18n'
import { LANGS, rememberLang } from '../i18n'

/** Text and active language; locale choice is client state. */
export function useLang() {
  const { t, te, locale } = useI18n()

  function setLang(code: LangCode) {
    locale.value = code
    rememberLang(code)
  }

  /** Label for a value that arrives from the backend: falls back to the raw token. */
  function text(key: string, raw: string, params?: Record<string, string | number>) {
    return te(key) ? t(key, params ?? {}) : raw
  }

  return { t, te, text, locale, setLang, langs: LANGS }
}
