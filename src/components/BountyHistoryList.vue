<script setup lang="ts">
// Shared bounty-history card used by the editable Team page and the read-only
// public team view. Renders per-episode rows (pick avatar + hit/missed/locked
// badge). Row-level edit controls come from the `row-action` slot, so the
// public view simply omits them.
import ContestantAvatar from './ContestantAvatar.vue'
import type { ContestantFull } from '../types/contestant'
import type { BountyHistoryRow } from '../types/bounty'

const props = withDefaults(
  defineProps<{
    rows: BountyHistoryRow[]
    contestants: ContestantFull[]
    title?: string
    emptyText?: string
  }>(),
  { title: 'Bounty Pick', emptyText: 'No bounty history yet' },
)

function fmtPts(n: number) {
  return n.toFixed(1)
}
function contestantName(id: string) {
  return props.contestants.find(c => c.id === id)?.name ?? '?'
}
function contestantPhoto(id: string) {
  return props.contestants.find(c => c.id === id)?.photo_url ?? null
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border-subtle bg-surface-default">
    <div class="flex items-center justify-between border-b border-border-subtle bg-surface-subtle px-4 py-3">
      <h3 class="text-sm font-semibold text-text-default">{{ title }}</h3>
      <slot name="header-actions" />
    </div>
    <div class="px-4 py-3">
      <div v-if="rows.length > 0" class="divide-y divide-border-subtle">
        <div
          v-for="row in rows"
          :key="row.episodeId"
          class="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
          :class="{ 'opacity-60': row.state.kind === 'missed' }"
        >
          <span class="w-10 shrink-0 text-xs font-semibold text-text-muted">Ep {{ row.number }}</span>
          <template v-if="row.contestantId">
            <ContestantAvatar
              :photo-url="contestantPhoto(row.contestantId)"
              :name="contestantName(row.contestantId)"
              :size="28"
            />
            <span class="flex-1 truncate text-sm text-text-default">{{ contestantName(row.contestantId) }}</span>
          </template>
          <span v-else class="flex-1 text-sm text-text-muted">No pick set</span>

          <div class="flex shrink-0 items-center gap-2">
            <span
              v-if="row.state.kind === 'hit'"
              class="rounded-full bg-status-success-surface px-2 py-0.5 text-xs font-semibold text-status-success"
            >Hit +{{ fmtPts(row.state.points) }}</span>
            <span
              v-else-if="row.state.kind === 'missed'"
              class="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-semibold text-text-muted"
            >Missed</span>
            <span
              v-else-if="row.state.kind === 'locked'"
              class="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-semibold text-text-muted"
            >
              <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Locked
            </span>
            <slot name="row-action" :row="row" />
          </div>
        </div>
      </div>
      <p v-else class="text-sm text-text-muted">{{ emptyText }}</p>
    </div>
  </div>
</template>
