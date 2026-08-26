<script setup lang="ts">
// Colored tribe letter-tile with a hover tooltip showing the full tribe name.
// The tooltip is teleported to <body> so it isn't clipped by the tables/cards
// (overflow-hidden / overflow-x-auto) the badge usually sits inside.
import { ref } from 'vue'
import { getTribeColors } from '../utils/tribeColors'

const props = withDefaults(defineProps<{ tribe: string; size?: number }>(), { size: 20 })

const showTip = ref(false)
const tipPos = ref({ x: 0, y: 0 })

function onEnter(e: MouseEvent) {
  if (!props.tribe) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tipPos.value = { x: rect.left + rect.width / 2, y: rect.top - 6 }
  showTip.value = true
}
function onLeave() {
  showTip.value = false
}
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-sm font-bold text-white"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.5)}px`,
      backgroundColor: getTribeColors(tribe).primary,
    }"
    :aria-label="tribe"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    >{{ tribe.charAt(0).toUpperCase() }}</span
  >

  <Teleport to="body">
    <div
      v-if="showTip && tribe"
      class="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-full rounded-md border border-border-subtle bg-surface-overlay px-2 py-1 text-xs font-medium text-text-default shadow-lg"
      :style="{ left: `${tipPos.x}px`, top: `${tipPos.y}px` }"
    >
      {{ tribe }}
    </div>
  </Teleport>
</template>
