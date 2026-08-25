<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'
import TeamCreateWizard from '../components/TeamCreateWizard.vue'
import ContestantAvatar from '../components/ContestantAvatar.vue'
import ContestantSelect from '../components/ContestantSelect.vue'
import ContestantCard from '../components/ContestantCard.vue'
import BaseButton from '../components/base/BaseButton.vue'
import BaseCard from '../components/base/BaseCard.vue'
import BaseModal from '../components/base/BaseModal.vue'
import { useToast } from '../composables/useToast'
import { computeLeaderboard } from '../composables/useLeaderboard'
import { getTribeColors } from '../utils/tribeColors'
import type { ContestantFull } from '../types/contestant'

type Season = { id: string; name: string; status: string; current_episode_id: string | null }
type Contestant = ContestantFull
type TeamPlayer = { contestant_id: string; role: string; effective_from_episode: number; effective_to_episode: number | null }
type ActivePlayer = { contestant_id: string; role: 'mvp' | 'player'; effective_from_episode: number }
type EpisodeInfo = {
  id: string
  number: number
  status: string
  is_merge: boolean
  is_finale: boolean
  bounty_contestant_id: string | null
}
type BountyPick = { contestant_id: string; effective_from_episode: number }
type SeasonConfig = {
  grace_period_through_episode: number
  max_swaps: number | null
  swap_penalty_mvp: number
  swap_penalty_player: number
  swap_penalty_role_change: number
  bounty_points_pre_merge: number
  bounty_points_post_merge: number
  bounty_points_finale: number
}

const auth = useAuthStore()
const router = useRouter()
const toast = useToast()

const seasons = ref<Season[]>([])
const selectedSeasonId = ref('')
const allContestants = ref<Contestant[]>([])
const eliminatedEpisodeIdByContestant = ref<Record<string, string | null>>({})
const allEpisodes = ref<EpisodeInfo[]>([])
const existingTeam = ref<{ id: string; team_name: string | null } | null>(null)
const activePlayers = ref<ActivePlayer[]>([])
const droppedContestantIds = ref<Set<string>>(new Set())
const loading = ref(true)
const saving = ref(false)
const errorMsg = ref('')

// My standing on the leaderboard (rank + score)
const myRank = ref<number | null>(null)
const myScore = ref<number | null>(null)
const myPlayerPoints = ref<Record<string, number>>({})

function fmtPts(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function ordinal(n: number) {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`
}

// Episode + bounty state
const nextUpcomingEpisode = ref<EpisodeInfo | null>(null)
const currentBountyPick = ref<BountyPick | null>(null)
const allBountyPicks = ref<BountyPick[]>([])
const changingBounty = ref(false)
const confirmingBounty = ref(false)
const newBountyContestantId = ref<string | null>(null)
const savingBounty = ref(false)

// Swap state
const seasonConfig = ref<SeasonConfig>({ grace_period_through_episode: 1, max_swaps: null, swap_penalty_mvp: 15, swap_penalty_player: 10, swap_penalty_role_change: 5, bounty_points_pre_merge: 10, bounty_points_post_merge: 15, bounty_points_finale: 20 })
const swapsUsed = ref(0)
const swappingPlayer = ref<ActivePlayer | null>(null)
const selectedReplacementId = ref<string | null>(null)
const savingSwap = ref(false)
const roleChangeTargetId = ref<string | null>(null)

const atMaxSwaps = computed(() =>
  seasonConfig.value.max_swaps !== null && swapsUsed.value >= seasonConfig.value.max_swaps
)

// Roster ordered MVP-first, with fixed position labels (MVP, P1, P2, P3).
const rosterSorted = computed(() =>
  [...activePlayers.value].sort((a, b) => (a.role === 'mvp' ? 0 : 1) - (b.role === 'mvp' ? 0 : 1)),
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

// Roster edits are only allowed with an upcoming episode and swaps remaining.
const canManageRoster = computed(() => !!nextUpcomingEpisode.value && !atMaxSwaps.value)

// Position-chip action menu (teleported so the card's overflow can't clip it).
const openMenuId = ref<string | null>(null)
const menuPos = ref({ x: 0, y: 0 })
const openMenuPlayer = computed(
  () => rosterSorted.value.find(p => p.contestant_id === openMenuId.value) ?? null,
)
function toggleMenu(player: ActivePlayer, event: MouseEvent) {
  if (!canManageRoster.value) return
  if (openMenuId.value === player.contestant_id) {
    openMenuId.value = null
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menuPos.value = { x: rect.left, y: rect.bottom + 4 }
  openMenuId.value = player.contestant_id
}
function menuMakeMvp() {
  if (openMenuId.value) roleChangeTargetId.value = openMenuId.value
  openMenuId.value = null
}
function menuSwap() {
  if (openMenuPlayer.value) openSwapModal(openMenuPlayer.value)
  openMenuId.value = null
}

const isGracePeriod = computed(() =>
  !!nextUpcomingEpisode.value && nextUpcomingEpisode.value.number <= seasonConfig.value.grace_period_through_episode
)

const swapCostForRole = (role: 'mvp' | 'player') => {
  if (isGracePeriod.value) return 0
  return role === 'mvp' ? seasonConfig.value.swap_penalty_mvp : seasonConfig.value.swap_penalty_player
}

const roleChangeCost = computed(() => isGracePeriod.value ? 0 : seasonConfig.value.swap_penalty_role_change)

const availableContestants = computed(() => {
  const activeIds = new Set(activePlayers.value.map(p => p.contestant_id))
  return allContestants.value.filter(
    c => !activeIds.has(c.id) && !droppedContestantIds.value.has(c.id),
  )
})

// The 4 active roster players as full contestant records (for the swap-out select).
const activeRosterContestants = computed(() =>
  activePlayers.value
    .map(p => allContestants.value.find(c => c.id === p.contestant_id))
    .filter((c): c is ContestantFull => !!c),
)

// Two-way binding for the swap-out side: reads/writes swappingPlayer by contestant id.
const swapOutId = computed<string | null>({
  get: () => swappingPlayer.value?.contestant_id ?? null,
  set: (id) => {
    swappingPlayer.value = activePlayers.value.find(a => a.contestant_id === id) ?? null
    if (selectedReplacementId.value === id) selectedReplacementId.value = null
  },
})

// Contestants still in the game (not voted out) — the only valid bounty targets.
const inGameContestants = computed(() =>
  [...allContestants.value]
    .filter(c => !eliminatedEpisodeIdByContestant.value[c.id])
    .sort((a, b) => a.name.localeCompare(b.name)),
)

const mergeEpNumber = computed(() => allEpisodes.value.find(e => e.is_merge)?.number ?? Infinity)

type BountyState = { kind: 'hit'; points: number } | { kind: 'missed' } | { kind: 'upcoming' }

// Per-episode bounty history: the locked-in pick and whether it hit, newest first.
// Includes completed episodes plus the next upcoming one (still editable).
const bountyHistory = computed(() =>
  allEpisodes.value
    .filter(e => e.status === 'completed' || e.id === nextUpcomingEpisode.value?.id)
    .map(ep => {
      const contestantId = pickForEpisode(ep.number)?.contestant_id ?? null
      let state: BountyState
      if (ep.status === 'completed' && ep.bounty_contestant_id) {
        if (contestantId && contestantId === ep.bounty_contestant_id) {
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
        state = { kind: 'upcoming' }
      }
      return {
        episodeId: ep.id,
        number: ep.number,
        contestantId,
        state,
        isUpcoming: ep.id === nextUpcomingEpisode.value?.id,
      }
    })
    .sort((a, b) => b.number - a.number),
)

async function onTeamCreated() {
  loading.value = true
  await loadMyTeam()
  await Promise.all([loadEpisodesAndBounty(), loadSeasonConfig()])
  await loadMyStanding()
  loading.value = false
}

const roleChangeTargetName = computed(() =>
  allContestants.value.find(c => c.id === roleChangeTargetId.value)?.name ?? ''
)

const currentMvpName = computed(() => {
  const mvpPlayer = activePlayers.value.find(p => p.role === 'mvp')
  return allContestants.value.find(c => c.id === mvpPlayer?.contestant_id)?.name ?? ''
})

const currentSeason = computed(() => seasons.value.find(s => s.id === selectedSeasonId.value) ?? null)

const currentEpisodeNumber = computed(() => {
  const epId = currentSeason.value?.current_episode_id
  if (!epId) return null
  return allEpisodes.value.find(e => e.id === epId)?.number ?? null
})

const ownerName = computed(() =>
  auth.firstName || auth.lastName
    ? `${auth.firstName} ${auth.lastName}`.trim()
    : (auth.user?.email ?? ''),
)

const seasonStatusBadge = computed(() => {
  const s = currentSeason.value
  if (!s) return null
  if (s.status === 'active')
    return {
      label: currentEpisodeNumber.value ? `Active · Episode ${currentEpisodeNumber.value}` : 'Active',
      classes: 'bg-status-success-surface text-status-success',
    }
  if (s.status === 'upcoming')
    return { label: 'Upcoming', classes: 'bg-status-warning-surface text-status-warning' }
  return { label: 'Completed', classes: 'bg-surface-subtle text-text-subtle' }
})

async function loadSeasons() {
  const { data } = await supabase
    .from('seasons')
    .select('id, name, status, current_episode_id')
    .in('status', ['upcoming', 'active'])
    .order('created_at', { ascending: false })
  seasons.value = data ?? []
  if (seasons.value.length > 0 && !selectedSeasonId.value) {
    selectedSeasonId.value = seasons.value[0]!.id
  }
}

async function loadContestants() {
  if (!selectedSeasonId.value) return
  const { data } = await supabase
    .from('contestants')
    .select('id, name, photo_url, bio, age, hometown, occupation, eliminated_episode_id, contestant_tribe_assignments(tribe, effective_from_episode)')
    .eq('season_id', selectedSeasonId.value)
    .order('name')
  allContestants.value = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    tribe: (c.contestant_tribe_assignments as any[]).find(a => a.effective_from_episode === 1)?.tribe ?? 'Unknown',
    photo_url: c.photo_url ?? null,
    bio: c.bio ?? null,
    age: c.age ?? null,
    hometown: c.hometown ?? null,
    occupation: c.occupation ?? null,
  }))
  eliminatedEpisodeIdByContestant.value = Object.fromEntries(
    (data ?? []).map((c: any) => [c.id, c.eliminated_episode_id ?? null]),
  )
}

async function loadMyTeam() {
  if (!selectedSeasonId.value || !auth.user) return
  const { data } = await supabase
    .from('teams')
    .select('id, team_name, team_players(contestant_id, role, effective_from_episode, effective_to_episode)')
    .eq('season_id', selectedSeasonId.value)
    .eq('user_id', auth.user.id)
    .maybeSingle()

  if (data) {
    existingTeam.value = { id: data.id, team_name: data.team_name }
    const allTp = data.team_players as TeamPlayer[]
    const currentTp = allTp.filter(p => p.effective_to_episode === null)
    activePlayers.value = currentTp.map(p => ({ contestant_id: p.contestant_id, role: p.role as 'mvp' | 'player', effective_from_episode: p.effective_from_episode }))
    droppedContestantIds.value = new Set(allTp.filter(p => p.effective_to_episode !== null).map(p => p.contestant_id))
  } else {
    existingTeam.value = null
    activePlayers.value = []
    droppedContestantIds.value = new Set()
  }
}

async function loadEpisodesAndBounty() {
  if (!selectedSeasonId.value) return
  const { data: eps } = await supabase
    .from('episodes')
    .select('id, number, status, is_merge, is_finale, bounty_contestant_id')
    .eq('season_id', selectedSeasonId.value)
    .order('number')

  allEpisodes.value = eps ?? []
  nextUpcomingEpisode.value = (eps ?? []).find(e => e.status === 'upcoming') ?? null

  if (!existingTeam.value) {
    allBountyPicks.value = []
    currentBountyPick.value = null
    return
  }

  const { data: picks } = await supabase
    .from('bounty_picks')
    .select('contestant_id, effective_from_episode')
    .eq('team_id', existingTeam.value.id)
    .order('effective_from_episode', { ascending: true })
  allBountyPicks.value = picks ?? []

  const epNums = allEpisodes.value.map(e => e.number)
  const targetEpNum = nextUpcomingEpisode.value?.number ?? (epNums.length > 0 ? Math.max(...epNums) : 1)
  currentBountyPick.value = pickForEpisode(targetEpNum)
  newBountyContestantId.value = currentBountyPick.value?.contestant_id ?? null
}

// The bounty pick locked in for a given episode: the most recent pick that took
// effect on or before it (append-only versioning carries picks forward).
function pickForEpisode(n: number): BountyPick | null {
  const eligible = allBountyPicks.value.filter(p => p.effective_from_episode <= n)
  if (eligible.length === 0) return null
  return eligible.reduce((a, b) => (b.effective_from_episode > a.effective_from_episode ? b : a))
}

async function loadSeasonConfig() {
  if (!selectedSeasonId.value) return
  const { data } = await supabase
    .from('seasons')
    .select('grace_period_through_episode, max_swaps, swap_penalty_mvp, swap_penalty_player, swap_penalty_role_change, bounty_points_pre_merge, bounty_points_post_merge, bounty_points_finale')
    .eq('id', selectedSeasonId.value)
    .single()
  if (data) seasonConfig.value = data as SeasonConfig

  if (!existingTeam.value) return
  const { count } = await supabase
    .from('team_swaps')
    .select('*', { count: 'exact', head: true })
    .eq('team_id', existingTeam.value.id)
  swapsUsed.value = count ?? 0
}

async function loadMyStanding() {
  myRank.value = null
  myScore.value = null
  myPlayerPoints.value = {}
  if (!selectedSeasonId.value || !existingTeam.value) return
  try {
    const board = await computeLeaderboard(selectedSeasonId.value)
    const idx = board.findIndex(r => r.teamId === existingTeam.value!.id)
    if (idx >= 0) {
      myRank.value = idx + 1
      myScore.value = board[idx]!.totalPoints
      myPlayerPoints.value = Object.fromEntries(
        board[idx]!.players.map(p => [p.contestantId, p.points]),
      )
    }
  } catch {
    // Standing is a nice-to-have; failure shouldn't block the page.
  }
}

function openBountyModal() {
  newBountyContestantId.value = currentBountyPick.value?.contestant_id ?? null
  changingBounty.value = true
}

async function saveBountyChange() {
  if (!nextUpcomingEpisode.value || !newBountyContestantId.value || !existingTeam.value) return
  savingBounty.value = true
  errorMsg.value = ''

  const { error } = await supabase.from('bounty_picks').upsert({
    team_id: existingTeam.value.id,
    season_id: selectedSeasonId.value,
    contestant_id: newBountyContestantId.value,
    effective_from_episode: nextUpcomingEpisode.value.number,
  }, { onConflict: 'team_id,effective_from_episode' })

  if (error) { errorMsg.value = error.message; savingBounty.value = false; return }
  confirmingBounty.value = false
  changingBounty.value = false
  await loadEpisodesAndBounty()
  savingBounty.value = false
  toast.success('Bounty pick updated')
}

function contestantName(id: string) {
  return allContestants.value.find(c => c.id === id)?.name ?? '?'
}

function contestantPhoto(id: string) {
  return allContestants.value.find(c => c.id === id)?.photo_url ?? null
}

function contestantTribe(id: string) {
  return allContestants.value.find(c => c.id === id)?.tribe ?? ''
}

function playerStatus(id: string): { out: boolean; ep: number | null } {
  const epId = eliminatedEpisodeIdByContestant.value[id]
  if (!epId) return { out: false, ep: null }
  return { out: true, ep: allEpisodes.value.find(e => e.id === epId)?.number ?? null }
}

function openSwapModal(player: ActivePlayer) {
  swappingPlayer.value = player
  selectedReplacementId.value = null
}

async function confirmSwap() {
  if (!swappingPlayer.value || !selectedReplacementId.value || !existingTeam.value || !nextUpcomingEpisode.value) return
  savingSwap.value = true
  errorMsg.value = ''

  const epNum = nextUpcomingEpisode.value.number
  const penalty = -swapCostForRole(swappingPlayer.value.role)

  const { error: e1 } = await supabase
    .from('team_players')
    .update({ effective_to_episode: epNum - 1 })
    .eq('team_id', existingTeam.value.id)
    .eq('contestant_id', swappingPlayer.value.contestant_id)
    .is('effective_to_episode', null)
  if (e1) { errorMsg.value = e1.message; savingSwap.value = false; return }

  const { error: e2 } = await supabase.from('team_players').insert({
    team_id: existingTeam.value.id,
    contestant_id: selectedReplacementId.value,
    role: swappingPlayer.value.role,
    effective_from_episode: epNum,
  })
  if (e2) { errorMsg.value = e2.message; savingSwap.value = false; return }

  const { error: e3 } = await supabase.from('team_swaps').insert({
    team_id: existingTeam.value.id,
    season_id: selectedSeasonId.value,
    swap_type: 'contestant',
    removed_contestant_id: swappingPlayer.value.contestant_id,
    added_contestant_id: selectedReplacementId.value,
    effective_from_episode: epNum,
    penalty_points: penalty,
  })
  if (e3) { errorMsg.value = e3.message; savingSwap.value = false; return }

  swappingPlayer.value = null
  await loadMyTeam()
  await loadSeasonConfig()
  savingSwap.value = false
}

async function confirmRoleChange() {
  if (!roleChangeTargetId.value || !existingTeam.value || !nextUpcomingEpisode.value) return
  savingSwap.value = true
  errorMsg.value = ''

  const epNum = nextUpcomingEpisode.value.number
  const newMvpId = roleChangeTargetId.value
  const oldMvpId = activePlayers.value.find(p => p.role === 'mvp')?.contestant_id
  if (!oldMvpId) { savingSwap.value = false; return }

  const { error: e1 } = await supabase.from('team_players')
    .update({ effective_to_episode: epNum - 1 })
    .eq('team_id', existingTeam.value.id).eq('contestant_id', oldMvpId).is('effective_to_episode', null)
  if (e1) { errorMsg.value = e1.message; savingSwap.value = false; return }

  const { error: e2 } = await supabase.from('team_players').insert({
    team_id: existingTeam.value.id, contestant_id: oldMvpId, role: 'player', effective_from_episode: epNum,
  })
  if (e2) { errorMsg.value = e2.message; savingSwap.value = false; return }

  const { error: e3 } = await supabase.from('team_players')
    .update({ effective_to_episode: epNum - 1 })
    .eq('team_id', existingTeam.value.id).eq('contestant_id', newMvpId).is('effective_to_episode', null)
  if (e3) { errorMsg.value = e3.message; savingSwap.value = false; return }

  const { error: e4 } = await supabase.from('team_players').insert({
    team_id: existingTeam.value.id, contestant_id: newMvpId, role: 'mvp', effective_from_episode: epNum,
  })
  if (e4) { errorMsg.value = e4.message; savingSwap.value = false; return }

  const { error: e5 } = await supabase.from('team_swaps').insert({
    team_id: existingTeam.value.id,
    season_id: selectedSeasonId.value,
    swap_type: 'role_change',
    removed_contestant_id: oldMvpId,
    added_contestant_id: newMvpId,
    effective_from_episode: epNum,
    penalty_points: roleChangeCost.value === 0 ? 0 : -roleChangeCost.value,
  })
  if (e5) { errorMsg.value = e5.message; savingSwap.value = false; return }

  roleChangeTargetId.value = null
  await loadMyTeam()
  await loadSeasonConfig()
  savingSwap.value = false
}

async function copyInviteLink() {
  const { data: code } = await supabase.rpc('get_registration_code')
  if (!code) return
  await navigator.clipboard.writeText(`${window.location.origin}/login?mode=signup&code=${code}`)
  toast.success('Invite link copied to clipboard')
}

async function handleSignOut() {
  await supabase.auth.signOut()
  router.push('/login')
}

watch(selectedSeasonId, async () => {
  loading.value = true
  await Promise.all([loadContestants(), loadMyTeam()])
  await Promise.all([loadEpisodesAndBounty(), loadSeasonConfig()])
  await loadMyStanding()
  loading.value = false
})

onMounted(async () => {
  await loadSeasons()
  await Promise.all([loadContestants(), loadMyTeam()])
  await Promise.all([loadEpisodesAndBounty(), loadSeasonConfig()])
  await loadMyStanding()
  loading.value = false
})
</script>

<template>
  <div class="min-h-screen bg-surface-page flex flex-col">
    <header class="bg-surface-default border-b border-border-subtle px-6 py-4 flex items-center justify-between shrink-0">
      <h1 class="text-xl font-bold text-text-default">The Ultimate Survivor Game</h1>
      <div class="flex items-center gap-4 text-sm">
        <RouterLink to="/leaderboard" class="text-text-accent hover:text-interactive-accent-hover">Leaderboard</RouterLink>
        <button @click="copyInviteLink" class="text-text-accent hover:text-interactive-accent-hover">Copy invite link</button>
        <RouterLink v-if="auth.isAdmin" to="/admin" class="text-text-accent hover:text-interactive-accent-hover">Admin</RouterLink>
        <span class="text-text-muted">{{ ownerName }}</span>
        <button @click="handleSignOut" class="text-status-error hover:opacity-80">Sign out</button>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="max-w-3xl mx-auto px-6 py-8 text-text-muted text-sm">Loading…</div>

    <template v-else-if="seasons.length === 0">
      <div class="max-w-3xl mx-auto px-6 py-8 text-text-subtle text-sm">
        No active seasons right now. Check back soon!
      </div>
    </template>

    <!-- Full-page wizard when user has no team -->
    <template v-else-if="!existingTeam">
      <!-- Season selector bar (only shown when multiple seasons) -->
      <div v-if="seasons.length > 1" class="bg-surface-subtle border-b border-border-subtle px-6 py-3 shrink-0">
        <div class="flex items-center gap-3">
          <label class="text-xs text-text-muted font-medium uppercase tracking-wide">Season</label>
          <select v-model="selectedSeasonId"
            class="bg-interactive-input border border-interactive-input-border text-text-default rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-border-accent">
            <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
      </div>
      <TeamCreateWizard
        class="flex-1"
        :season-id="selectedSeasonId"
        :season-name="seasons.find(s => s.id === selectedSeasonId)?.name ?? ''"
        :contestants="allContestants"
        :user-id="auth.user!.id"
        @created="onTeamCreated"
      />
    </template>

    <!-- Constrained team management view when team exists -->
    <div v-else class="max-w-3xl mx-auto px-6 py-8 w-full">
      <template v-if="seasons.length > 0">
        <!-- Team header — team name is the primary identity -->
        <div class="mb-6">
          <h2 class="text-2xl font-bold text-text-default">{{ existingTeam?.team_name || 'My Team' }}</h2>
          <p v-if="ownerName" class="text-sm text-text-muted">{{ ownerName }}</p>
          <div class="mt-1 flex items-center gap-2 flex-wrap">
            <span v-if="seasons.length === 1" class="text-sm text-text-subtle">{{ seasons[0]?.name }}</span>
            <select
              v-else
              v-model="selectedSeasonId"
              class="bg-interactive-input border border-interactive-input-border text-text-default rounded-md px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-border-accent"
            >
              <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <span
              v-if="seasonStatusBadge"
              :class="['px-2.5 py-1 rounded-full text-xs font-semibold', seasonStatusBadge.classes]"
            >{{ seasonStatusBadge.label }}</span>
          </div>
        </div>

        <!-- My standing: rank + score -->
        <div v-if="myRank !== null" class="mb-6 grid grid-cols-2 gap-3">
          <BaseCard padding="sm" class="text-center">
            <p class="text-xs text-text-muted uppercase tracking-wide">Place</p>
            <p class="mt-0.5 text-2xl font-bold text-text-default">{{ ordinal(myRank ?? 0) }}</p>
          </BaseCard>
          <BaseCard padding="sm" class="text-center">
            <p class="text-xs text-text-muted uppercase tracking-wide">Score</p>
            <p class="mt-0.5 text-2xl font-bold text-text-default">{{ fmtPts(myScore ?? 0) }}</p>
          </BaseCard>
        </div>

        <!-- Roster management -->
        <BaseCard v-if="existingTeam" padding="none" class="overflow-hidden mb-6">
          <div class="px-4 py-3 flex items-center justify-between bg-surface-subtle border-b border-border-subtle">
            <h3 class="text-sm font-semibold text-text-default">My Roster</h3>
            <span class="text-xs text-text-muted">
              {{ swapsUsed }} swap{{ swapsUsed !== 1 ? 's' : '' }} used
              <template v-if="seasonConfig.max_swaps !== null"> · {{ seasonConfig.max_swaps - swapsUsed }} remaining</template>
            </span>
          </div>
          <div v-for="player in rosterSorted" :key="player.contestant_id"
            class="flex items-center justify-between px-4 py-3 border-b last:border-0 border-border-subtle">
            <div class="flex items-center gap-3">
              <button
                @click="toggleMenu(player, $event)"
                :class="[
                  'w-11 shrink-0 rounded-md py-1 text-center text-[10px] font-bold uppercase tracking-wide transition-colors',
                  player.role === 'mvp' ? 'bg-survivor-sand/20 text-survivor-sand' : 'bg-surface-subtle text-text-subtle',
                  canManageRoster ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
                ]"
              >{{ positionLabel[player.contestant_id] }}</button>
              <ContestantAvatar
                :photo-url="contestantPhoto(player.contestant_id)"
                :name="contestantName(player.contestant_id)"
              />
              <div>
                <p class="font-medium text-sm text-text-default leading-tight">{{ contestantName(player.contestant_id) }}</p>
                <div class="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                  <span
                    class="font-medium"
                    :style="{ color: getTribeColors(contestantTribe(player.contestant_id)).text }"
                  >{{ contestantTribe(player.contestant_id) }}</span>
                  <template v-if="player.effective_from_episode > 1">
                    <span>•</span>
                    <span>joined ep. {{ player.effective_from_episode }}</span>
                  </template>
                </div>
              </div>
            </div>
            <div class="text-right">
              <p class="text-sm font-semibold text-text-default tabular-nums">
                {{ fmtPts(myPlayerPoints[player.contestant_id] ?? 0) }}<span class="font-normal text-text-muted"> pts</span>
              </p>
              <p
                class="mt-0.5 text-xs"
                :class="playerStatus(player.contestant_id).out ? 'text-status-error' : 'text-text-muted'"
              >
                {{ playerStatus(player.contestant_id).out
                    ? `Voted Out Ep. ${playerStatus(player.contestant_id).ep}`
                    : 'In the Game' }}
              </p>
            </div>
          </div>
          <div v-if="!nextUpcomingEpisode" class="px-4 py-3 text-xs text-text-muted">Locked — no upcoming episodes</div>
          <div v-else-if="atMaxSwaps" class="px-4 py-3 text-xs text-text-muted">Maximum swaps reached for this season</div>
          <div v-if="nextUpcomingEpisode && !atMaxSwaps" class="px-4 py-2 bg-surface-subtle border-t border-border-subtle">
            <p class="text-xs text-text-muted">
              <template v-if="isGracePeriod">Free swap window active (through Episode {{ seasonConfig.grace_period_through_episode }})</template>
              <template v-else>Swap cost: −{{ seasonConfig.swap_penalty_player }} pts (player) · −{{ seasonConfig.swap_penalty_mvp }} pts (MVP) · −{{ seasonConfig.swap_penalty_role_change }} pts (role change)</template>
            </p>
          </div>
        </BaseCard>

        <!-- Bounty pick management -->
        <BaseCard v-if="existingTeam" padding="none" class="overflow-hidden mb-4">
          <div class="px-4 py-3 flex items-center justify-between bg-surface-subtle border-b border-border-subtle">
            <h3 class="text-sm font-semibold text-text-default">Bounty Pick</h3>
            <span v-if="nextUpcomingEpisode" class="text-xs text-text-muted">Episode {{ nextUpcomingEpisode.number }}</span>
          </div>
          <div class="px-4 py-3">
            <div v-if="bountyHistory.length > 0" class="divide-y divide-border-subtle">
              <div
                v-for="row in bountyHistory"
                :key="row.episodeId"
                class="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
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
                  >Hit +{{ row.state.points }}</span>
                  <span
                    v-else-if="row.state.kind === 'missed'"
                    class="rounded-full bg-status-error-surface px-2 py-0.5 text-xs font-semibold text-status-error"
                  >Missed</span>
                  <span
                    v-else
                    class="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-semibold text-text-muted"
                  >Upcoming</span>
                  <BaseButton
                    v-if="row.isUpcoming"
                    variant="secondary"
                    size="sm"
                    @click="openBountyModal"
                  >{{ row.contestantId ? 'Update' : 'Set pick' }}</BaseButton>
                </div>
              </div>
            </div>
            <p v-else class="text-sm text-text-muted">
              {{ nextUpcomingEpisode ? 'No bounty history yet' : 'Locked — no upcoming episodes' }}
            </p>
          </div>
        </BaseCard>

        <p v-if="existingTeam && errorMsg" class="text-status-error text-sm mt-4">{{ errorMsg }}</p>
      </template>
    </div>

    <!-- Swap modal -->
    <BaseModal :show="!!swappingPlayer" title="Swap Player" size="lg" @close="swappingPlayer = null">
      <template v-if="swappingPlayer">
        <div class="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <!-- Swapping out -->
          <div>
            <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Swapping out</p>
            <ContestantSelect v-model="swapOutId" :options="activeRosterContestants" placeholder="Select player" />
          </div>

          <!-- Swap icon (arrows right/left; rotates to up/down on mobile) -->
          <svg
            class="mx-auto h-6 w-6 shrink-0 rotate-90 self-center text-icon-subtle sm:mt-7 sm:rotate-0"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-9L21 7.5m0 0L16.5 3M21 7.5H7.5"
            />
          </svg>

          <!-- Swapping in -->
          <div>
            <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Swapping in</p>
            <ContestantSelect v-model="selectedReplacementId" :options="availableContestants" placeholder="Select replacement" />
          </div>
        </div>

        <!-- Transaction cost (highlighted) -->
        <div
          class="mt-5 rounded-md px-3 py-2 text-center text-sm font-semibold"
          :class="swapCostForRole(swappingPlayer.role) === 0
            ? 'bg-status-success-surface text-status-success'
            : 'bg-status-error-surface text-status-error'"
        >
          {{ swapCostForRole(swappingPlayer.role) === 0 ? 'Free swap (grace period)' : `Cost: −${swapCostForRole(swappingPlayer.role)} pts` }}
        </div>
      </template>
      <template #footer>
        <button @click="swappingPlayer = null" class="text-sm text-text-subtle hover:text-text-default px-4 py-2">Cancel</button>
        <BaseButton :loading="savingSwap" :disabled="!selectedReplacementId" @click="confirmSwap">Confirm swap</BaseButton>
      </template>
    </BaseModal>

    <!-- Role change modal -->
    <BaseModal
      :show="!!roleChangeTargetId"
      :title="`Make ${roleChangeTargetName} your MVP?`"
      @close="roleChangeTargetId = null"
    >
      <p class="text-sm text-text-subtle mb-1">{{ currentMvpName }} will become a regular player.</p>
      <p class="text-sm font-semibold" :class="roleChangeCost === 0 ? 'text-status-success' : 'text-status-error'">
        {{ roleChangeCost === 0 ? 'Free (grace period)' : `Cost: −${roleChangeCost} pts` }}
      </p>
      <template #footer>
        <button @click="roleChangeTargetId = null" class="text-sm text-text-subtle hover:text-text-default px-4 py-2">Cancel</button>
        <BaseButton :loading="savingSwap" @click="confirmRoleChange">Confirm</BaseButton>
      </template>
    </BaseModal>

    <!-- Bounty pick modal -->
    <BaseModal :show="changingBounty" title="Update Bounty Pick" size="lg" @close="changingBounty = false">
      <p class="mb-3 text-sm text-text-subtle">
        Choose who you think gets voted out next — only players still in the game are shown.
      </p>
      <div class="-mx-1 max-h-[60vh] overflow-y-auto px-1">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <ContestantCard
            v-for="c in inGameContestants"
            :key="c.id"
            :contestant="c"
            :selected="c.id === newBountyContestantId"
            :disabled="false"
            @select="newBountyContestantId = newBountyContestantId === c.id ? null : c.id"
          />
        </div>
      </div>
      <template #footer>
        <button @click="changingBounty = false" class="text-sm text-text-subtle hover:text-text-default px-4 py-2">Cancel</button>
        <BaseButton :disabled="!newBountyContestantId" @click="confirmingBounty = true">Save</BaseButton>
      </template>
    </BaseModal>

    <!-- Bounty confirmation -->
    <BaseModal :show="confirmingBounty" title="Confirm Bounty Pick" @close="confirmingBounty = false">
      <p class="text-sm text-text-subtle">
        Set this contestant as your bounty pick for Episode {{ nextUpcomingEpisode?.number }}?
      </p>
      <div v-if="newBountyContestantId" class="mt-3 flex items-center gap-3">
        <ContestantAvatar
          :photo-url="contestantPhoto(newBountyContestantId)"
          :name="contestantName(newBountyContestantId)"
          :size="40"
        />
        <span class="font-semibold text-text-default">{{ contestantName(newBountyContestantId) }}</span>
      </div>
      <template #footer>
        <button @click="confirmingBounty = false" class="text-sm text-text-subtle hover:text-text-default px-4 py-2">Cancel</button>
        <BaseButton :loading="savingBounty" @click="saveBountyChange">Confirm pick</BaseButton>
      </template>
    </BaseModal>

    <!-- Position-chip action menu -->
    <Teleport to="body">
      <div v-if="openMenuId" class="fixed inset-0 z-40" @click="openMenuId = null">
        <div
          class="absolute w-36 rounded-lg border border-border-subtle bg-surface-overlay py-1 shadow-xl"
          :style="{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }"
          @click.stop
        >
          <button
            v-if="openMenuPlayer && openMenuPlayer.role === 'player'"
            @click="menuMakeMvp"
            class="block w-full px-3 py-2 text-left text-sm text-text-default hover:bg-surface-subtle"
          >Make MVP</button>
          <button
            @click="menuSwap"
            class="block w-full px-3 py-2 text-left text-sm text-text-default hover:bg-surface-subtle"
          >Swap</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
