<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { computeLeaderboard, type LeaderboardRow } from '../composables/useLeaderboard'
import BaseCard from '../components/base/BaseCard.vue'

type Season = { id: string; name: string }

const seasons = ref<Season[]>([])
const selectedSeasonId = ref('')
const rows = ref<LeaderboardRow[]>([])
const loading = ref(false)
const errorMsg = ref('')

async function loadSeasons() {
  const { data } = await supabase
    .from('seasons')
    .select('id, name')
    .in('status', ['upcoming', 'active'])
    .order('created_at', { ascending: false })
  seasons.value = data ?? []
  if (seasons.value.length > 0) selectedSeasonId.value = seasons.value[0]!.id
}

async function loadLeaderboard() {
  if (!selectedSeasonId.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    rows.value = await computeLeaderboard(selectedSeasonId.value)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load leaderboard'
  } finally {
    loading.value = false
  }
}

function fmtPts(n: number) {
  return n.toFixed(1)
}

// Widest roster in the field, so every team gets the same number of player columns.
const maxPlayers = computed(() => rows.value.reduce((m, r) => Math.max(m, r.players.length), 0) || 4)

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

watch(selectedSeasonId, loadLeaderboard)
onMounted(async () => { await loadSeasons(); await loadLeaderboard() })
</script>

<template>
  <div class="w-full px-4 py-8 sm:px-6">
    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-2xl font-bold text-text-default">Leaderboard</h2>
      <div v-if="seasons.length === 1" class="text-sm text-text-subtle">{{ seasons[0]?.name }}</div>
      <select
        v-else-if="seasons.length > 1"
        v-model="selectedSeasonId"
        class="rounded-md border border-interactive-input-border bg-interactive-input px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-border-accent"
      >
        <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <p v-if="errorMsg" class="mb-4 text-sm text-status-error">{{ errorMsg }}</p>
    <div v-if="loading" class="text-sm text-text-muted">Loading…</div>

    <div v-else-if="seasons.length === 0" class="text-sm text-text-muted">
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
              <th
                v-for="n in maxPlayers"
                :key="n"
                class="min-w-[8rem] px-4 py-3 text-left"
              >Player {{ n }}</th>
              <th class="px-4 py-3 text-right">Actions</th>
              <th class="px-4 py-3 text-right">Bounty</th>
              <th class="px-4 py-3 text-right">Swaps</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in displayRows"
              :key="row.teamId"
              class="border-t border-border-subtle"
            >
              <!-- Team (sticky): rank + name + owner -->
              <td class="sticky left-0 z-10 w-52 bg-surface-default px-4 py-3">
                <div class="flex items-center gap-3">
                  <span
                    class="w-5 shrink-0 text-center font-bold tabular-nums"
                    :class="row.rank === 1 ? 'text-survivor-sand' : 'text-text-subtle'"
                  >{{ row.rank }}</span>
                  <div class="min-w-0">
                    <div class="truncate font-semibold text-text-default">{{ row.teamName ?? '(no name)' }}</div>
                    <div v-if="row.ownerName" class="truncate text-xs text-text-muted">{{ row.ownerName }}</div>
                  </div>
                </div>
              </td>

              <!-- Total (sticky, next to team) -->
              <td
                class="sticky left-52 z-10 w-20 bg-surface-default px-4 py-3 text-right font-bold tabular-nums"
                :class="row.totalPoints >= 0 ? 'text-text-default' : 'text-status-error'"
              >{{ fmtPts(row.totalPoints) }}</td>

              <!-- Player columns: name + individual score -->
              <td v-for="n in maxPlayers" :key="n" class="px-4 py-3 align-top">
                <template v-if="row.roster[n - 1]">
                  <div class="truncate text-text-default">
                    {{ row.roster[n - 1]!.name }}<span v-if="row.roster[n - 1]!.isMvp" class="text-survivor-sand"> ★</span>
                  </div>
                  <div class="tabular-nums text-xs text-text-muted">{{ fmtPts(row.roster[n - 1]!.points) }}</div>
                </template>
                <span v-else class="text-text-subtle">—</span>
              </td>

              <td class="whitespace-nowrap px-4 py-3 text-right tabular-nums text-text-default">{{ fmtPts(row.actionPoints) }}</td>
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
