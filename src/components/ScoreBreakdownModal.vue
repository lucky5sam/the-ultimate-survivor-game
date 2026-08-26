<script setup lang="ts">
// Shared score-breakdown modal used by the Team page and the public team view.
// Purely presentational — the parent computes the TeamBreakdown and owns the
// open/close state.
import BaseModal from './base/BaseModal.vue'
import type { TeamBreakdown } from '../composables/useLeaderboard'

defineProps<{
  show: boolean
  loading: boolean
  breakdown: TeamBreakdown | null
}>()

defineEmits<{ close: [] }>()

function fmtPts(n: number) {
  return n.toFixed(1)
}
</script>

<template>
  <BaseModal :show="show" title="Score Breakdown" size="md" @close="$emit('close')">
    <div v-if="loading" class="py-6 text-center text-sm text-text-muted">Loading…</div>
    <div v-else-if="breakdown" class="max-h-[60vh] overflow-y-auto">
      <!-- Player contributions -->
      <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Players</p>
      <div class="divide-y divide-border-subtle">
        <div
          v-for="(s, i) in breakdown.stints"
          :key="i"
          class="flex items-center justify-between gap-3 py-2"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-text-default">
              {{ s.name }}<span v-if="s.role === 'mvp'" class="ml-1 text-survivor-sand">★</span>
            </p>
            <p class="text-xs text-text-muted">
              Ep {{ s.fromEpisode }}–{{ s.toEpisode ?? 'now' }}<template v-if="s.role === 'mvp'"> · MVP ×1.5</template>
            </p>
          </div>
          <span class="shrink-0 text-sm font-semibold tabular-nums text-text-default">{{ fmtPts(s.points) }}</span>
        </div>
      </div>

      <!-- Bounty hits -->
      <template v-if="breakdown.bountyHits.length">
        <p class="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">Bounty Hits</p>
        <div class="divide-y divide-border-subtle">
          <div
            v-for="(b, i) in breakdown.bountyHits"
            :key="i"
            class="flex items-center justify-between gap-3 py-2"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-text-default">{{ b.name }}</p>
              <p class="text-xs text-text-muted">Ep {{ b.episodeNumber }}</p>
            </div>
            <span class="shrink-0 text-sm font-semibold tabular-nums text-status-success">+{{ fmtPts(b.points) }}</span>
          </div>
        </div>
      </template>

      <!-- Swaps -->
      <template v-if="breakdown.swaps.length">
        <p class="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">Swaps</p>
        <div class="divide-y divide-border-subtle">
          <div
            v-for="(sw, i) in breakdown.swaps"
            :key="i"
            class="flex items-center justify-between gap-3 py-2"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-text-default">
                {{ sw.type === 'role_change' ? 'MVP change' : 'Roster swap' }}
              </p>
              <p class="truncate text-xs text-text-muted">
                {{ sw.type === 'role_change'
                    ? `Made ${sw.addedName} MVP before Ep ${sw.episode}`
                    : `Swapped ${sw.removedName} for ${sw.addedName} before Ep ${sw.episode}` }}
              </p>
            </div>
            <span
              class="shrink-0 text-sm font-semibold tabular-nums"
              :class="sw.penalty === 0 ? 'text-text-muted' : 'text-status-error'"
            >{{ sw.penalty === 0 ? 'Free' : fmtPts(sw.penalty) }}</span>
          </div>
        </div>
      </template>

      <!-- Total -->
      <div class="mt-4 flex items-center justify-between border-t border-border-default pt-3">
        <p class="text-sm font-bold text-text-default">Total</p>
        <span class="text-base font-bold tabular-nums text-text-default">{{ fmtPts(breakdown.totalPoints) }}</span>
      </div>
    </div>
    <p v-else class="py-6 text-center text-sm text-text-muted">Couldn't load the breakdown.</p>
  </BaseModal>
</template>
