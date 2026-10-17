import { useI18n } from 'vue-i18n'
import type { LangCode } from '../i18n'
import { LANGS, rememberLang } from '../i18n'

/** Text and active language; locale choice is client state. */
export function useLang() {
  const { t, locale } = useI18n()

  function setLang(code: LangCode) {
    locale.value = code
    rememberLang(code)
  }

  return { t, locale, setLang, langs: LANGS }
}
