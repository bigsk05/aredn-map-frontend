# aredn-map-frontend（中文）

AREDN mesh 看板：节点地图、网状拓扑、节点列表与筛选。Nuxt 4（Vue 3）+ Tailwind + daisyUI，
构建产物是纯静态，直接交给静态托管；API 是另一个域名的独立服务，构建之前它在哪里前端并不知道。

## 构建与运行

```sh
pnpm install
NUXT_PUBLIC_API_BASE=https://map-api.example.cn/api pnpm build   # 产物在 .output/public
NUXT_PUBLIC_API_BASE=https://map-api.example.cn/api pnpm dev     # 开发模式连同一个 API
```

`NUXT_PUBLIC_API_BASE` 可以不设，此时走同源 `/api`——只在宿主机会把请求转发到 API 时才有意义。
`.output/public` 原样托管即可：只有一个路由，资源名带 hash，不需要任何 rewrite 规则。

## 数据流

- 全部数据在浏览器侧读取：产物是静态的，构建期取到的值会被钉死在 `index.html` 里。
- 地图密钥与初始视野由运行时的 `<api>/config` 提供，换 key 只需重启后端，不用重新构建前端。
- `<api>/ws` 每次变更推一帧，只带自上一帧以来被写入的记录，所以扫描进行中画面就在生长；
  socket 地址同样跟着 `NUXT_PUBLIC_API_BASE` 走，包括 `wss://` 形式。
- 页面只负责读取与筛选；扫描参数属于后端配置。

## 结构

`app/pages/index.vue` 组合页头、概览卡、筛选栏、两个视图与列表；`app/composables/useMeshStore.ts`
放共享状态、推送连接与全部筛选逻辑；`app/components/map` 在底图上画节点与链路，
`app/components/graph` 把同一批数据画成力导向图；`app/i18n/` 与 `app/locales/` 是五国语言词条；
`app/app.config.ts` 是后端未覆盖时的构建期默认视野。

## 语言

中、英、法、俄、西，每个文件一份扁平 key 表。选择记在 `localStorage` 的 `aredn.lang`，挂载后生效，
所以产物始终只有一份 HTML。`{n}`、`{time}` 这类插占位符是契约的一部分，翻译时必须原样保留。

## 注意

- 送给底图的坐标是 GCJ-02，界面上打印的数字一律是 WGS-84。
- 频段键与颜色随数据一起来，地图、网状图与列表不会各说各话。
- 跨域请求不带凭据，API 不需要 cookie 或会话。
