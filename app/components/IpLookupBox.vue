<script setup lang="ts">
import type { MeshNode } from '~/types'
import { probeSeen } from '~/types'
import { bandColor } from '~/composables/useMeshStore'

const props = defineProps<{ nodes: MeshNode[] }>()
const emit = defineEmits<{ (e: 'select', name: string): void }>()
const { t } = useLang()

const ip = ref('')
const submitted = ref('')

interface Hit {
  node: MeshNode
  viaKey: string
}

const result = computed<Hit[]>(() => {
  const q = submitted.value.trim()
  if (!q) return []
  const hits: Hit[] = []
  for (const n of props.nodes) {
    if (n.mesh_ip === q) hits.push({ node: n, viaKey: 'ipLookup.viaMesh' })
    else if ((n.aliases ?? []).includes(q)) hits.push({ node: n, viaKey: 'ipLookup.viaAlias' })
    else if ((n.local_devices ?? []).some(d => d.ip === q)) hits.push({ node: n, viaKey: 'ipLookup.viaLan' })
    else if ((n.neighbors ?? []).some(nb => nb.ip === q)) hits.push({ node: n, viaKey: 'ipLookup.viaContainer' })
    if (hits.length >= 6) break
  }
  return hits
})

function run() {
  submitted.value = ip.value
}
</script>

<template>
  <section class="card border border-base-300 bg-base-200/40">
    <div class="card-body flex-row flex-wrap items-center gap-3 p-3">
      <div class="min-w-40">
        <h2 class="card-title text-sm">{{ t('ipLookup.title') }}</h2>
      </div>
      <form class="join grow" @submit.prevent="run">
        <input
          v-model="ip"
          class="input input-sm join-item w-full bg-base-100 font-mono"
          :placeholder="t('ipLookup.placeholder')"
          :aria-label="t('ipLookup.aria')"
        />
        <button class="btn btn-sm join-item btn-primary" type="submit">{{ t('ipLookup.run') }}</button>
      </form>
      <div class="basis-full text-xs">
        <p v-if="!submitted" class="opacity-60">{{ t('ipLookup.hint') }}</p>
        <p v-else-if="!result.length" class="text-error">{{ t('ipLookup.miss', { ip: submitted }) }}</p>
        <ul v-else class="flex flex-wrap gap-2">
          <li v-for="h in result" :key="h.node.name + h.viaKey">
            <button class="btn btn-xs border border-base-300" @click="emit('select', h.node.name)">
              <i class="h-2 w-2 rounded-full" :style="{ backgroundColor: bandColor(h.node.band) }" />
              {{ h.node.name }}
              <span class="opacity-60">{{ t(h.viaKey) }}</span>
              <span :class="h.node.online ? 'text-success' : 'text-error'">
                {{ h.node.online ? t('state.online') : probeSeen(h.node) ? t('state.offline') : t('state.unprobed') }}
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
