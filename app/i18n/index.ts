import en from '../locales/en.json'
import es from '../locales/es.json'
import fr from '../locales/fr.json'
import ru from '../locales/ru.json'
import zh from '../locales/zh.json'

/** Five UN working languages minus Arabic; each name is written in its own language. */
export const LANGS = [
  { code: 'zh', name: '中文' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'ru', name: 'Русский' },
  { code: 'es', name: 'Español' },
] as const

export type LangCode = (typeof LANGS)[number]['code']

export const messages = { zh, en, fr, ru, es }

const STORAGE_KEY = 'aredn' + '.lang'

export function storedLang(): LangCode {
  const v = localStorage.getItem(STORAGE_KEY)
  return LANGS.some(l => l.code === v) ? (v as LangCode) : 'zh'
}

export function rememberLang(code: LangCode) {
  localStorage.setItem(STORAGE_KEY, code)
  document.documentElement.lang = code
}
