<script setup lang="ts">
const { locale } = useLang()

// Head owns the attribute: assigning documentElement.lang by hand gets rewritten
// on the next render.
useHead({ htmlAttrs: { lang: locale } })
</script>

<template>
  <NuxtPage />
</template>
