<script setup lang="ts">
// Heatmap table of every contestant's points by episode: contestants down the
// side (sorted by season total), episodes across the top, a Total column at the
// end. Each cell shows the number, shaded by how many points it is:
//   • gaining points — green, deeper = more
//   • losing points  — red, deeper = more lost
//   • zero           — no fill
// The number is always printed, so the shading is a guide, never the only cue.
// After a contestant is voted out their remaining cells are blank.
//
// Scrolls sideways when there are many episodes, with the player and Total
// columns pinned on the left. The player column has a fixed width so the Total
// column knows where to pin (left-40).
import { computed } from 'vue'
import ContestantAvatar from './ContestantAvatar.vue'

export type PlayerScoreRow = {
  id: string
  name: string
  photoUrl: string | null
  tribe: string | null // for the photo's tribe-color ring
  // Episode number they were voted out in (their last scoring episode), or null.
  eliminatedEp: number | null
  byEpisode: Record<number, number>
  total: number
}

const props = defineProps<{
  rows: PlayerScoreRow[] // already sorted
  episodes: number[] // ascending
}>()

// The biggest single-episode swing either way sets the shading scale, so the
// deepest shade always means "the best (or worst) episode anyone had".
const maxAbs = computed(() => {
  let m = 0
  for (const r of props.rows)
    for (const v of Object.values(r.byEpisode)) m = Math.max(m, Math.abs(v))
  return m || 1
})

function played(r: PlayerScoreRow, ep: number) {
  return r.eliminatedEp == null || ep <= r.eliminatedEp
}

// Fill as a mix of the series color into the card surface: 12% for the smallest
// non-zero value up to 55% for the largest, which keeps default text readable
// on every shade in both light and dark mode.
function cellStyle(v: number) {
  if (!v) return {}
  const pct = Math.round(12 + 43 * Math.min(1, Math.abs(v) / maxAbs.value))
  const color = v > 0 ? 'var(--color-chart-gain)' : 'var(--color-chart-loss)'
  return { backgroundColor: `color-mix(in oklab, ${color} ${pct}%, transparent)` }
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr>
          <th
            class="sticky left-0 z-10 w-40 min-w-40 max-w-40 bg-surface-default py-2 pl-6 pr-3 text-left text-xs font-medium text-text-subtle"
          >
            Player
          </th>
          <th
            class="sticky left-40 z-10 border-r border-border-subtle bg-surface-default py-2 pl-1 pr-3 text-right text-xs font-medium text-text-subtle"
          >
            Total
          </th>
          <th
            v-for="ep in episodes"
            :key="ep"
            class="min-w-11 px-0.5 py-2 text-center text-xs font-medium text-text-subtle last:pr-6"
          >
            E{{ ep }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id" :class="r.eliminatedEp != null ? 'opacity-70' : ''">
          <!-- Pinned player column -->
          <th
            scope="row"
            class="sticky left-0 z-10 w-40 min-w-40 max-w-40 border-t border-border-subtle bg-surface-default py-1.5 pl-6 pr-3 text-left font-normal"
          >
            <div class="flex min-w-0 items-center gap-2">
              <ContestantAvatar
                :photo-url="r.photoUrl"
                :name="r.name"
                :tribe="r.tribe"
                :grayscale="r.eliminatedEp != null"
                :size="24"
              />
              <span
                class="min-w-0 truncate font-semibold"
                :class="r.eliminatedEp != null ? 'text-text-muted' : 'text-text-default'"
                >{{ r.name }}</span
              >
            </div>
          </th>
          <!-- Pinned season total, right beside the player -->
          <td
            class="sticky left-40 z-10 border-r border-t border-border-subtle bg-surface-default py-1.5 pl-1 pr-3 text-right font-semibold tabular-nums text-text-default"
          >
            {{ fmt(r.total) }}
          </td>
          <!-- One cell per episode; blank once they're out -->
          <td
            v-for="ep in episodes"
            :key="ep"
            class="border-t border-border-subtle p-0.5 text-center last:pr-6"
          >
            <div
              v-if="played(r, ep)"
              class="rounded px-1 py-1 tabular-nums"
              :class="(r.byEpisode[ep] ?? 0) === 0 ? 'text-text-muted' : 'text-text-default'"
              :style="cellStyle(r.byEpisode[ep] ?? 0)"
              :title="`${r.name} · Ep ${ep} · ${fmt(r.byEpisode[ep] ?? 0)} pts`"
            >
              {{ fmt(r.byEpisode[ep] ?? 0) }}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
