<script setup lang="ts">
// Shared roster card used by both the editable Team page and the read-only
// public team view. Renders the roster rows (position chip, avatar, name, tribe
// badge, individual score, in-game/voted-out status). The card header's right
// side and the footer are slots so each page supplies its own controls.
//
// Editable mode: set `chipInteractive` — the position chip becomes a button that
// emits `chip-click` (the parent opens its action menu). Read-only mode leaves
// the chip as a static label.
import { computed } from 'vue'
import ContestantAvatar from './ContestantAvatar.vue'
import type { ContestantFull } from '../types/contestant'

type ActivePlayer = {
  contestant_id: string
  role: 'mvp' | 'player'
  effective_from_episode: number
}

const props = withDefaults(
  defineProps<{
    players: ActivePlayer[]
    contestants: ContestantFull[]
    eliminatedEpisodeIdByContestant: Record<string, string | null>
    episodes: { id: string; number: number }[]
    pointsById: Record<string, number>
    title?: string
    chipInteractive?: boolean
    emptyText?: string
  }>(),
  { title: 'Roster', chipInteractive: false, emptyText: 'No roster set.' },
)

const emit = defineEmits<{ 'chip-click': [player: ActivePlayer, event: MouseEvent] }>()

function fmtPts(n: number) {
  return n.toFixed(1)
}

// Roster ordered MVP-first, with fixed position labels (MVP, P1, P2, P3).
const rosterSorted = computed(() =>
  [...props.players].sort((a, b) => (a.role === 'mvp' ? 0 : 1) - (b.role === 'mvp' ? 0 : 1)),
)
const positionLabel = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  let n = 0
  for (const pl of rosterSorted.value) {
    if (pl.role === 'mvp') map[pl.contestant_id] = 'MVP'
    else map[pl.contestant_id] = `P${++n}`
  }
  return map
})

function contestantName(id: string) {
  return props.contestants.find((c) => c.id === id)?.name ?? '?'
}
function contestantPhoto(id: string) {
  return props.contestants.find((c) => c.id === id)?.photo_url ?? null
}
function contestantTribe(id: string) {
  return props.contestants.find((c) => c.id === id)?.tribe ?? ''
}
function contestantFirstName(id: string) {
  return contestantName(id).split(' ')[0] ?? ''
}
function contestantLastName(id: string) {
  return contestantName(id).split(' ').slice(1).join(' ')
}
function playerStatus(id: string): { out: boolean; ep: number | null } {
  const epId = props.eliminatedEpisodeIdByContestant[id]
  if (!epId) return { out: false, ep: null }
  return { out: true, ep: props.episodes.find((e) => e.id === epId)?.number ?? null }
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border-subtle bg-surface-default">
    <div
      class="flex items-center justify-between border-b border-border-subtle bg-surface-subtle px-4 py-3"
    >
      <h3 class="text-sm font-semibold text-text-default">{{ title }}</h3>
      <slot name="header-actions" />
    </div>

    <div
      v-for="player in rosterSorted"
      :key="player.contestant_id"
      class="flex items-center justify-between border-b border-border-subtle px-4 py-3 last:border-0"
    >
      <div class="flex items-center gap-3">
        <button
          v-if="chipInteractive"
          @click="emit('chip-click', player, $event)"
          :class="[
            'w-11 shrink-0 cursor-pointer rounded-md py-1 text-center text-[10px] font-bold uppercase tracking-wide transition-colors hover:opacity-80',
            player.role === 'mvp'
              ? 'bg-survivor-sand/20 text-survivor-sand'
              : 'bg-surface-subtle text-text-subtle',
          ]"
        >
          {{ positionLabel[player.contestant_id] }}
        </button>
        <span
          v-else
          :class="[
            'w-11 shrink-0 rounded-md py-1 text-center text-[10px] font-bold uppercase tracking-wide',
            player.role === 'mvp'
              ? 'bg-survivor-sand/20 text-survivor-sand'
              : 'bg-surface-subtle text-text-subtle',
          ]"
          >{{ positionLabel[player.contestant_id] }}</span
        >

        <ContestantAvatar
          :photo-url="contestantPhoto(player.contestant_id)"
          :name="contestantName(player.contestant_id)"
          :tribe="contestantTribe(player.contestant_id)"
          show-tribe
        />
        <div>
          <p class="text-sm font-medium leading-tight">
            <span class="text-text-default">{{ contestantFirstName(player.contestant_id) }}</span>
            <span
              v-if="contestantLastName(player.contestant_id)"
              class="ml-1 hidden text-text-subtle sm:inline"
              >{{ contestantLastName(player.contestant_id) }}</span
            >
          </p>
          <div class="mt-0.5 text-xs text-text-muted">
            Ep {{ player.effective_from_episode }}–now
          </div>
        </div>
      </div>
      <div class="text-right">
        <p class="text-sm font-semibold tabular-nums text-text-default">
          {{ fmtPts(pointsById[player.contestant_id] ?? 0) }}
        </p>
        <p
          class="mt-0.5 text-xs"
          :class="playerStatus(player.contestant_id).out ? 'text-status-error' : 'text-text-muted'"
        >
          {{
            playerStatus(player.contestant_id).out
              ? `Voted Out Ep. ${playerStatus(player.contestant_id).ep}`
              : 'In the Game'
          }}
        </p>
      </div>
    </div>

    <div v-if="rosterSorted.length === 0" class="px-4 py-3 text-xs text-text-muted">
      {{ emptyText }}
    </div>

    <slot name="footer" />
  </div>
</template>
