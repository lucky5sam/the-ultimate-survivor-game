<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { computeLeaderboard, type LeaderboardRow } from '../composables/useLeaderboard'
import { useSeasonStore } from '../stores/season'
import { useAuthStore } from '../stores/auth'
import BaseCard from '../components/base/BaseCard.vue'
import ContestantAvatar from '../components/ContestantAvatar.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import { loadTribeColors } from '../utils/tribeColors'

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
    return
  }
  const seq = ++loadSeq
  loading.value = true
  errorMsg.value = ''
  try {
    await loadTribeColors(seasonStore.selectedSeasonId)
    const result = await computeLeaderboard(seasonStore.selectedSeasonId)
    if (seq !== loadSeq) return
    rows.value = result
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

// Widest roster in the field, so every team gets the same number of player columns.
const maxPlayers = computed(
  () => rows.value.reduce((m, r) => Math.max(m, r.players.length), 0) || 4,
)

// Ranked rows with each roster sorted MVP-first, then by individual score.
const displayRows = computed(() =>
  rows.value.map((r, i) => ({
    ...r,
    rank: i + 1,
    roster: [...r.players].sort(
      (a, b) => (b.isMvp ? 1 : 0) - (a.isMvp ? 1 : 0) || b.points - a.points,
    ),
  })),
)

// The shared store owns the season list + selection; reload when it changes.
watch(() => seasonStore.selectedSeasonId, loadLeaderboard, { immediate: true })
onMounted(() => seasonStore.load())
</script>

<template>
  <div class="w-full px-4 py-4 sm:px-6">
    <div class="flex-col mb-4 ml-1">
      <h2 class="text-2xl font-bold text-text-default">Leaderboard</h2>
      <p class="text-text-subtle text-base">{{ rows.length }} total teams</p>
    </div>
    <p v-if="errorMsg" class="mb-4 text-sm text-status-error">{{ errorMsg }}</p>
    <div v-if="loading" class="text-sm text-text-muted">Loading…</div>

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
          class="sticky top-0 z-20 flex items-center gap-2 border-b border-border-subtle bg-surface-subtle pl-3 py-2 pr-5 text-xs font-semibold uppercase tracking-wide text-text-muted"
        >
          <span class="min-w-7 shrink-0 text-center">Pl</span>
          <span class="flex-1">Team</span>
          <span class="ml-2 min-w-17 shrink-0 text-center">Score</span>
        </div>
        <div class="divide-y divide-border-subtle">
          <RouterLink
            v-for="row in displayRows"
            :key="row.teamId"
            :to="`/team/${row.teamId}`"
            class="flex items-center gap-2 pl-3 py-3 pr-4 transition-colors"
            :class="isMyTeam(row.ownerId) ? 'bg-surface-highlight' : 'bg-surface-default'"
          >
            <span
              class="min-w-7 shrink-0 text-center text-sm font-bold tabular-nums"
              :class="row.rank === 1 ? 'text-survivor-sand' : 'text-text-subtle'"
              >{{ row.rank }}</span
            >
            <TeamAvatar
              :image-url="row.teamImageUrl"
              :emoji="row.teamEmoji"
              :color="row.teamColor"
              :name="row.teamName ?? 'Team'"
              :size="40"
              class="rounded-sm border border-border-subtle"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold text-text-default">
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
            <thead class="text-xs uppercase tracking-wide text-text-muted">
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
                    Player {{ n }}
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
                class="border-t border-border-subtle"
                :class="{ 'bg-surface-highlight': isMyTeam(row.ownerId) }"
              >
                <!-- Team (sticky): rank + name + owner -->
                <td
                  class="sticky left-0 z-10 w-60 min-w-60 px-4 py-3"
                  :class="isMyTeam(row.ownerId) ? 'bg-surface-highlight' : 'bg-surface-default'"
                >
                  <div class="flex items-center gap-3">
                    <span
                      class="w-5 shrink-0 text-center font-bold tabular-nums"
                      :class="row.rank === 1 ? 'text-survivor-sand' : 'text-text-subtle'"
                      >{{ row.rank }}</span
                    >
                    <TeamAvatar
                      :image-url="row.teamImageUrl"
                      :emoji="row.teamEmoji"
                      :color="row.teamColor"
                      :name="row.teamName ?? 'Team'"
                      :size="32"
                      class="rounded-sm border border-border-subtle"
                    />
                    <div class="min-w-0">
                      <RouterLink
                        :to="`/team/${row.teamId}`"
                        class="block truncate font-semibold text-text-default hover:text-text-accent"
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
                  class="sticky left-60 z-10 w-20 px-4 py-3 text-left font-bold tabular-nums"
                  :class="[
                    row.totalPoints >= 0 ? 'text-text-default' : 'text-status-error',
                    isMyTeam(row.ownerId) ? 'bg-surface-highlight' : 'bg-surface-default',
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
                      <span
                        v-if="row.roster[n - 1]!.out"
                        class="shrink-0 rounded-full bg-status-error-surface px-2 py-0.5 text-xs font-semibold text-status-error"
                        >Out</span
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

                <!-- Current bounty (blank until the pick locks in) -->
                <td class="px-4 py-3 align-middle text-text-default">
                  <span v-if="row.currentBountyName">{{ row.currentBountyName }}</span>
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
</template>
