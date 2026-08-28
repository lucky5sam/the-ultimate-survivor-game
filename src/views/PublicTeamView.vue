<script setup lang="ts">
// Read-only view of another player's team — same layout as your own Team page
// (roster, standing, bounty history) minus every edit control. Reached by
// clicking a team name on the Dashboard or Leaderboard. Shares the roster,
// bounty-history, and breakdown UI components with the Team page so the two
// never drift.
//
// Game-integrity note: an opponent's *unlocked upcoming* bounty pick is a
// not-yet-committed strategic choice, so it is deliberately hidden here. Only
// bounty picks for episodes that have locked or completed are revealed.
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'
import BaseButton from '../components/base/BaseButton.vue'
import BaseCard from '../components/base/BaseCard.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import TeamRosterList from '../components/TeamRosterList.vue'
import BountyHistoryList from '../components/BountyHistoryList.vue'
import ScoreBreakdownModal from '../components/ScoreBreakdownModal.vue'
import {
  computeLeaderboard,
  computeTeamBreakdown,
  type TeamBreakdown,
} from '../composables/useLeaderboard'
import { loadTribeColors } from '../utils/tribeColors'
import type { ContestantFull } from '../types/contestant'
import type { BountyHistoryRow } from '../types/bounty'

type Contestant = ContestantFull
type ActivePlayer = {
  contestant_id: string
  role: 'mvp' | 'player'
  effective_from_episode: number
}
type EpisodeInfo = {
  id: string
  number: number
  status: string
  is_merge: boolean
  is_finale: boolean
  bounty_contestant_id: string | null
  locks_at: string | null
}
type BountyPick = { contestant_id: string; effective_from_episode: number }
type SeasonConfig = {
  bounty_points_pre_merge: number
  bounty_points_post_merge: number
  bounty_points_finale: number
}

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const teamId = computed(() => String(route.params.teamId))

const loading = ref(true)
const errorMsg = ref('')

const teamName = ref<string | null>(null)
const teamImageUrl = ref<string | null>(null)
const teamEmoji = ref<string | null>(null)
const teamColor = ref<string | null>(null)
const ownerName = ref('')
const seasonId = ref('')
const currentEpisodeId = ref<string | null>(null)

const allContestants = ref<Contestant[]>([])
const eliminatedEpisodeIdByContestant = ref<Record<string, string | null>>({})
const allEpisodes = ref<EpisodeInfo[]>([])
const activePlayers = ref<ActivePlayer[]>([])
const allBountyPicks = ref<BountyPick[]>([])
const seasonConfig = ref<SeasonConfig>({
  bounty_points_pre_merge: 10,
  bounty_points_post_merge: 15,
  bounty_points_finale: 20,
})

const rank = ref<number | null>(null)
const score = ref<number | null>(null)
const totalTeams = ref(0)
const topScore = ref(0)
const playerPoints = ref<Record<string, number>>({})

const breakdownModalOpen = ref(false)
const breakdown = ref<TeamBreakdown | null>(null)
const breakdownLoading = ref(false)

// Ticking clock so date-based locks flip automatically without a reload.
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | undefined

function fmtPts(n: number) {
  return n.toFixed(1)
}
function ordinal(n: number) {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`
}
function isPastLock(iso: string | null): boolean {
  return !!iso && new Date(iso).getTime() <= now.value
}

const currentEpisodeNumber = computed(() =>
  currentEpisodeId.value
    ? (allEpisodes.value.find((e) => e.id === currentEpisodeId.value)?.number ?? null)
    : null,
)

const mergeEpNumber = computed(() => allEpisodes.value.find((e) => e.is_merge)?.number ?? Infinity)

// The bounty value in force for the current (or latest) episode's stage, shown
// in the bounty card footer to mirror the Team page.
const currentBountyValue = computed<{ points: number; stage: string }>(() => {
  const epNums = allEpisodes.value.map((e) => e.number)
  const targetEpNum = currentEpisodeNumber.value ?? (epNums.length > 0 ? Math.max(...epNums) : 1)
  const ep = allEpisodes.value.find((e) => e.number === targetEpNum) ?? null
  if (ep?.is_finale) return { points: seasonConfig.value.bounty_points_finale, stage: 'finale' }
  if (targetEpNum >= mergeEpNumber.value)
    return { points: seasonConfig.value.bounty_points_post_merge, stage: 'post-merge' }
  return { points: seasonConfig.value.bounty_points_pre_merge, stage: 'pre-merge' }
})

const episodesWithEliminations = computed(
  () => new Set(Object.values(eliminatedEpisodeIdByContestant.value).filter(Boolean) as string[]),
)

// Per-episode bounty history — newest first. Only episodes that have locked or
// completed are included, so a still-editable upcoming pick stays hidden.
const bountyHistory = computed<BountyHistoryRow[]>(() =>
  allEpisodes.value
    .filter((e) => e.status === 'completed' || e.status === 'active' || isPastLock(e.locks_at))
    .map((ep) => {
      const contestantId = pickForEpisode(ep.number)?.contestant_id ?? null
      const resolved =
        ep.status === 'completed' &&
        (ep.is_finale ? !!ep.bounty_contestant_id : episodesWithEliminations.value.has(ep.id))
      let state: BountyHistoryRow['state']
      if (resolved) {
        const hit = ep.is_finale
          ? !!contestantId && contestantId === ep.bounty_contestant_id
          : !!contestantId && eliminatedEpisodeIdByContestant.value[contestantId] === ep.id
        if (hit) {
          const points = ep.is_finale
            ? seasonConfig.value.bounty_points_finale
            : ep.number >= mergeEpNumber.value
              ? seasonConfig.value.bounty_points_post_merge
              : seasonConfig.value.bounty_points_pre_merge
          state = { kind: 'hit', points }
        } else {
          state = { kind: 'missed' }
        }
      } else {
        state = { kind: 'locked' }
      }
      return { episodeId: ep.id, number: ep.number, contestantId, state, isUpcoming: false }
    })
    .sort((a, b) => b.number - a.number),
)

// The bounty pick locked in for a given episode (append-only versioning).
function pickForEpisode(n: number): BountyPick | null {
  const eligible = allBountyPicks.value.filter((p) => p.effective_from_episode <= n)
  if (eligible.length === 0) return null
  return eligible.reduce((a, b) => (b.effective_from_episode > a.effective_from_episode ? b : a))
}

async function openBreakdown() {
  breakdownModalOpen.value = true
  if (breakdown.value) return
  breakdownLoading.value = true
  try {
    breakdown.value = await computeTeamBreakdown(seasonId.value, teamId.value)
  } catch {
    breakdown.value = null
  } finally {
    breakdownLoading.value = false
  }
}

// Guards against overlapping loads when navigating between /team/:id routes.
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  loading.value = true
  errorMsg.value = ''
  breakdown.value = null
  try {
    // Team + season basics.
    const { data: team, error: teamErr } = await supabase
      .from('teams')
      .select('id, team_name, team_image_url, team_emoji, team_color, user_id, season_id')
      .eq('id', teamId.value)
      .maybeSingle()

    if (teamErr) {
      errorMsg.value = teamErr.message
      return
    }
    if (!team) {
      errorMsg.value = 'Team not found'
      return
    }

    // Viewing your own team → send to the editable Team page instead.
    if (auth.user && team.user_id === auth.user.id) {
      router.replace('/my-team')
      return
    }

    teamName.value = team.team_name
    teamImageUrl.value = team.team_image_url
    teamEmoji.value = team.team_emoji
    teamColor.value = team.team_color
    seasonId.value = team.season_id
    loadTribeColors(team.season_id)

    const [{ data: season }, { data: profile }] = await Promise.all([
      supabase
        .from('seasons')
        .select(
          'name, status, current_episode_id, bounty_points_pre_merge, bounty_points_post_merge, bounty_points_finale',
        )
        .eq('id', team.season_id)
        .single(),
      team.user_id
        ? supabase
            .from('profiles')
            .select('first_name, last_name')
            .eq('id', team.user_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    if (season) {
      currentEpisodeId.value = season.current_episode_id
      seasonConfig.value = {
        bounty_points_pre_merge: season.bounty_points_pre_merge,
        bounty_points_post_merge: season.bounty_points_post_merge,
        bounty_points_finale: season.bounty_points_finale,
      }
    }
    ownerName.value = profile ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() : ''

    // Contestants, episodes, roster, bounty picks.
    const [{ data: contestants }, { data: eps }, { data: roster }, { data: picks }] =
      await Promise.all([
        supabase
          .from('contestants')
          .select(
            'id, first_name, last_name, preferred_name, photo_url, alt_image, video_url, bio, age, hometown, occupation, eliminated_episode_id, contestant_tribe_assignments(tribe, effective_from_episode)',
          )
          .eq('season_id', team.season_id)
          .order('first_name'),
        supabase
          .from('episodes')
          .select('id, number, status, is_merge, is_finale, bounty_contestant_id, locks_at')
          .eq('season_id', team.season_id)
          .order('number'),
        supabase
          .from('team_players')
          .select('contestant_id, role, effective_from_episode, effective_to_episode')
          .eq('team_id', team.id)
          .is('effective_to_episode', null),
        supabase
          .from('bounty_picks')
          .select('contestant_id, effective_from_episode')
          .eq('team_id', team.id)
          .order('effective_from_episode', { ascending: true }),
      ])

    allContestants.value = (contestants ?? []).map((c: any) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name ?? null,
      preferred_name: c.preferred_name ?? null,
      tribe:
        (c.contestant_tribe_assignments as any[]).find((a) => a.effective_from_episode === 1)
          ?.tribe ?? 'Unknown',
      photo_url: c.photo_url ?? null,
      alt_image: c.alt_image ?? null,
      video_url: c.video_url ?? null,
      bio: c.bio ?? null,
      age: c.age ?? null,
      hometown: c.hometown ?? null,
      occupation: c.occupation ?? null,
    }))
    eliminatedEpisodeIdByContestant.value = Object.fromEntries(
      (contestants ?? []).map((c: any) => [c.id, c.eliminated_episode_id ?? null]),
    )
    allEpisodes.value = eps ?? []
    activePlayers.value = (roster ?? []).map((p: any) => ({
      contestant_id: p.contestant_id,
      role: p.role as 'mvp' | 'player',
      effective_from_episode: p.effective_from_episode,
    }))
    allBountyPicks.value = picks ?? []

    // Standing (rank + score + per-player points) from the shared leaderboard math.
    try {
      const board = await computeLeaderboard(team.season_id)
      totalTeams.value = board.length
      topScore.value = board[0]?.totalPoints ?? 0
      const idx = board.findIndex((r) => r.teamId === team.id)
      if (idx >= 0) {
        rank.value = idx + 1
        score.value = board[idx]!.totalPoints
        playerPoints.value = Object.fromEntries(
          board[idx]!.players.map((p) => [p.contestantId, p.points]),
        )
      }
    } catch {
      // Standing is a nice-to-have; don't block the page.
    }
  } catch (e) {
    if (seq === loadSeq)
      errorMsg.value = e instanceof Error ? e.message : 'Failed to load this team'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

watch(teamId, load)
onMounted(() => {
  nowTimer = setInterval(() => {
    now.value = Date.now()
  }, 1_000)
  load()
})
onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
})
</script>

<template>
  <div class="flex flex-1 flex-col">
    <!-- Back bar -->
    <div class="border-b border-border-subtle bg-surface-subtle px-6 py-2">
      <button
        @click="router.back()"
        class="flex items-center gap-1.5 text-sm font-medium text-text-accent hover:text-interactive-accent-hover"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back
      </button>
    </div>

    <div v-if="loading" class="mx-auto max-w-3xl px-4 py-8 text-sm text-text-muted sm:px-6">
      Loading…
    </div>

    <div v-else-if="errorMsg" class="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
      <h2 class="text-xl font-bold text-text-default">{{ errorMsg }}</h2>
      <BaseButton variant="secondary" class="mt-6" @click="router.push('/leaderboard')">
        Back to Leaderboard
      </BaseButton>
    </div>

    <div v-else class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <!-- Team header — team photo beside the team name (primary identity) -->
      <div class="mb-6 flex items-center gap-4">
        <TeamAvatar
          v-if="teamImageUrl || teamEmoji"
          :image-url="teamImageUrl"
          :emoji="teamEmoji"
          :color="teamColor"
          :name="teamName || 'Team'"
          :size="64"
          class="rounded-2xl border border-border-default"
        />
        <div class="min-w-0">
          <h2 class="truncate text-2xl font-bold text-text-default">{{ teamName || '(no name)' }}</h2>
          <p v-if="ownerName" class="text-base text-text-subtle">{{ ownerName }}</p>
        </div>
      </div>

      <!-- Standing: rank + score. Each card links to its detail view. -->
      <div v-if="rank !== null" class="mb-6 flex flex-wrap gap-3">
        <BaseCard
          padding="sm"
          role="button"
          tabindex="0"
          class="min-w-[7rem] flex-1 cursor-pointer text-center transition-colors hover:border-border-strong hover:bg-surface-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
          @click="router.push('/leaderboard')"
          @keydown.enter="router.push('/leaderboard')"
          @keydown.space.prevent="router.push('/leaderboard')"
        >
          <p class="text-sm font-medium text-text-subtle">Place</p>
          <p class="mt-0.5 text-2xl font-bold text-text-default">{{ ordinal(rank ?? 0) }}</p>
          <p class="text-xs text-text-muted">{{ totalTeams }} total teams</p>
        </BaseCard>
        <BaseCard
          padding="sm"
          role="button"
          tabindex="0"
          class="min-w-[7rem] flex-1 cursor-pointer text-center transition-colors hover:border-border-strong hover:bg-surface-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
          @click="openBreakdown"
          @keydown.enter="openBreakdown"
          @keydown.space.prevent="openBreakdown"
        >
          <p class="text-sm font-medium text-text-subtle">Score</p>
          <p class="mt-0.5 text-2xl font-bold text-text-default">{{ fmtPts(score ?? 0) }}</p>
          <p class="text-xs text-text-muted">1st Place: {{ fmtPts(topScore) }} points</p>
        </BaseCard>
      </div>

      <!-- Roster (read-only) -->
      <TeamRosterList
        class="mb-6"
        :players="activePlayers"
        :contestants="allContestants"
        :eliminated-episode-id-by-contestant="eliminatedEpisodeIdByContestant"
        :episodes="allEpisodes"
        :points-by-id="playerPoints"
      />

      <!-- Bounty history (read-only; unlocked upcoming pick hidden) -->
      <BountyHistoryList
        class="mb-4"
        empty-text="No bounty picks locked in yet."
        :rows="bountyHistory"
        :contestants="allContestants"
      >
        <template #footer>
          <div class="px-4 py-2 bg-surface-subtle border-t border-border-subtle">
            <p class="text-xs text-text-subtle">
              Bounty value: +{{ fmtPts(currentBountyValue.points) }} pts ({{
                currentBountyValue.stage
              }})
            </p>
          </div>
        </template>
      </BountyHistoryList>
    </div>

    <!-- Score breakdown modal -->
    <ScoreBreakdownModal
      :show="breakdownModalOpen"
      :loading="breakdownLoading"
      :breakdown="breakdown"
      @close="breakdownModalOpen = false"
    />
  </div>
</template>
