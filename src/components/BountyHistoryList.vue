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
    // Make the upcoming (pending) row's episode chip a button that opens the
    // bounty update flow. Left off for read-only views.
    pickInteractive?: boolean
    // Always show the last name (default only reveals it from sm+).
    expandNames?: boolean
  }>(),
  {
    title: 'Bounty Pick',
    emptyText: 'No bounty history yet',
    showTribe: false,
    detailsInteractive: false,
    pickInteractive: false,
    expandNames: false,
  },
)

const emit = defineEmits<{
  'open-details': [contestantId: string]
  'update-pick': []
}>()

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
          <button
            v-if="pickInteractive && row.state.kind === 'upcoming'"
            type="button"
            @click.stop="emit('update-pick')"
            class="w-11 shrink-0 cursor-pointer rounded-md bg-surface-subtle py-1 text-center text-[10px] font-bold uppercase tracking-wide text-text-default transition-colors hover:opacity-80"
          >
            E{{ row.number }}
          </button>
          <span
            v-else
            class="w-11 shrink-0 rounded-md bg-surface-subtle py-1 text-center text-[10px] font-bold uppercase tracking-wide text-text-subtle"
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
                  class="ml-1 text-text-default"
                  :class="expandNames ? 'inline' : 'hidden sm:inline'"
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
              class="text-right text-xs font-semibold text-status-success"
              >Hit +{{ fmtPts(row.state.points) }}</span
            >
            <span
              v-else-if="row.state.kind === 'missed'"
              class="text-right text-xs font-semibold text-text-muted"
              >Missed</span
            >
            <span
              v-else-if="row.state.kind === 'upcoming'"
              class="text-right text-xs font-semibold text-status-warning"
              >Pending</span
            >
            <span
              v-else-if="row.state.kind === 'locked'"
              class="text-right text-xs font-semibold text-text-muted"
              >Locked</span
            >
            <span @click.stop><slot name="row-action" :row="row" /></span>
          </div>
        </div>
      </div>
      <p v-else class="py-3 text-sm text-text-muted">{{ emptyText }}</p>
    </div>
    <slot name="footer" />
  </div>
</template>
