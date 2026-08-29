<script setup lang="ts">
// Shared bounty-history card used by the editable Team page and the read-only
// public team view. Renders per-episode rows (pick avatar + hit/missed/locked/
// pending badge). Row-level edit controls come from the `row-action` slot, so
// the public view simply omits them.
import ContestantAvatar from './ContestantAvatar.vue'
import { displayName, shortName } from '../utils/contestantName'
import type { ContestantFull } from '../types/contestant'
import type { BountyHistoryRow } from '../types/bounty'

const props = withDefaults(
  defineProps<{
    rows: BountyHistoryRow[]
    contestants: ContestantFull[]
    title?: string
    emptyText?: string
    // Show the pick's tribe name as a subtext under their name.
    showTribe?: boolean
    // Make each row clickable to open the contestant detail modal.
    detailsInteractive?: boolean
  }>(),
  {
    title: 'Bounty Pick',
    emptyText: 'No bounty history yet',
    showTribe: false,
    detailsInteractive: false,
  },
)

const emit = defineEmits<{ 'open-details': [contestantId: string] }>()

function fmtPts(n: number) {
  return n.toFixed(1)
}
function contestantName(id: string) {
  const c = props.contestants.find((c) => c.id === id)
  return c ? displayName(c) : '?'
}
// Primary (bold) label leads with the preferred name; secondary (muted, sm+)
// is the last name — mirrors the roster list.
function contestantPrimary(id: string) {
  const c = props.contestants.find((c) => c.id === id)
  return c ? shortName(c) : '?'
}
function contestantSecondary(id: string) {
  return props.contestants.find((c) => c.id === id)?.last_name ?? ''
}
function contestantTribe(id: string) {
  return props.contestants.find((c) => c.id === id)?.tribe ?? ''
}
function contestantPhoto(id: string) {
  return props.contestants.find((c) => c.id === id)?.photo_url ?? null
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border-subtle bg-surface-default">
    <div
      class="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-subtle px-4 py-3"
    >
      <div class="min-w-0">
        <h3 class="text-sm font-semibold text-text-default">{{ title }}</h3>
        <slot name="subtitle" />
      </div>
      <slot name="header-actions" />
    </div>
    <div class="px-4">
      <div v-if="rows.length > 0" class="divide-y divide-border-subtle">
        <div
          v-for="row in rows"
          :key="row.episodeId"
          class="flex items-center gap-3 py-3"
          :class="[
            { 'opacity-60': row.state.kind === 'missed' },
            detailsInteractive && row.contestantId
              ? '-mx-4 cursor-pointer px-4 transition-colors hover:bg-surface-subtle'
              : '',
          ]"
          @click="detailsInteractive && row.contestantId && emit('open-details', row.contestantId)"
        >
          <span class="w-11 shrink-0 text-center text-sm font-semibold text-text-subtle"
            >E{{ row.number }}</span
          >
          <template v-if="row.contestantId">
            <ContestantAvatar
              :photo-url="contestantPhoto(row.contestantId)"
              :name="contestantName(row.contestantId)"
              border-color-override="var(--color-survivor-bounty)"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold leading-tight">
                <span class="text-text-default">{{ contestantPrimary(row.contestantId) }}</span>
                <span
                  v-if="contestantSecondary(row.contestantId)"
                  class="ml-1 hidden text-text-default sm:inline"
                  >{{ contestantSecondary(row.contestantId) }}</span
                >
              </p>
              <p
                v-if="showTribe && contestantTribe(row.contestantId)"
                class="mt-0.5 truncate text-xs text-text-muted"
              >
                {{ contestantTribe(row.contestantId) }}
              </p>
            </div>
          </template>
          <span v-else class="flex-1 text-sm text-text-muted">No pick set</span>

          <div class="flex shrink-0 items-center gap-2">
            <span
              v-if="row.state.kind === 'hit'"
              class="rounded-full bg-status-success-surface px-2 py-0.5 text-xs font-semibold text-status-success"
              >Hit +{{ fmtPts(row.state.points) }}</span
            >
            <span
              v-else-if="row.state.kind === 'missed'"
              class="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-semibold text-text-muted"
              >Missed</span
            >
            <span
              v-else-if="row.state.kind === 'upcoming'"
              class="rounded-full bg-status-warning-surface px-2 py-0.5 text-xs font-semibold text-status-warning"
              >Pending</span
            >
            <span
              v-else-if="row.state.kind === 'locked'"
              class="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-semibold text-text-muted"
            >
              <svg
                class="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              Locked
            </span>
            <span @click.stop><slot name="row-action" :row="row" /></span>
          </div>
        </div>
      </div>
      <p v-else class="py-3 text-sm text-text-muted">{{ emptyText }}</p>
    </div>
    <slot name="footer" />
  </div>
</template>
