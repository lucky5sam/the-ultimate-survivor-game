<script setup lang="ts">
// Page-level loading indicator: a spinning "chasing tail" ring above a
// "Loading…" label. Used in place of the plain, static "Loading…" text on
// full-page loads.
//
// The arc grows and shrinks as it rotates (Material-style), built from an SVG
// circle with two layered animations — a fast spin plus an animated stroke dash
// — so no icon font is needed. Honors `prefers-reduced-motion` (see style block).
withDefaults(
  defineProps<{
    // Label under the spinner. Pass '' to hide it (just the spinner).
    label?: string
    // Ring diameter in px.
    size?: number
  }>(),
  { label: 'Loading…', size: 36 },
)
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 py-12" role="status" aria-live="polite">
    <svg
      class="spinner"
      :width="size"
      :height="size"
      viewBox="0 0 50 50"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="spinner-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="var(--color-survivor-fire)" />
          <stop offset="100%" stop-color="var(--color-survivor-sand)" />
        </linearGradient>
      </defs>
      <circle
        class="spinner-arc"
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="url(#spinner-gradient)"
        stroke-width="5"
        stroke-linecap="round"
      />
    </svg>
    <p v-if="label" class="text-sm text-text-muted">{{ label }}</p>
  </div>
</template>

<style scoped>
.spinner {
  /* Whole SVG spins; the arc length is animated on top for the chasing tail. */
  animation: spinner-rotate 0.9s linear infinite;
}

.spinner-arc {
  stroke-dasharray: 1, 200;
  stroke-dashoffset: 0;
  animation: spinner-dash 1.4s ease-in-out infinite;
}

@keyframes spinner-rotate {
  100% {
    transform: rotate(360deg);
  }
}

@keyframes spinner-dash {
  0% {
    stroke-dasharray: 1, 200;
    stroke-dashoffset: 0;
  }
  50% {
    stroke-dasharray: 90, 200;
    stroke-dashoffset: -35;
  }
  100% {
    stroke-dasharray: 90, 200;
    stroke-dashoffset: -124;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 2s;
  }
  .spinner-arc {
    animation: none;
    stroke-dasharray: 90, 200;
  }
}
</style>
