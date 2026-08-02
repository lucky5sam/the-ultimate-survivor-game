<script setup lang="ts">
// The theme's ambient decor layer: ember glow + tropical fronds.
// Wrapped in `.theme-atmosphere`, which is display:none unless the "raw"
// skin is active — so views can drop this in freely and it stays invisible
// (and cost-free) until we flip data-skin="raw". Purely decorative.
import FireGlow from './FireGlow.vue'
import TropicalFrond from './TropicalFrond.vue'
</script>

<template>
  <div class="theme-atmosphere pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
    <FireGlow class="left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2" />
    <TropicalFrond
      class="absolute -bottom-10 -left-12 w-60 rotate-[8deg] text-material-frond opacity-25"
    />
    <TropicalFrond
      class="absolute -bottom-10 -right-12 w-60 -scale-x-100 rotate-[8deg] text-material-frond opacity-25"
    />
  </div>
</template>
