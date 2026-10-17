<script setup lang="ts">
import { useFilters, useMeshData } from '~/composables/useMeshStore'
import type { ViewMode } from '~/composables/useMeshStore'

const data = useMeshData()
const store = useFilters()
const { t } = useLang()

const view = store.view
const graphLayout = useState<'force' | 'radial'>('graph-layout', () => 'force')
const detailOpen = useState<boolean>('detail-open', () => false)

const { status, nodes, links, conn, lastSync, syncing, refreshStatus, refreshInventory } = data

const { visibleNodes, topology, visibleTopoNodes, visibleTopoLinks, selected, selectedNode, selectedLinks } = store

/** Best SNR per node, shared by the list, the map and the graph tooltip. */
const snrByNode = computed(() => {
  const m = new Map<string, number | null>()
  for (const l of links.value) {
    if (l.local_snr == null) continue
    for (const end of [l.from, l.to]) {
      const cur = m.get(end)
      if (cur == null || l.local_snr > cur) m.set(end, l.local_snr)
    }
  }
  return m
})

const mapMarkers = computed(() => visibleNodes.value.filter(n => n.has_location))

// Scanning is the backend's cron; rows stream over the socket as the sweep writes them, so a finished sweep needs no re-pull.
onMounted(() => {
  const saved = localStorage.getItem('aredn.view')
  if (saved === 'map' || saved === 'graph') view.value = saved
  // A live socket bootstraps with a full frame; HTTP is the fallback if none arrives.
  setTimeout(() => {
    if (!lastSync.value) refreshInventory()
  }, 3000)
})
watch(view, v => {
  if (import.meta.client) localStorage.setItem('aredn.view', v)
})

/** Selection is shared by all three views; the value is a node id, `null` clears it. */
function select(id: string | null) {
  if (!id) {
    selected.value = null
    detailOpen.value = false
    return
  }
  selected.value = id
}
watch(selected, n => {
  if (n) detailOpen.value = true
})

useHead({ title: computed(() => `${t('app.title')} · ${t('app.subtitle')}`) })
</script>

<template>
  <div class="min-h-screen bg-base-100 text-base-content">
    <AppHeader
      :status="status"
      :conn="conn"
      :last-sync="lastSync"
      :busy="syncing"
      @refresh="() => { refreshStatus(); refreshInventory() }"
    />

    <main class="mx-auto flex max-w-[1800px] flex-col gap-4 p-4">
      <SummaryCards :status="status" />

      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span v-if="syncing" class="badge badge-info gap-1">
          <span class="loading loading-dots loading-xs" /> {{ t('panel.pullAll') }}
        </span>
      </div>

      <IpLookupBox :nodes="nodes" @select="select" />

      <div class="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div class="xl:col-span-3 xl:self-start 2xl:col-span-2">
          <FilterRail :status="status" />
        </div>

        <!-- The list sits under the view it describes. -->
        <div class="flex flex-col items-stretch gap-4 self-start xl:col-span-9 2xl:col-span-10">

        <section class="card border border-base-300">
          <div class="card-body gap-2 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="card-title text-sm">
                  {{ view === 'map' ? t('panel.titleMap') : t('panel.titleGraph') }}
                </h2>
                <p class="text-[10px] opacity-60">
                  {{ view === 'map'
                    ? t('panel.showingMap', { shown: mapMarkers.length, hit: visibleNodes.length })
                    : t('panel.showingGraph', { nodes: visibleTopoNodes.length, links: visibleTopoLinks.length }) }}
                  <span v-if="view === 'graph' && topology.unconnected_nodes" class="ml-1 opacity-70">
                    · {{ t('panel.unconnected', { n: topology.unconnected_nodes }) }}
                  </span>
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <div v-if="view === 'graph'" class="join">
                  <button
                    class="btn join-item btn-xs"
                    :class="graphLayout === 'force' ? 'btn-primary' : 'border border-base-300'"
                    @click="graphLayout = 'force'"
                  >
                    {{ t('panel.layoutForce') }}
                  </button>
                  <button
                    class="btn join-item btn-xs"
                    :class="graphLayout === 'radial' ? 'btn-primary' : 'border border-base-300'"
                    @click="graphLayout = 'radial'"
                  >
                    {{ t('panel.layoutRadial') }}
                  </button>
                </div>
                <ViewSwitch :view="view" :map-count="mapMarkers.length" :graph-count="visibleTopoNodes.length" @update:view="view = $event" />
              </div>
            </div>

            <div class="relative h-[62vh] min-h-[440px] overflow-hidden rounded-lg border border-base-300">
              <ClientOnly>
                <MapBasemapView
                  v-if="view === 'map'"
                  :nodes="mapMarkers"
                  :links="visibleTopoLinks"
                  :selected="selected"
                  @select="select"
                />
                <GraphTopologyGraph
                  v-else
                  :nodes="visibleTopoNodes"
                  :links="visibleTopoLinks"
                  :selected="selected"
                  :layout="graphLayout"
                  :snr-by-node="snrByNode"
                  @select="select"
                  @detail="n => { select(n); detailOpen = true }"
                />
                <template #fallback>
                  <div class="flex h-full items-center justify-center text-sm opacity-60">
                    {{ t('panel.rendering') }}
                  </div>
                </template>
              </ClientOnly>

              <NodeDrawer
                v-if="detailOpen && selectedNode"
                :node="selectedNode"
                :links="selectedLinks"
                @close="detailOpen = false"
                @select="select"
              />
            </div>
          </div>
        </section>

        <section class="card border border-base-300">
          <div class="card-body p-3">
            <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 class="card-title text-sm">{{ t('panel.catalog') }}</h2>
              <span class="text-[10px] opacity-60">{{ t('panel.catalogCount', { total: nodes.length, shown: visibleNodes.length }) }}</span>
            </div>
            <div class="h-[430px] min-h-[430px]">
              <NodeTable :nodes="visibleNodes" :selected="selected" :snr-by-node="snrByNode" @select="select" />
            </div>
          </div>
        </section>
        </div>
      </div>

      <footer class="pb-6 text-center text-[10px] opacity-50">
        {{ t('app.title') }} · {{ t('footer.mapData') }} · {{ t('footer.nodeData') }}
      </footer>
    </main>
  </div>
</template>
