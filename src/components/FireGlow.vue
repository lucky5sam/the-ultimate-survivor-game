<script setup lang="ts">
// Ambient, purely-decorative fire glow (Survivor torch atmosphere). It anchors
// to the bottom edge and slowly flickers.
//
// Non-interactive by design:
//  - `pointer-events: none` — it never intercepts clicks, hovers, or scrolls,
//    so anything layered under it stays fully usable no matter the z-index.
//  - `aria-hidden` + no focusable content — assistive tech skips it entirely.
//  - honors `prefers-reduced-motion` by holding a steady glow (no animation).
//
// Positioning: `fixed` (default) pins it to the viewport bottom so it lingers
// as you scroll; `absolute` pins it to the nearest positioned ancestor, letting
// you scope the glow to a single section (give that section `relative`).
withDefaults(
  defineProps<{
    height?: number // height of the glow band, px
    position?: 'fixed' | 'absolute'
    zIndex?: number
  }>(),
  // Defaults above app content. Safe because `pointer-events: none` means it
  // never intercepts input no matter how high it stacks.
  { height: 120, position: 'fixed', zIndex: 9999 },
)
</script>

<template>
  <div
    aria-hidden="true"
    class="fire-glow pointer-events-none select-none"
    :style="{ position, zIndex, height: `${height}px` }"
  />
</template>

<style scoped>
.fire-glow {
  left: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(circle at bottom, #ffc04d 10%, #ff5500 60%, #4a0000 100%);
  filter: blur(120px);
  box-shadow:
    0 -20px 60px 25px rgba(255, 90, 0, 0.4),
    0 -40px 110px 50px rgba(255, 160, 0, 0.25);
  transform-origin: bottom center;
  /* A 5s non-alternating loop gives a continuous, evolving flicker. */
  animation: fire-glow-flicker 5s infinite ease-in-out;
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

/* Respect users who prefer reduced motion: keep the glow, drop the flicker. */
@media (prefers-reduced-motion: reduce) {
  .fire-glow {
    animation: none;
    opacity: 0.38;
  }
}
</style>
