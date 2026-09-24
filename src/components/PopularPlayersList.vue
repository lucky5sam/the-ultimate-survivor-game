<script setup lang="ts">
// Ranked list of contestants by how many teams roster them. Each row: photo,
// name (+ Out), the MVP / player split, a ×total, and a split bar scaled to the
// share of the league (a full bar = every team has them) — gold for MVP slots,
// blue for regular player slots. Shared by the dashboard's Most Popular Players
// card (top 5) and its "View All" modal (every contestant).
import ContestantAvatar from './ContestantAvatar.vue'

export type RosterShare = {
  contestantId: string
  name: string
  photoUrl: string | null
  tribe: string | null
  out: boolean
  mvp: number
  player: number
  total: number
}

const props = defineProps<{
  shares: RosterShare[] // already ranked
  teamCount: number // teams with a roster — the bar scale
}>()

function sharePct(n: number) {
  return props.teamCount ? (n / props.teamCount) * 100 : 0
}
</script>

<template>
  <div class="flex flex-col divide-y divide-border-subtle">
    <div
      v-for="p in shares"
      :key="p.contestantId"
      class="py-3.5 first:pt-0 last:pb-0"
      :title="`${p.name} is on ${p.total} of ${teamCount} teams (${p.mvp} as MVP, ${p.player} as player)`"
    >
      <!-- Photo on the left, spanning both lines; name + total on top, the split
           bar underneath. -->
      <div class="flex items-center gap-3">
        <ContestantAvatar
          :photo-url="p.photoUrl"
          :name="p.name"
          :tribe="p.tribe"
          :grayscale="p.out"
          :size="36"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 text-base">
            <p class="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold leading-tight">
              <span class="truncate" :class="p.out ? 'text-text-muted' : 'text-text-default'">{{
                p.name
              }}</span>
              <span v-if="p.out" class="shrink-0 text-xs text-status-error">Out</span>
              <!-- MVP / player split, beside the name -->
              <span class="shrink-0 text-xs font-normal text-text-subtle">
                {{ p.mvp }} MVP · {{ p.player }} player
              </span>
            </p>
            <span class="shrink-0 font-semibold tabular-nums text-text-default"
              >×{{ p.total }}</span
            >
          </div>
          <!-- Split bar on a neutral track. A 2px surface gap separates the two
               segments; an eliminated contestant's bar is dimmed. -->
          <div
            class="mt-2 flex h-2 w-full overflow-hidden rounded bg-surface-strong"
            :class="p.out ? 'opacity-40' : ''"
          >
            <div
              v-if="p.mvp"
              class="h-full bg-chart-mvp transition-[width] duration-500"
              :class="p.player ? 'border-r-2 border-surface-default' : ''"
              :style="{ width: `${sharePct(p.mvp)}%` }"
            ></div>
            <div
              v-if="p.player"
              class="h-full bg-chart-player transition-[width] duration-500"
              :style="{ width: `${sharePct(p.player)}%` }"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
