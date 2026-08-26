<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
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

watch(selectedSeasonId, loadLeaderboard)
onMounted(async () => { await loadSeasons(); await loadLeaderboard() })
</script>

<template>
  <div class="mx-auto w-full max-w-3xl px-6 py-8">
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
        <table class="w-full text-sm">
          <thead class="border-b border-border-subtle bg-surface-subtle text-left text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th class="w-10 px-4 py-3">#</th>
              <th class="px-4 py-3">Team</th>
              <th class="px-4 py-3">Players</th>
              <th class="px-4 py-3 text-right">Bounty</th>
              <th class="px-4 py-3 text-right">Swaps</th>
              <th class="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="row.teamId" class="border-t border-border-subtle first:border-t-0">
              <td
                class="px-4 py-3 font-bold tabular-nums"
                :class="i === 0 ? 'text-survivor-sand' : 'text-text-subtle'"
              >
                {{ i + 1 }}
              </td>
              <td class="px-4 py-3 font-semibold text-text-default">{{ row.teamName ?? '(no name)' }}</td>
              <td class="px-4 py-3 text-text-muted">
                <span v-for="(p, pi) in row.players" :key="p.name">
                  {{ p.name }}<span v-if="p.isMvp" class="text-survivor-sand">★</span><span v-if="pi < row.players.length - 1" class="mx-1 text-text-subtle">·</span>
                </span>
              </td>
              <td class="px-4 py-3 text-right tabular-nums text-status-success">
                {{ row.bountyPoints > 0 ? '+' + fmtPts(row.bountyPoints) : '—' }}
              </td>
              <td class="px-4 py-3 text-right tabular-nums text-status-error">
                {{ row.swapPenalty < 0 ? fmtPts(row.swapPenalty) : '—' }}
              </td>
              <td
                class="px-4 py-3 text-right font-semibold tabular-nums"
                :class="row.totalPoints >= 0 ? 'text-text-default' : 'text-status-error'"
              >
                {{ fmtPts(row.totalPoints) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </BaseCard>
  </div>
</template>
