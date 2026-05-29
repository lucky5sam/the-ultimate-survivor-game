<script setup lang="ts">
import { computed, ref } from 'vue'
import { getTribeColors } from '../utils/tribeColors'
import type { ContestantFull } from '../types/contestant'

const props = defineProps<{
  contestant: ContestantFull
  selected: boolean
  disabled: boolean
  showCrown?: boolean
}>()

const emit = defineEmits<{
  select: []
  'view-details': []
}>()

const colors = computed(() => getTribeColors(props.contestant.tribe))
const hovered = ref(false)

const isInteractive = computed(() => !props.disabled)
const isHighlighted = computed(() => props.selected || (hovered.value && isInteractive.value))

const cardStyle = computed(() => ({
  borderColor: isHighlighted.value ? colors.value.primary : '#44403c',
  boxShadow: isHighlighted.value ? `0 0 28px ${colors.value.primary}55` : 'none',
}))
</script>

<template>
  <div
    class="relative rounded-2xl overflow-hidden border-2 select-none transition-all duration-300 ease-out group"
    :class="[
      isInteractive ? 'cursor-pointer' : 'cursor-not-allowed',
      disabled ? 'opacity-30' : '',
      isHighlighted ? 'scale-[1.04]' : 'scale-100',
    ]"
    :style="[cardStyle, { aspectRatio: '2/3' }]"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @click="isInteractive && emit('select')"
  >
    <!-- Photo background -->
    <div class="absolute inset-0 bg-stone-800">
      <img
        v-if="contestant.photo_url"
        :src="contestant.photo_url"
        :alt="contestant.name"
        class="w-full h-full object-cover object-top"
      />
      <div v-else class="absolute inset-0 flex items-center justify-center">
        <svg class="w-12 h-12 text-stone-600" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
        </svg>
      </div>
    </div>

    <!-- Gradient overlay -->
    <div class="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/20 to-transparent" />

    <!-- Selected badge (checkmark or crown) -->
    <div
      v-if="selected"
      class="absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center shadow-lg z-10"
      :class="showCrown ? 'bg-amber-500' : 'bg-white'"
    >
      <svg v-if="showCrown" class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z"/>
      </svg>
      <svg v-else class="w-4 h-4 text-stone-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>

    <!-- Info button (visible on hover) -->
    <button
      v-if="!disabled"
      class="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-black/90 rounded-full flex items-center justify-center text-white z-10 transition-opacity duration-200"
      :class="hovered ? 'opacity-100' : 'opacity-0'"
      @click.stop="emit('view-details')"
    >
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>

    <!-- Bottom info -->
    <div class="absolute bottom-0 left-0 right-0 p-3 z-10">
      <p class="font-bold text-white text-sm leading-tight drop-shadow-sm">{{ contestant.name }}</p>
      <p class="text-xs mt-0.5 font-medium" :style="{ color: colors.text }">{{ contestant.tribe }}</p>
    </div>
  </div>
</template>
