<script setup lang="ts">
// Swipe-to-confirm: drag the knob all the way across the track to fire
// `confirm`; let go early and it springs back. A deliberate gesture, so a
// stray tap can't reveal spoilers. Keyboard: focus the knob and press Enter.
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{ label: string; disabled?: boolean }>(), {
  disabled: false,
})
const emit = defineEmits<{ confirm: [] }>()

const KNOB = 48 // px, matches h-12 w-12
const track = ref<HTMLElement | null>(null)
const offset = ref(0) // px the knob has moved
const dragging = ref(false)
let startX = 0

const maxOffset = () => Math.max((track.value?.clientWidth ?? 0) - KNOB - 8, 1) // 4px inset each side
const progress = computed(() => Math.min(offset.value / maxOffset(), 1))

function onDown(e: PointerEvent) {
  if (props.disabled) return
  dragging.value = true
  startX = e.clientX - offset.value
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onMove(e: PointerEvent) {
  if (!dragging.value) return
  offset.value = Math.min(Math.max(e.clientX - startX, 0), maxOffset())
}
function onUp() {
  if (!dragging.value) return
  dragging.value = false
  if (progress.value >= 0.95) {
    offset.value = maxOffset()
    emit('confirm')
  } else {
    offset.value = 0
  }
}
function onKey(e: KeyboardEvent) {
  if (props.disabled || (e.key !== 'Enter' && e.key !== ' ')) return
  e.preventDefault()
  offset.value = maxOffset()
  emit('confirm')
}
</script>

<template>
  <div
    ref="track"
    class="relative h-14 w-full select-none overflow-hidden rounded-full bg-surface-strong"
    :class="disabled ? 'opacity-60' : ''"
  >
    <!-- Fill behind the knob as it travels -->
    <div
      class="absolute inset-y-0 left-0 rounded-full bg-interactive-accent/25"
      :class="dragging ? '' : 'transition-[width] duration-300'"
      :style="{ width: `${offset + KNOB + 8}px` }"
    ></div>
    <span
      class="pointer-events-none absolute inset-0 flex items-center justify-center px-14 text-center text-sm leading-tight font-semibold text-text-subtle"
      :style="{ opacity: 1 - progress }"
    >
      {{ label }}
    </span>
    <button
      type="button"
      role="slider"
      :aria-label="label"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(progress * 100)"
      :disabled="disabled"
      class="absolute left-1 top-1 flex h-12 w-12 touch-none items-center justify-center rounded-full bg-gradient-to-b from-interactive-accent-from to-interactive-accent-to text-text-on-accent shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
      :class="[
        dragging ? '' : 'transition-transform duration-300',
        disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
      ]"
      :style="{ transform: `translateX(${offset}px)` }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @keydown="onKey"
    >
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  </div>
</template>
