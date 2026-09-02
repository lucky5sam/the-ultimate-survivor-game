<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { computeLeaderboard, type LeaderboardRow } from '../composables/useLeaderboard'
import { formatPlaceShort } from '../utils/place'
import { useSeasonStore } from '../stores/season'
import { useAuthStore } from '../stores/auth'
import BaseCard from '../components/base/BaseCard.vue'
import BaseButton from '../components/base/BaseButton.vue'
import ContestantAvatar from '../components/ContestantAvatar.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import FireGlow from '../components/FireGlow.vue'
import LoadingState from '../components/LoadingState.vue'
import { loadTribeColors } from '../utils/tribeColors'
import parchmentUrl from '../assets/survivor_decor_parchment.svg'

const router = useRouter()
const seasonStore = useSeasonStore()
const auth = useAuthStore()
const rows = ref<LeaderboardRow[]>([])
const loading = ref(false)
const errorMsg = ref('')

// Guards against overlapping loads: if the season changes mid-fetch, only the
// latest request is allowed to write results (stale responses are dropped).
let loadSeq = 0

async function loadLeaderboard() {
  if (!seasonStore.selectedSeasonId) {
    rows.value = []
    paidPlaces.value = new Set()
    return
  }
  const seq = ++loadSeq
  loading.value = true
  errorMsg.value = ''
  try {
    await loadTribeColors(seasonStore.selectedSeasonId)
    const [result, places] = await Promise.all([
      computeLeaderboard(seasonStore.selectedSeasonId, null, auth.user?.id ?? null),
      fetchPaidPlaces(seasonStore.selectedSeasonId),
    ])
    if (seq !== loadSeq) return
    rows.value = result
    paidPlaces.value = places
  } catch (e) {
    if (seq !== loadSeq) return
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load leaderboard'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function fmtPts(n: number) {
  return n.toFixed(1)
}

// The signed-in user's own team, highlighted so they can find themselves fast.
function isMyTeam(ownerId: string) {
  return !!auth.user && ownerId === auth.user.id
}

// The signed-in user's team id in the current leaderboard (null if they have no
// team here). Drives the "My Team" jump button.
const myTeamId = computed(() => displayRows.value.find((r) => isMyTeam(r.ownerId))?.teamId ?? null)

// Scroll the user's own row into view. Mobile and desktop render separate rows;
// only the layout for the current viewport is visible (the other has no
// offsetParent), so we jump to whichever one is showing.
function scrollToMyTeam() {
  const id = myTeamId.value
  if (!id) return
  const el = [
    document.getElementById(`lb-m-${id}`),
    document.getElementById(`lb-d-${id}`),
  ].find((e) => e && e.offsetParent !== null)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// Widest roster in the field, so every team gets the same number of player columns.
const maxPlayers = computed(
  () => rows.value.reduce((m, r) => Math.max(m, r.players.length), 0) || 4,
)

// Ranked rows with each roster sorted MVP-first, then by individual score.
// `rank`/`tied` come from computeLeaderboard (standard competition ranking).
const displayRows = computed(() =>
  rows.value.map((r) => ({
    ...r,
    roster: [...r.players].sort(
      (a, b) => (b.isMvp ? 1 : 0) - (a.isMvp ? 1 : 0) || b.points - a.points,
    ),
  })),
)

// Finishing places that earn a payout (amount > 0) for the selected season.
// A team "in the money" gets a green row highlight that trumps the my-team gold.
const paidPlaces = ref<Set<number>>(new Set())

async function fetchPaidPlaces(seasonId: string): Promise<Set<number>> {
  const { data } = await supabase.from('seasons').select('payouts').eq('id', seasonId).single()
  const payouts = (data?.payouts ?? []) as { place: number; amount: number }[]
  return new Set(payouts.filter((p) => (p.amount ?? 0) > 0).map((p) => p.place))
}

// A team is only "in the money" once it has actually scored — this keeps every
// team from flashing the $ badge pre-season, when they're all tied at 0.
function inMoney(row: { rank: number; totalPoints: number }) {
  return row.totalPoints > 0 && paidPlaces.value.has(row.rank)
}
// Row background: my-team gold highlight. In-the-money is shown with a badge on
// the team avatar instead (see the template). The sticky variant is opaque so it
// masks horizontally-scrolled cells.
function rowBg(row: { rank: number; ownerId: string }) {
  return isMyTeam(row.ownerId) ? 'bg-surface-highlight' : 'bg-surface-default'
}
function stickyBg(row: { rank: number; ownerId: string }) {
  return isMyTeam(row.ownerId) ? 'bg-surface-highlight' : 'bg-surface-default'
}

// The shared store owns the season list + selection; reload when it changes.
watch(() => seasonStore.selectedSeasonId, loadLeaderboard, { immediate: true })
onMounted(() => seasonStore.load())
</script>

<template>
  <div class="w-full px-4 py-4 sm:px-6">
    <!-- Ambient fire glow at the bottom of the page, above content (decorative,
         non-interactive). -->
    <FireGlow position="fixed" :z-index="20" />
    <div class="relative z-10">
    <div class="mb-4 ml-1 flex items-start justify-between gap-3">
      <div class="flex-col">
        <h2 class="text-2xl font-bold text-text-default">Leaderboard</h2>
        <p class="text-text-subtle text-base">{{ rows.length }} total teams</p>
      </div>
      <BaseButton
        v-if="myTeamId"
        variant="secondary"
        size="sm"
        class="shrink-0"
        @click="scrollToMyTeam"
      >
        <i class="fa-solid fa-location-crosshairs"></i>
        <span>My Team</span>
      </BaseButton>
    </div>
    <p v-if="errorMsg" class="mb-4 text-sm text-status-error">{{ errorMsg }}</p>
    <LoadingState v-if="loading" />

    <div v-else-if="!seasonStore.selectedSeasonId" class="text-sm text-text-muted">
      No active seasons right now.
    </div>

    <div v-else-if="rows.length === 0" class="text-sm text-text-muted">
      No teams registered yet.
    </div>

    <template v-else>
      <!-- Mobile: condensed rows (rank · team · avatar group · score). Full-bleed
           past the page padding, flush together with dividers, to maximize space. -->
      <div class="-mx-4 border-y border-border-subtle sm:hidden">
        <!-- Column header, aligned to the row layout below. Sticks to the top of
             the viewport once the page header scrolls away. -->
        <div
          class="sticky top-0 z-20 flex items-center gap-2 border-b border-border-subtle bg-surface-subtle pl-2 py-2 pr-5 text-xs font-semibold uppercase tracking-wide text-text-subtle"
        >
          <span class="min-w-7 shrink-0 text-center">Pl</span>
          <span class="flex-1">Team</span>
          <span class="ml-2 min-w-17 shrink-0 text-center">Score</span>
        </div>
        <div class="divide-y divide-border-subtle">
          <RouterLink
            v-for="row in displayRows"
            :key="row.teamId"
            :id="isMyTeam(row.ownerId) ? `lb-m-${row.teamId}` : undefined"
            :to="`/team/${row.teamId}`"
            class="group flex items-center gap-2 pl-2 py-3 pr-4 transition-colors hover:bg-surface-subtle"
            :class="rowBg(row)"
          >
            <span
              class="min-w-7 shrink-0 text-center text-sm font-bold tabular-nums text-text-subtle"
              >{{ formatPlaceShort(row.rank, row.tied) }}</span
            >
            <div class="relative shrink-0">
              <TeamAvatar
                :image-url="row.teamImageUrl"
                :emoji="row.teamEmoji"
                :color="row.teamColor"
                :name="row.teamName ?? 'Team'"
                :size="40"
                class="rounded-sm border border-border-subtle"
              />
              <span
                v-if="inMoney(row)"
                class="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-status-success text-[10px] font-bold leading-none text-text-inverse ring-2 ring-surface-page"
                title="In the money"
                >$</span
              >
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold text-text-default group-hover:underline">
                {{ row.teamName ?? '(no name)' }}
              </p>
              <p v-if="row.ownerName" class="truncate text-sm text-text-subtle">
                {{ row.ownerName }}
              </p>
            </div>
            <div class="flex shrink-0 -space-x-1.5">
              <div
                v-for="(p, i) in row.roster"
                :key="p.contestantId"
                class="relative rounded-full"
                :style="{ zIndex: row.roster.length - i }"
              >
                <ContestantAvatar
                  :photo-url="p.photoUrl"
                  :name="p.name"
                  :tribe="p.tribe"
                  :grayscale="p.out"
                  :border-color-override="p.out ? 'var(--color-border-subtle)' : null"
                  :size="24"
                />
              </div>
            </div>
            <div
              class="ml-1 flex min-w-17 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-subtle px-3 py-1.5 shadow-sm"
            >
              <p
                class="text-sm font-bold tabular-nums"
                :class="row.totalPoints >= 0 ? 'text-text-default' : 'text-status-error'"
              >
                {{ fmtPts(row.totalPoints) }}
              </p>
            </div>
          </RouterLink>
        </div>
      </div>

      <!-- Desktop: full table -->
      <BaseCard padding="none" class="hidden overflow-hidden sm:block">
        <!-- Bounded height so vertical scrolling happens inside this container,
             which lets the header cells stick to the top while scrolling. -->
        <div class="max-h-[calc(100vh-11rem)] overflow-auto">
          <table class="w-full border-collapse text-sm">
            <thead class="text-xs uppercase tracking-wide text-text-subtle">
              <tr>
                <th
                  class="sticky left-0 top-0 z-30 w-60 min-w-60 bg-surface-subtle px-4 py-3 text-left"
                >
                  <div class="flex items-center gap-3">
                    <span>Pl</span>
                    <span>Team</span>
                  </div>
                </th>
                <th class="sticky left-60 top-0 z-30 w-20 bg-surface-subtle px-4 py-3 text-left">
                  Total
                </th>
                <template v-for="n in maxPlayers" :key="n">
                  <th class="sticky top-0 z-20 min-w-[8rem] bg-surface-subtle px-4 py-3 text-left">
                    {{ n === 1 ? 'MVP' : `Player ${n}` }}
                  </th>
                  <th class="sticky top-0 z-20 bg-surface-subtle px-4 py-3 text-left">Pts</th>
                </template>
                <th class="sticky top-0 z-20 min-w-[8rem] bg-surface-subtle px-4 py-3 text-left">
                  Bounty
                </th>
                <th class="sticky top-0 z-20 bg-surface-subtle px-4 py-3 text-left">Actions</th>
                <th
                  class="sticky top-0 z-20 whitespace-nowrap bg-surface-subtle px-4 py-3 text-left"
                >
                  Bty Pts
                </th>
                <th class="sticky top-0 z-20 bg-surface-subtle px-4 py-3 text-left">Swaps</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in displayRows"
                :key="row.teamId"
                :id="isMyTeam(row.ownerId) ? `lb-d-${row.teamId}` : undefined"
                class="group cursor-pointer border-t border-border-subtle transition-colors hover:bg-surface-subtle"
                :class="rowBg(row)"
                @click="router.push(`/team/${row.teamId}`)"
              >
                <!-- Team (sticky): rank + name + owner -->
                <td
                  class="sticky left-0 z-10 w-60 min-w-60 px-4 py-3 transition-colors group-hover:bg-surface-subtle"
                  :class="stickyBg(row)"
                >
                  <div class="flex items-center gap-3">
                    <span
                      class="min-w-5 shrink-0 text-center font-bold tabular-nums text-text-subtle"
                      >{{ formatPlaceShort(row.rank, row.tied) }}</span
                    >
                    <div class="relative shrink-0">
                      <TeamAvatar
                        :image-url="row.teamImageUrl"
                        :emoji="row.teamEmoji"
                        :color="row.teamColor"
                        :name="row.teamName ?? 'Team'"
                        :size="32"
                        class="rounded-sm border border-border-subtle"
                      />
                      <span
                        v-if="inMoney(row)"
                        class="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-status-success text-[10px] font-bold leading-none text-text-inverse ring-2 ring-surface-default"
                        title="In the money"
                        >$</span
                      >
                    </div>
                    <div class="min-w-0">
                      <RouterLink
                        :to="`/team/${row.teamId}`"
                        class="link block truncate font-semibold text-text-default"
                        >{{ row.teamName ?? '(no name)' }}</RouterLink
                      >
                      <div v-if="row.ownerName" class="truncate text-xs text-text-subtle">
                        {{ row.ownerName }}
                      </div>
                    </div>
                  </div>
                </td>

                <!-- Total (sticky, next to team) -->
                <td
                  class="sticky left-60 z-10 w-20 px-4 py-3 text-left font-bold tabular-nums transition-colors group-hover:bg-surface-subtle"
                  :class="[
                    row.totalPoints >= 0 ? 'text-text-default' : 'text-status-error',
                    stickyBg(row),
                  ]"
                >
                  {{ fmtPts(row.totalPoints) }}
                </td>

                <!-- Player columns: name and individual score in separate columns -->
                <template v-for="n in maxPlayers" :key="n">
                  <td class="px-4 py-3 align-middle">
                    <span v-if="row.roster[n - 1]" class="inline-flex items-center gap-2">
                      <ContestantAvatar
                        :photo-url="row.roster[n - 1]!.photoUrl"
                        :name="row.roster[n - 1]!.name"
                        :tribe="row.roster[n - 1]!.tribe"
                        :show-crown="row.roster[n - 1]!.isMvp"
                        :grayscale="row.roster[n - 1]!.out"
                        :border-color-override="
                          row.roster[n - 1]!.out ? 'var(--color-border-subtle)' : null
                        "
                        :size="28"
                      />
                      <span
                        class="text-text-default"
                        :class="{ 'opacity-60': row.roster[n - 1]!.out }"
                        >{{ row.roster[n - 1]!.name }}</span
                      >
                    </span>
                    <span v-else class="text-text-subtle">—</span>
                  </td>
                  <td
                    class="whitespace-nowrap px-4 py-3 text-left align-middle tabular-nums text-text-subtle"
                  >
                    <template v-if="row.roster[n - 1]">{{
                      fmtPts(row.roster[n - 1]!.points)
                    }}</template>
                    <span v-else class="text-text-subtle">—</span>
                  </td>
                </template>

                <!-- Current bounty: the pick's name on a parchment scroll. Locked
                     picks show for everyone; a not-yet-locked pick shows only on
                     your own row (dimmed), and stays "Pending" for others. Sized
                     so it never grows the row: at w-20 the ~2.7:1 scroll is ~30px
                     tall, under the 32px avatar. -->
                <td class="px-4 py-3 align-middle text-text-default">
                  <div
                    v-if="row.currentBountyName || (isMyTeam(row.ownerId) && row.pendingBountyName)"
                    class="relative w-20"
                    :title="!row.currentBountyName ? 'Your pick — not locked in yet' : undefined"
                  >
                    <img
                      :src="parchmentUrl"
                      alt=""
                      aria-hidden="true"
                      class="w-full select-none [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.3))]"
                    />
                    <span
                      class="absolute inset-0 flex items-center justify-center px-2 text-center font-handwritten text-sm leading-none text-material-parchment-ink"
                    >
                      {{ row.currentBountyName || row.pendingBountyName }}
                    </span>
                  </div>
                  <span v-else class="text-text-muted">Pending</span>
                </td>

                <td class="whitespace-nowrap px-4 py-3 text-left tabular-nums text-text-default">
                  {{ fmtPts(row.actionPoints) }}
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-left tabular-nums text-text-subtle">
                  {{ row.bountyPoints > 0 ? '+' + fmtPts(row.bountyPoints) : fmtPts(0) }}
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-left tabular-nums text-status-error">
                  {{ row.swapPenalty < 0 ? fmtPts(row.swapPenalty) : fmtPts(0) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </BaseCard>
    </template>
    </div>
  </div>
</template>
