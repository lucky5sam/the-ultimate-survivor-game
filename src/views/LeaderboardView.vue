<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { computeLeaderboard, type LeaderboardRow } from '../composables/useLeaderboard'
import { useSeasonStore } from '../stores/season'
import BaseCard from '../components/base/BaseCard.vue'

const seasonStore = useSeasonStore()
const rows = ref<LeaderboardRow[]>([])
const loading = ref(false)
const errorMsg = ref('')

// Guards against overlapping loads: if the season changes mid-fetch, only the
// latest request is allowed to write results (stale responses are dropped).
let loadSeq = 0

async function loadLeaderboard() {
  if (!seasonStore.selectedSeasonId) {
    rows.value = []
    return
  }
  const seq = ++loadSeq
  loading.value = true
  errorMsg.value = ''
  try {
    const result = await computeLeaderboard(seasonStore.selectedSeasonId)
    if (seq !== loadSeq) return
    rows.value = result
  } catch (e) {
    if (seq !== loadSeq) return
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load leaderboard'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function fmtPts(n: number) {
  return n.toFixed(1)
}

// Widest roster in the field, so every team gets the same number of player columns.
const maxPlayers = computed(
  () => rows.value.reduce((m, r) => Math.max(m, r.players.length), 0) || 4,
)

// Ranked rows with each roster sorted MVP-first, then by individual score.
const displayRows = computed(() =>
  rows.value.map((r, i) => ({
    ...r,
    rank: i + 1,
    roster: [...r.players].sort(
      (a, b) => (b.isMvp ? 1 : 0) - (a.isMvp ? 1 : 0) || b.points - a.points,
    ),
  })),
)

// The shared store owns the season list + selection; reload when it changes.
watch(() => seasonStore.selectedSeasonId, loadLeaderboard, { immediate: true })
onMounted(() => seasonStore.load())
</script>

<template>
  <div class="w-full px-4 py-8 sm:px-6">
    <h2 class="mb-6 text-2xl font-bold text-text-default">Leaderboard</h2>

    <p v-if="errorMsg" class="mb-4 text-sm text-status-error">{{ errorMsg }}</p>
    <div v-if="loading" class="text-sm text-text-muted">Loading…</div>

    <div v-else-if="!seasonStore.selectedSeasonId" class="text-sm text-text-muted">
      No active seasons right now.
    </div>

    <div v-else-if="rows.length === 0" class="text-sm text-text-muted">
      No teams registered yet.
    </div>

    <BaseCard v-else padding="none" class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-sm">
          <thead class="bg-surface-subtle text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th class="sticky left-0 z-10 w-52 bg-surface-subtle px-4 py-3 text-left">Team</th>
              <th class="sticky left-52 z-10 w-20 bg-surface-subtle px-4 py-3 text-right">Total</th>
              <template v-for="n in maxPlayers" :key="n">
                <th class="min-w-[8rem] px-4 py-3 text-left">Player {{ n }}</th>
                <th class="px-4 py-3 text-right">Pts</th>
              </template>
              <th class="min-w-[8rem] px-4 py-3 text-left">Current Bounty</th>
              <th class="px-4 py-3 text-right">Actions</th>
              <th class="px-4 py-3 text-right">Bounty Pts</th>
              <th class="px-4 py-3 text-right">Swaps</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in displayRows" :key="row.teamId" class="border-t border-border-subtle">
              <!-- Team (sticky): rank + name + owner -->
              <td class="sticky left-0 z-10 w-52 bg-surface-default px-4 py-3">
                <div class="flex items-center gap-3">
                  <span
                    class="w-5 shrink-0 text-center font-bold tabular-nums"
                    :class="row.rank === 1 ? 'text-survivor-sand' : 'text-text-subtle'"
                    >{{ row.rank }}</span
                  >
                  <div class="min-w-0">
                    <RouterLink
                      :to="`/team/${row.teamId}`"
                      class="block truncate font-semibold text-text-default hover:text-text-accent"
                      >{{ row.teamName ?? '(no name)' }}</RouterLink
                    >
                    <div v-if="row.ownerName" class="truncate text-xs text-text-muted">
                      {{ row.ownerName }}
                    </div>
                  </div>
                </div>
              </td>

              <!-- Total (sticky, next to team) -->
              <td
                class="sticky left-52 z-10 w-20 bg-surface-default px-4 py-3 text-right font-bold tabular-nums"
                :class="row.totalPoints >= 0 ? 'text-text-default' : 'text-status-error'"
              >
                {{ fmtPts(row.totalPoints) }}
              </td>

              <!-- Player columns: name and individual score in separate columns -->
              <template v-for="n in maxPlayers" :key="n">
                <td class="px-4 py-3 align-top">
                  <template v-if="row.roster[n - 1]">
                    <span class="text-text-default">{{ row.roster[n - 1]!.name }}</span
                    ><span v-if="row.roster[n - 1]!.isMvp" class="text-survivor-sand"> ★</span>
                  </template>
                  <span v-else class="text-text-subtle">—</span>
                </td>
                <td
                  class="whitespace-nowrap px-4 py-3 text-right align-top tabular-nums text-text-muted"
                >
                  <template v-if="row.roster[n - 1]">{{
                    fmtPts(row.roster[n - 1]!.points)
                  }}</template>
                  <span v-else class="text-text-subtle">—</span>
                </td>
              </template>

              <!-- Current bounty (blank until the pick locks in) -->
              <td class="px-4 py-3 align-top text-text-default">
                <span v-if="row.currentBountyName">{{ row.currentBountyName }}</span>
                <span v-else class="text-text-subtle">—</span>
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-right tabular-nums text-text-default">
                {{ fmtPts(row.actionPoints) }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right tabular-nums text-status-success">
                {{ row.bountyPoints > 0 ? '+' + fmtPts(row.bountyPoints) : '—' }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right tabular-nums text-status-error">
                {{ row.swapPenalty < 0 ? fmtPts(row.swapPenalty) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </BaseCard>
  </div>
</template>
