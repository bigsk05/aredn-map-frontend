# aredn-map-frontend

Dashboard for an AREDN mesh: node map, mesh topology graph, node table and filters.
Nuxt 4 (Vue 3) + Tailwind + daisyUI, built to a static bundle for pure static hosting.
The API is a separate service on a separate domain; nothing here knows where it lives
until you tell it at build time.

## Build and run

```sh
pnpm install
NUXT_PUBLIC_API_BASE=https://map-api.example.cn/api pnpm build   # static bundle in .output/public
NUXT_PUBLIC_API_BASE=https://map-api.example.cn/api pnpm dev     # dev server against the same API
```

`NUXT_PUBLIC_API_BASE` is optional. Left unset the bundle talks to same-origin `/api`,
which is only useful when something on that host proxies to the API.

Serve `.output/public` as-is. One route, hashed asset names, no rewrite rules needed.

## Data flow

- Everything is read in the browser. The bundle is static; a value captured at build
  time would freeze into `index.html`.
- `<api>/config` answers the basemap keys and the initial view at runtime, so a key
  change is a backend restart, not a frontend rebuild.
- `<api>/ws` pushes one frame per change, carrying only the rows written since the last
  frame, so the picture grows while a sweep runs. The socket address follows
  `NUXT_PUBLIC_API_BASE`, including its `wss://` form.
- The page reads and filters. Scan parameters belong to the backend config, never here.

## Layout

- `app/pages/index.vue` — header, summary cards, filter rail, the two views, and the table.
- `app/composables/useMeshStore.ts` — shared state, the push socket, and all filtering.
- `app/components/map` — nodes and links over the basemap; `app/components/graph` — the
  same rows as a force graph.
- `app/i18n/` and `app/locales/` — the five interface languages.
- `app/app.config.ts` — the view defaults the backend has not overridden.

## Languages

Chinese, English, French, Russian and Spanish, one flat key set per file in `app/locales`.
The choice is stored in `localStorage` under `aredn.lang` and applied after mount, so the
built output stays a single page. Interpolation markers (`{n}`, `{time}`, …) are part of
the contract and must survive a translation.

## Notes

- Coordinates sent to the basemap are GCJ-02; every number the interface prints is WGS-84.
- Band keys and colours arrive with the data, so the map, the graph and the table cannot
  disagree about which band a node is in.
- Cross-origin requests carry no credentials; the API needs no cookies or session.
