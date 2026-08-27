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

// The alternate image is the default face of the card; the original photo shows
// on hover. Both are rendered and cross-faded (no reload flash). We only swap
// when both exist — otherwise whichever image we have stays put.
const baseImage = computed(() => props.contestant.alt_image ?? props.contestant.photo_url)
const hoverImage = computed(() =>
  props.contestant.alt_image && props.contestant.photo_url ? props.contestant.photo_url : null,
)
const showHoverImage = computed(() => hovered.value && !!hoverImage.value)

const isInteractive = computed(() => !props.disabled)

// Touch handling: on iOS a hover-reactive <div> needs two taps (the first only
// triggers :hover). We select on touchend instead so the FIRST tap picks the
// card — but only when it was a tap, not a scroll, and we suppress the ghost
// click so desktop's @click doesn't fire it a second time.
let touchStartX = 0
let touchStartY = 0
let touchMoved = false
function onTouchStart(e: TouchEvent) {
  const t = e.changedTouches[0]
  if (!t) return
  touchStartX = t.clientX
  touchStartY = t.clientY
  touchMoved = false
}
function onTouchMove(e: TouchEvent) {
  const t = e.changedTouches[0]
  if (!t) return
  if (Math.abs(t.clientX - touchStartX) > 10 || Math.abs(t.clientY - touchStartY) > 10) {
    touchMoved = true
  }
}
function onTouchEnd(e: TouchEvent) {
  if (touchMoved) return // was a scroll, not a tap
  e.preventDefault() // stop the follow-up ghost click
  hovered.value = false
  // A tap on the info button bubbles up here too; because we suppress the ghost
  // click above, the button's own @click never fires on touch. Route it manually.
  if ((e.target as HTMLElement).closest('[data-info-button]')) {
    emit('view-details')
    return
  }
  if (isInteractive.value) emit('select')
}
const isHighlighted = computed(() => props.selected || (hovered.value && isInteractive.value))

const cardStyle = computed(() => ({
  borderColor: isHighlighted.value ? colors.value.primary : '#44403c',
  boxShadow: isHighlighted.value ? `0 0 28px ${colors.value.primary}55` : 'none',
}))
</script>

<template>
  <div
    class="relative rounded-2xl overflow-hidden border-2 select-none transition-all duration-300 ease-out group aspect-square sm:aspect-[2/3]"
    :class="[
      isInteractive ? 'cursor-pointer' : 'cursor-not-allowed',
      disabled ? 'opacity-30' : '',
      isHighlighted ? 'scale-[1.04]' : 'scale-100',
    ]"
    :style="cardStyle"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @click="isInteractive && emit('select')"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend="onTouchEnd"
  >
    <!-- Photo background: alt image by default, original cross-fades in on hover -->
    <div class="absolute inset-0 bg-stone-800">
      <template v-if="baseImage">
        <img
          :src="baseImage"
          :alt="contestant.name"
          class="w-full h-full object-cover object-top transition-opacity duration-300"
          :class="showHoverImage ? 'opacity-0' : 'opacity-100'"
        />
        <img
          v-if="hoverImage"
          :src="hoverImage"
          :alt="contestant.name"
          class="absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-300"
          :class="showHoverImage ? 'opacity-100' : 'opacity-0'"
        />
      </template>
      <div v-else class="absolute inset-0 flex items-center justify-center">
        <svg class="w-12 h-12 text-stone-600" fill="currentColor" viewBox="0 0 24 24">
          <path
            d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
          />
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
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z" />
      </svg>
      <svg
        v-else
        class="w-4 h-4 text-stone-900"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="3"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>

    <!-- Info button — always visible so it's tappable on touch devices -->
    <button
      v-if="!disabled"
      data-info-button
      class="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-black/90 rounded-full flex items-center justify-center text-white z-10"
      @click.stop="emit('view-details')"
    >
      <svg
        class="w-3.5 h-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    </button>

    <!-- Bottom info -->
    <div class="absolute bottom-0 left-0 right-0 p-3 z-10">
      <p class="font-bold text-white text-sm leading-tight drop-shadow-sm">{{ contestant.name }}</p>
      <p class="text-xs mt-0.5 font-medium" :style="{ color: colors.text }">
        {{ contestant.tribe }}
      </p>
    </div>
  </div>
</template>
