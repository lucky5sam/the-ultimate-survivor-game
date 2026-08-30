<script setup lang="ts">
// Shared roster card used by both the editable Team page and the read-only
// public team view. Renders the roster rows (position chip, avatar, name, tribe
// badge, an "Out" chip for eliminated players, and individual score). The card
// header's right side and the footer are slots so each page supplies its own
// controls.
//
// Editable mode: set `chipInteractive` — the position chip becomes a button that
// emits `chip-click` (the parent opens its action menu). Read-only mode leaves
// the chip as a static label.
import { computed } from 'vue'
import ContestantAvatar from './ContestantAvatar.vue'
import { fullName, shortName } from '../utils/contestantName'
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
    showScores?: boolean
    detailsInteractive?: boolean
    // Always show the last name (default only reveals it from sm+).
    expandNames?: boolean
    // Show the contestant's occupation as the row subtext instead of the
    // episode range (used on the wizard's review step).
    showOccupation?: boolean
  }>(),
  {
    title: 'Roster',
    chipInteractive: false,
    emptyText: 'No roster set.',
    showScores: true,
    detailsInteractive: false,
    expandNames: false,
    showOccupation: false,
  },
)

const emit = defineEmits<{
  'chip-click': [player: ActivePlayer, event: MouseEvent]
  'open-details': [contestantId: string]
}>()

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

function contestantById(id: string) {
  return props.contestants.find((c) => c.id === id) ?? null
}
function contestantName(id: string) {
  const c = contestantById(id)
  return c ? fullName(c) : '?'
}
function contestantPhoto(id: string) {
  return contestantById(id)?.photo_url ?? null
}
function contestantTribe(id: string) {
  return contestantById(id)?.tribe ?? ''
}
// Primary (bold) label leads with the preferred name; secondary (muted, sm+)
// is the last name.
function contestantPrimary(id: string) {
  const c = contestantById(id)
  if (!c) return '?'
  // A player who goes by their last name has it set as their preferred name, so
  // the short name would duplicate the last-name secondary ("Kilby Kilby"). Fall
  // back to the first name so it reads "First Last" like the other rows.
  const last = (c.last_name ?? '').trim()
  if (last && last.toLowerCase() === shortName(c).toLowerCase()) return c.first_name
  return shortName(c)
}
function contestantSecondary(id: string) {
  return contestantById(id)?.last_name ?? ''
}
function contestantOccupation(id: string) {
  return contestantById(id)?.occupation ?? ''
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
      class="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-subtle px-4 py-3"
    >
      <div class="min-w-0">
        <h3 class="text-sm font-semibold text-text-default">{{ title }}</h3>
        <slot name="subtitle" />
      </div>
      <slot name="header-actions" />
    </div>

    <div
      v-for="player in rosterSorted"
      :key="player.contestant_id"
      class="flex items-center justify-between border-b border-border-subtle px-4 py-3 last:border-0"
      :class="detailsInteractive ? 'cursor-pointer transition-colors hover:bg-surface-subtle' : ''"
      @click="detailsInteractive && emit('open-details', player.contestant_id)"
    >
      <div class="flex items-center gap-3">
        <button
          v-if="chipInteractive"
          @click.stop="emit('chip-click', player, $event)"
          :class="[
            'w-11 shrink-0 cursor-pointer rounded-md py-1 text-center text-[10px] font-bold uppercase tracking-wide transition-colors hover:opacity-80',
            player.role === 'mvp'
              ? 'bg-survivor-sand/20 text-survivor-sand'
              : 'bg-surface-subtle text-text-default',
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
              : 'bg-surface-subtle text-text-default',
          ]"
          >{{ positionLabel[player.contestant_id] }}</span
        >

        <div class="flex items-center gap-3 text-left">
          <ContestantAvatar
            :photo-url="contestantPhoto(player.contestant_id)"
            :name="contestantName(player.contestant_id)"
            :tribe="contestantTribe(player.contestant_id)"
            :show-crown="player.role === 'mvp'"
            :grayscale="playerStatus(player.contestant_id).out"
            :border-color-override="
              playerStatus(player.contestant_id).out ? 'var(--color-border-subtle)' : null
            "
          />
          <div>
            <div class="flex items-center gap-1">
              <p class="text-sm font-semibold leading-tight">
                <span class="text-text-default">{{ contestantPrimary(player.contestant_id) }}</span>
                <span
                  v-if="contestantSecondary(player.contestant_id)"
                  class="ml-1 text-text-default"
                  :class="expandNames ? 'inline' : 'hidden sm:inline'"
                  >{{ contestantSecondary(player.contestant_id) }}</span
                >
              </p>
              <span
                v-if="player.role === 'mvp' && !playerStatus(player.contestant_id).out"
                class="shrink-0 text-sm font-semibold text-survivor-sand"
                >1.5x</span
              >
              <span
                v-if="playerStatus(player.contestant_id).out"
                class="shrink-0 text-sm font-semibold text-status-error"
                >Out</span
              >
            </div>
            <div class="mt-0.5 text-xs text-text-muted">
              <template v-if="showOccupation">{{
                contestantOccupation(player.contestant_id)
              }}</template>
              <template v-else
                >Ep {{ player.effective_from_episode }} – <template
                  v-if="
                    playerStatus(player.contestant_id).out && playerStatus(player.contestant_id).ep
                  "
                  >Ep {{ playerStatus(player.contestant_id).ep }}</template
                ><template v-else>now</template></template
              >
            </div>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div v-if="showScores" class="text-right">
          <p
            class="text-sm font-semibold tabular-nums"
            :class="
              playerStatus(player.contestant_id).out
                ? 'text-text-subtle'
                : player.role === 'mvp'
                  ? 'text-survivor-sand'
                  : 'text-text-default'
            "
          >
            {{ fmtPts(pointsById[player.contestant_id] ?? 0) }}
          </p>
        </div>
        <!-- Row actions (e.g. wizard Edit) are their own controls; don't let a
             click on them bubble up to the row's open-details handler. -->
        <span @click.stop><slot name="row-action" :player="player" /></span>
      </div>
    </div>

    <div v-if="rosterSorted.length === 0" class="px-4 py-3 text-xs text-text-subtle">
      {{ emptyText }}
    </div>

    <slot name="footer" />
  </div>
</template>
