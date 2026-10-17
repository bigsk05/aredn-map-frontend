import { createI18n } from 'vue-i18n'
import { messages, storedLang } from '../i18n'

export default defineNuxtPlugin((nuxtApp) => {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh',
    fallbackLocale: 'zh',
    messages,
  })

  nuxtApp.vueApp.use(i18n)

  // After mount: the prerendered HTML is Chinese, so switching during hydration
  // would mismatch it. One repaint beats a mismatched tree.
  if (import.meta.client) {
    nuxtApp.hook('app:mounted', () => {
      i18n.global.locale.value = storedLang()
    })
  }
})
