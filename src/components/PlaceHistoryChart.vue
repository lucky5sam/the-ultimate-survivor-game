<script setup lang="ts">
// A team's leaderboard place after each completed episode, as a line chart.
// 1st place is at the top, so climbing the leaderboard reads as the line going
// up. Hover (or drag a finger) to see the episode, place, and points.
//
// Plain SVG sized to its container (measured with a ResizeObserver) so text and
// dots never stretch. Colors come from the theme tokens, so dark mode just works.
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { formatPlace } from '../utils/place'

export type PlacePoint = { episode: number; rank: number; tied: boolean; points: number }

const props = defineProps<{
  history: PlacePoint[] // ascending by episode
  teamCount: number
  // The lowest place that pays out (e.g. 3 when the top 3 are paid). Draws the
  // in-the-money line just below it. null/undefined hides the line.
  moneyCutoff?: number | null
}>()

// ── Size ──
const wrap = ref<HTMLDivElement | null>(null)
const width = ref(0)
const height = ref(0)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return
    width.value = entry.contentRect.width
    height.value = entry.contentRect.height
  })
  if (wrap.value) observer.observe(wrap.value)
})
onUnmounted(() => observer?.disconnect())

// Room for the y-axis place labels (left) and episode labels (bottom).
const pad = { top: 12, right: 12, bottom: 22, left: 28 }
const plotW = computed(() => Math.max(0, width.value - pad.left - pad.right))
const plotH = computed(() => Math.max(0, height.value - pad.top - pad.bottom))

// ── Scales ──
// The y range hugs the places this team has actually held (with a little air),
// so a move from 3rd to 5th is visible even in a 70-team league.
const yDomain = computed<[number, number]>(() => {
  const ranks = props.history.map((p) => p.rank)
  // Keep the in-the-money line in view, even when this team is far below it.
  if (props.moneyCutoff) ranks.push(props.moneyCutoff, props.moneyCutoff + 1)
  const max = Math.max(props.teamCount, 1)
  let lo = Math.max(1, Math.min(...ranks) - 1)
  let hi = Math.min(max, Math.max(...ranks) + 1)
  // Always show at least a few places of range so a flat line isn't pinned to an edge.
  while (hi - lo < 4 && (lo > 1 || hi < max)) {
    if (lo > 1) lo--
    if (hi - lo < 4 && hi < max) hi++
  }
  return [lo, Math.max(hi, lo + 1)]
})
function x(i: number) {
  const n = props.history.length
  return pad.left + (n <= 1 ? plotW.value / 2 : (i / (n - 1)) * plotW.value)
}
function y(rank: number) {
  const [lo, hi] = yDomain.value
  return pad.top + ((rank - lo) / (hi - lo)) * plotH.value
}

// A handful of whole-number place ticks across the range.
const yTicks = computed(() => {
  const [lo, hi] = yDomain.value
  const span = hi - lo
  const step = [1, 2, 5, 10, 20, 25, 50].find((s) => span / s <= 4) ?? 100
  const ticks: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t)
  if (lo === 1 && !ticks.includes(1)) ticks.unshift(1)
  return ticks
})
// Thin out episode labels when there are too many to fit.
const xLabelEvery = computed(() => {
  const n = props.history.length
  const fit = Math.max(1, Math.floor(plotW.value / 28))
  return Math.max(1, Math.ceil(n / fit))
})

// The in-the-money line sits halfway between the last paid place and the next,
// so every point above it is a paying place. Hidden if it would fall off the
// chart (e.g. every team gets paid).
const moneyY = computed(() => {
  const c = props.moneyCutoff
  if (!c) return null
  const [lo, hi] = yDomain.value
  const at = c + 0.5
  return at > lo && at < hi ? y(at) : null
})

const linePath = computed(() =>
  props.history.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.rank)}`).join(' '),
)

// ── Hover ──
const hoverIndex = ref<number | null>(null)
function onPointer(e: PointerEvent) {
  const n = props.history.length
  if (!n || !wrap.value) return
  const px = e.clientX - wrap.value.getBoundingClientRect().left
  const i = n <= 1 ? 0 : Math.round(((px - pad.left) / plotW.value) * (n - 1))
  hoverIndex.value = Math.min(n - 1, Math.max(0, i))
}
const hovered = computed(() =>
  hoverIndex.value === null ? null : (props.history[hoverIndex.value] ?? null),
)
// Keep the tooltip inside the chart near the edges.
const tooltipStyle = computed(() => {
  if (hoverIndex.value === null) return {}
  const left = Math.min(Math.max(x(hoverIndex.value), 60), width.value - 60)
  return { left: `${left}px`, top: '0px' }
})
</script>

<template>
  <div
    ref="wrap"
    class="relative h-full w-full touch-pan-y select-none"
    @pointermove="onPointer"
    @pointerdown="onPointer"
    @pointerleave="hoverIndex = null"
  >
    <!-- Absolutely positioned so the drawing never feeds back into the
         container's size: the container sets the width, the SVG just fills it
         (otherwise a wide SVG can hold a card open past a phone's screen). -->
    <svg
      v-if="width && height"
      :width="width"
      :height="height"
      class="absolute inset-0 block overflow-visible"
    >
      <!-- Recessive grid + place labels -->
      <g v-for="t in yTicks" :key="t">
        <line
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="y(t)"
          :y2="y(t)"
          stroke="var(--color-border-subtle)"
          stroke-width="1"
        />
        <text
          :x="pad.left - 8"
          :y="y(t)"
          text-anchor="end"
          dominant-baseline="middle"
          class="fill-text-muted text-[10px] tabular-nums"
        >
          {{ t }}
        </text>
      </g>

      <!-- In the money: a faint green band over the paying places, bounded by a
           dashed line. -->
      <template v-if="moneyY !== null">
        <rect
          :x="pad.left"
          :y="pad.top"
          :width="plotW"
          :height="Math.max(0, moneyY - pad.top)"
          fill="var(--color-status-success)"
          fill-opacity="0.08"
        />
        <line
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="moneyY"
          :y2="moneyY"
          stroke="var(--color-status-success)"
          stroke-width="1.5"
          stroke-dasharray="4 3"
        />
      </template>

      <!-- Episode labels -->
      <text
        v-for="(p, i) in history"
        v-show="i % xLabelEvery === 0 || i === history.length - 1"
        :key="p.episode"
        :x="x(i)"
        :y="height - 6"
        text-anchor="middle"
        class="fill-text-muted text-[10px]"
      >
        E{{ p.episode }}
      </text>

      <!-- Hover guide -->
      <line
        v-if="hoverIndex !== null"
        :x1="x(hoverIndex)"
        :x2="x(hoverIndex)"
        :y1="pad.top"
        :y2="height - pad.bottom"
        stroke="var(--color-border-default)"
        stroke-width="1"
        stroke-dasharray="3 3"
      />

      <!-- The line: 3px, round joins -->
      <path
        :d="linePath"
        fill="none"
        stroke="var(--color-survivor-sand)"
        stroke-width="3"
        stroke-linejoin="round"
        stroke-linecap="round"
      />

      <!-- Points: a 2px surface ring keeps them crisp where they sit on the line.
           The hovered point grows. -->
      <circle
        v-for="(p, i) in history"
        :key="`pt-${p.episode}`"
        :cx="x(i)"
        :cy="y(p.rank)"
        :r="i === hoverIndex ? 6.5 : 4.5"
        fill="var(--color-survivor-sand)"
        stroke="var(--color-surface-default)"
        stroke-width="2"
      />
    </svg>

    <!-- Tooltip -->
    <div
      v-if="hovered"
      class="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-md border border-border-default bg-surface-default px-2 py-1 text-xs shadow-sm"
      :style="tooltipStyle"
    >
      <span class="font-semibold text-text-default">Ep {{ hovered.episode }}</span>
      <span class="text-text-muted"> · </span>
      <span class="text-text-default">{{ formatPlace(hovered.rank, hovered.tied) }}</span>
      <span class="text-text-muted"> · {{ hovered.points.toFixed(1) }} pts</span>
    </div>
  </div>
</template>
