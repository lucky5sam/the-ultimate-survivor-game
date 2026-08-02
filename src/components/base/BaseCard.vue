<script setup lang="ts">
// Reusable surface container. Renders FLAT by default. The `surface-card`
// hook class lets the "raw" skin (see style.css) reskin it as wood/parchment
// with no change here. `material` records design intent — ignored in flat mode,
// picked up by the skin when data-skin="raw".
withDefaults(
  defineProps<{
    padding?: 'none' | 'sm' | 'md' | 'lg'
    material?: 'default' | 'parchment'
  }>(),
  { padding: 'md', material: 'default' },
)

const paddings: Record<string, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
}
</script>

<template>
  <div
    class="surface-card rounded-lg border border-border-subtle bg-surface-default shadow-sm"
    :data-material="material === 'default' ? undefined : material"
    :class="paddings[padding]"
  >
    <slot />
  </div>
</template>
