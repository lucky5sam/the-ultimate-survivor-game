<script setup lang="ts">
// Ambient, purely-decorative fire glow (Survivor torch atmosphere): a soft
// flickering glow anchored to the bottom edge, with optional embers drifting up.
//
// Non-interactive by design:
//  - `pointer-events: none` — it never intercepts clicks, hovers, or scrolls,
//    so anything layered under it stays fully usable no matter the z-index.
//  - `aria-hidden` + no focusable content — assistive tech skips it entirely.
//  - honors `prefers-reduced-motion` by holding a steady glow (no animation,
//    no embers).
//
// Positioning: `fixed` (default) pins it to the viewport bottom so it lingers
// as you scroll; `absolute` pins it to the nearest positioned ancestor, letting
// you scope the glow to a single section (give that section `relative`).
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    height?: number // height of the glow band, px
    position?: 'fixed' | 'absolute'
    zIndex?: number
    embers?: boolean // rising ember particles
    emberCount?: number
  }>(),
  // Defaults above app content. Safe because `pointer-events: none` means it
  // never intercepts input no matter how high it stacks.
  { height: 120, position: 'fixed', zIndex: 9999, embers: true, emberCount: 12 },
)

// Randomized once at mount (Math.random is fine in browser runtime). Each ember
// carries its own spread, size, drift, rise height, speed, and start delay via
// CSS custom properties so no two move in lockstep. Spread across the width in
// even lanes, then jittered, so they don't clump.
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const embers = computed(() => {
  if (!props.embers) return []
  const n = Math.max(0, props.emberCount)
  const lane = 100 / n
  return Array.from({ length: n }, (_, i) => ({
    key: i,
    left: `${Math.min(98, Math.max(2, (i + 0.5) * lane + rand(-lane / 2, lane / 2)))}%`,
    size: `${rand(2, 5).toFixed(1)}px`,
    drift: `${rand(-28, 28).toFixed(0)}px`,
    rise: `${rand(120, 210).toFixed(0)}px`,
    duration: `${rand(2, 3.8).toFixed(2)}s`,
    delay: `${rand(0, 5).toFixed(2)}s`,
  }))
})
</script>

<template>
  <div
    aria-hidden="true"
    class="fire-glow-root pointer-events-none select-none"
    :style="{ position, zIndex, height: `${height}px` }"
  >
    <!-- Blurred glow band. Embers must NOT live inside it or the blur eats them. -->
    <div class="fire-glow" />

    <!-- Un-blurred ember layer, painted on top of the glow. -->
    <div v-if="embers.length" class="embers">
      <span
        v-for="e in embers"
        :key="e.key"
        class="ember"
        :style="{
          left: e.left,
          '--size': e.size,
          '--drift': e.drift,
          '--rise': e.rise,
          animationDuration: e.duration,
          animationDelay: e.delay,
        }"
      />
    </div>
  </div>
</template>

<style scoped>
.fire-glow-root {
  left: 0;
  right: 0;
  bottom: 0;
  /* overflow visible so embers can rise past the band's top edge */
}

.fire-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at bottom, #ffc04d 10%, #ff5500 60%, #4a0000 100%);
  filter: blur(120px);
  box-shadow:
    0 -20px 60px 25px rgba(255, 90, 0, 0.4),
    0 -40px 110px 50px rgba(255, 160, 0, 0.25);
  transform-origin: bottom center;
  /* A fast, non-alternating loop gives a continuous, campfire-like flicker. */
  animation: fire-glow-flicker 3.4s infinite ease-in-out;
}

.embers {
  position: absolute;
  inset: 0;
}

.ember {
  position: absolute;
  bottom: 6px;
  width: var(--size);
  height: var(--size);
  border-radius: 9999px;
  background: radial-gradient(circle, #ffd98a 0%, #ff7a1a 55%, rgba(255, 120, 0, 0) 72%);
  filter: blur(0.6px);
  opacity: 0;
  will-change: transform, opacity;
  animation-name: ember-rise;
  animation-iteration-count: infinite;
  animation-timing-function: ease-out;
}

@keyframes fire-glow-flicker {
  0%,
  100% {
    transform: scale(1) skewX(0deg);
    border-radius: 20% 20% 10% 10% / 40% 40% 10% 10%;
    opacity: 0.42;
  }
  20% {
    transform: scale(1.04, 1.08) skewX(-3deg) translateX(-4px);
    border-radius: 40% 25% 15% 10% / 55% 45% 15% 10%; /* left side reaches up */
    opacity: 0.3;
    box-shadow:
      0 -25px 70px 30px rgba(255, 100, 0, 0.42),
      0 -45px 125px 55px rgba(255, 170, 0, 0.28);
  }
  40% {
    transform: scale(0.96, 1.02) skewX(1deg) translateX(2px);
    border-radius: 25% 35% 10% 12% / 40% 50% 10% 12%; /* right side reaches up */
    opacity: 0.24;
  }
  65% {
    transform: scale(1.02, 0.95) skewX(-1deg) translateX(-1px);
    border-radius: 30% 30% 12% 8% / 35% 35% 12% 8%; /* squashes slightly */
    opacity: 0.48;
    box-shadow:
      0 -22px 65px 28px rgba(255, 95, 0, 0.4),
      0 -42px 115px 52px rgba(255, 165, 0, 0.26);
  }
  85% {
    transform: scale(0.98, 1.06) skewX(3deg) translateX(5px);
    border-radius: 20% 45% 8% 15% / 45% 60% 8% 15%; /* spikes to the right */
    opacity: 0.38;
  }
}

/* Rise, drift sideways, shrink, and fade. Fades in just above the flame and
   out before the top of its travel so embers "dissipate" rather than vanish. */
@keyframes ember-rise {
  0% {
    transform: translate3d(0, 0, 0) scale(1);
    opacity: 0;
  }
  12% {
    opacity: 0.95;
  }
  70% {
    opacity: 0.6;
  }
  100% {
    transform: translate3d(var(--drift), calc(-1 * var(--rise)), 0) scale(0.25);
    opacity: 0;
  }
}

/* Respect users who prefer reduced motion: keep the glow, drop the flicker
   and hide the embers entirely. */
@media (prefers-reduced-motion: reduce) {
  .fire-glow {
    animation: none;
    opacity: 0.38;
  }
  .embers {
    display: none;
  }
}
</style>
