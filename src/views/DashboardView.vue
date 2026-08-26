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
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load standings'
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
      <h2 class="text-2xl font-bold text-text-default">Dashboard</h2>
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
      <div
        v-for="(row, i) in rows"
        :key="row.teamId"
        class="flex items-center gap-4 border-t border-border-subtle px-4 py-3 first:border-t-0"
      >
        <span
          class="w-6 shrink-0 text-center text-base font-bold tabular-nums"
          :class="i === 0 ? 'text-survivor-sand' : 'text-text-subtle'"
        >{{ i + 1 }}</span>
        <span class="flex-1 truncate font-semibold text-text-default">{{ row.teamName ?? '(no name)' }}</span>
        <span
          class="shrink-0 text-base font-bold tabular-nums"
          :class="row.totalPoints >= 0 ? 'text-text-default' : 'text-status-error'"
        >{{ fmtPts(row.totalPoints) }}</span>
      </div>
    </BaseCard>
  </div>
</template>
