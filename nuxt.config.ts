import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  hooks: {
    // The server and prerender builds resolve the Node flavour of vue-i18n: the ESM
    // flavour reads Vue's compile-time flags as free globals, and the prerenderer
    // imports vue-i18n unbundled, so no define step ever folds them.
    'vite:extendConfig'(config, { isClient }) {
      if (isClient) return
      const current = config.resolve.alias
      const list = Array.isArray(current)
        ? current
        : Object.entries((current ?? {}) as Record<string, string>).map(([find, replacement]) => ({ find, replacement }))
      // An anchored pattern, not a bare key: a plain key would also match
      // "vue-i18n/dist/…" and substitute it into itself.
      list.push({ find: /^vue-i18n$/, replacement: 'vue-i18n/dist/vue-i18n.node.mjs' })
      config.resolve.alias = list
    },
  },
  compatibilityDate: '2025-07-01',
  srcDir: 'app/',
  ssr: true,
  telemetry: false,
  modules: [],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      // Loaded with a runtime import() inside the client-only graph component; pre-bundle it
      // so Vite does not force a full-page reload the first time 网状图 is opened.
      include: ['d3-force'],
    },
  },
  nitro: {
    // Fully static, prerendered bundle: the Go backend serves .output/public verbatim.
    preset: 'static',
    prerender: {
      routes: ['/'],
      crawlLinks: false,
      failOnError: true,
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: 'AREDN 网络观测台 · Mesh Scanner',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'AREDN mesh 节点地图与网状拓扑图' },
      ],
      script: [
        // Runs before first paint so a dark-theme user gets no light flash.
        // Must stay in step with app/composables/useTheme.ts.
        {
          innerHTML:
            "(function(){try{var t=localStorage.getItem('aredn.theme');if(t!=='light'&&t!=='dark'){t='dark'}document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()",
        },
      ],
    },
  },
  runtimeConfig: {
    public: {
      // Public: NUXT_PUBLIC_API_BASE. Same-origin /api by default, which is what
      // the Go process serves the bundle from.
      apiBase: '/api',
      // No basemap keys are baked in: which provider and which key to use is read
      // from /api/config at runtime, so config.yaml stays the only copy.
    },
  },
})
