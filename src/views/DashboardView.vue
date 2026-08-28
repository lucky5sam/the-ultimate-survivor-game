<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
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
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load standings'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function fmtPts(n: number) {
  return n.toFixed(1)
}

// The shared store owns the season list + selection; reload when it changes.
watch(() => seasonStore.selectedSeasonId, loadLeaderboard, { immediate: true })
onMounted(() => seasonStore.load())
</script>

<template>
  <div class="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
    <h2 class="mb-6 text-2xl font-bold text-text-default">Dashboard</h2>

    <p v-if="errorMsg" class="mb-4 text-sm text-status-error">{{ errorMsg }}</p>
    <div v-if="loading" class="text-sm text-text-muted">Loading…</div>

    <div v-else-if="!seasonStore.selectedSeasonId" class="text-sm text-text-muted">
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
          >{{ i + 1 }}</span
        >
        <RouterLink
          :to="`/team/${row.teamId}`"
          class="flex-1 truncate font-semibold text-text-default hover:text-text-accent"
          >{{ row.teamName ?? '(no name)' }}</RouterLink
        >
        <span
          class="shrink-0 text-base font-bold tabular-nums"
          :class="row.totalPoints >= 0 ? 'text-text-default' : 'text-status-error'"
          >{{ fmtPts(row.totalPoints) }}</span
        >
      </div>
    </BaseCard>
  </div>
</template>
