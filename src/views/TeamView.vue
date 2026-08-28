<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { fmtEt } from '../lib/time'
import { useAuthStore } from '../stores/auth'
import { useSeasonStore } from '../stores/season'
import { useUiStore } from '../stores/ui'
import TeamCreateWizard from '../components/TeamCreateWizard.vue'
import ContestantAvatar from '../components/ContestantAvatar.vue'
import ContestantSelect from '../components/ContestantSelect.vue'
import TeamRosterList from '../components/TeamRosterList.vue'
import BountyHistoryList from '../components/BountyHistoryList.vue'
import ScoreBreakdownModal from '../components/ScoreBreakdownModal.vue'
import ContestantDetailModal, {
  type ContestantEventItem,
} from '../components/ContestantDetailModal.vue'
import BaseButton from '../components/base/BaseButton.vue'
import BaseCard from '../components/base/BaseCard.vue'
import BaseModal from '../components/base/BaseModal.vue'
import BaseInput from '../components/base/BaseInput.vue'
import ImageUploadField from '../components/ImageUploadField.vue'
import EmojiColorPicker from '../components/EmojiColorPicker.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import { uploadImage } from '../lib/uploadImage'
import { useToast } from '../composables/useToast'
import {
  computeLeaderboard,
  computeTeamBreakdown,
  type TeamBreakdown,
} from '../composables/useLeaderboard'
import { loadTribeColors } from '../utils/tribeColors'
import { fullName, displayName } from '../utils/contestantName'
import type { ContestantFull } from '../types/contestant'
import type { BountyHistoryRow } from '../types/bounty'
import InviteBanner from '../components/InviteBanner.vue'

type Season = {
  id: string
  name: string
  status: string
  current_episode_id: string | null
  starts_at: string | null
}
type Contestant = ContestantFull
type TeamPlayer = {
  contestant_id: string
  role: string
  effective_from_episode: number
  effective_to_episode: number | null
}
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
const seasonStore = useSeasonStore()
const uiStore = useUiStore()

// Season list + selection live in the shared store (driven by the top-of-page
// season selector). Aliased here so the rest of this view is unchanged.
const seasons = computed(() => seasonStore.seasons)
const selectedSeasonId = computed({
  get: () => seasonStore.selectedSeasonId,
  set: (v: string) => {
    seasonStore.selectedSeasonId = v
  },
})
const currentSeasonId = computed(() => seasonStore.currentSeasonId)
const breakdownModalOpen = ref(false)
const allContestants = ref<Contestant[]>([])
const eliminatedEpisodeIdByContestant = ref<Record<string, string | null>>({})
const allEpisodes = ref<EpisodeInfo[]>([])
const existingTeam = ref<{
  id: string
  team_name: string | null
  team_image_url: string | null
  team_emoji: string | null
  team_color: string | null
} | null>(null)
const activePlayers = ref<ActivePlayer[]>([])
const loading = ref(true)
const saving = ref(false)
const errorMsg = ref('')

// My standing on the leaderboard (rank + score)
const myRank = ref<number | null>(null)
const myScore = ref<number | null>(null)
const totalTeams = ref(0)
const topScore = ref(0)
const secondScore = ref(0)

// Points separating this team from 1st place (0 when leading).
const pointsFromFirst = computed(() => Math.max(0, topScore.value - (myScore.value ?? 0)))
// When leading, the margin over 2nd place.
const pointsAheadOfSecond = computed(() => Math.max(0, (myScore.value ?? 0) - secondScore.value))
const myPlayerPoints = ref<Record<string, number>>({})
const breakdown = ref<TeamBreakdown | null>(null)
const breakdownLoading = ref(false)

// Contestant detail modal (opened from a roster row's name/avatar).
const detailContestant = ref<ContestantFull | null>(null)
const detailEvents = ref<ContestantEventItem[]>([])
const detailEventsLoading = ref(false)

function fmtPts(n: number) {
  return n.toFixed(1)
}

function ordinal(n: number) {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`
}

// A ticking clock so date-based locks flip automatically without a reload.
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | undefined

function isPastLock(iso: string | null): boolean {
  return !!iso && new Date(iso).getTime() <= now.value
}

// Episode + bounty state.
// The editable episode is the earliest upcoming one whose lock time hasn't passed.
// A scheduled lock time auto-locks the roster/bounty even if the admin hasn't
// flipped the episode to active yet; leaving locks_at null keeps the old behavior
// (upcoming = editable until the admin starts the episode).
const nextUpcomingEpisode = computed<EpisodeInfo | null>(
  () => allEpisodes.value.find((e) => e.status === 'upcoming' && !isPastLock(e.locks_at)) ?? null,
)

// An episode that has locked (airing / awaiting results) but isn't completed yet.
// Used to explain why the roster is currently locked.
const lockedAiringEpisode = computed<EpisodeInfo | null>(
  () =>
    allEpisodes.value.find(
      (e) => e.status !== 'completed' && (e.status === 'active' || isPastLock(e.locks_at)),
    ) ?? null,
)

// The bounty pick in force for the currently editable episode (or the latest one).
const currentBountyPick = computed<BountyPick | null>(() => {
  const epNums = allEpisodes.value.map((e) => e.number)
  const targetEpNum =
    nextUpcomingEpisode.value?.number ?? (epNums.length > 0 ? Math.max(...epNums) : 1)
  return pickForEpisode(targetEpNum)
})

const allBountyPicks = ref<BountyPick[]>([])
const changingBounty = ref(false)
const confirmingBounty = ref(false)
const newBountyContestantId = ref<string | null>(null)
const savingBounty = ref(false)

// Swap state
const seasonConfig = ref<SeasonConfig>({
  grace_period_through_episode: 1,
  max_swaps: null,
  swap_penalty_mvp: 15,
  swap_penalty_player: 10,
  swap_penalty_role_change: 5,
  bounty_points_pre_merge: 10,
  bounty_points_post_merge: 15,
  bounty_points_finale: 20,
})
const swapsUsed = ref(0)

// Edit team details (name + avatar) modal. The avatar is either an uploaded
// photo or an emoji-on-color tile, chosen via `editAvatarMode`.
const editModalOpen = ref(false)
const editName = ref('')
const editAvatarMode = ref<'photo' | 'emoji'>('photo')
const editImageFile = ref<File | null>(null)
const editImageRemoved = ref(false)
const editEmoji = ref<string | null>(null)
const editColor = ref<string | null>(null)
const savingTeam = ref(false)
const editError = ref('')

const swapModalOpen = ref(false)
const swappingPlayer = ref<ActivePlayer | null>(null)
const selectedReplacementId = ref<string | null>(null)
const savingSwap = ref(false)
const roleChangeTargetId = ref<string | null>(null)

const atMaxSwaps = computed(
  () => seasonConfig.value.max_swaps !== null && swapsUsed.value >= seasonConfig.value.max_swaps,
)

// Roster ordered MVP-first (drives the action-menu lookups). Row rendering and
// position labels now live in the shared TeamRosterList component.
const rosterSorted = computed(() =>
  [...activePlayers.value].sort((a, b) => (a.role === 'mvp' ? 0 : 1) - (b.role === 'mvp' ? 0 : 1)),
)

// Roster edits are only allowed with an upcoming episode and swaps remaining.
const canManageRoster = computed(() => !!nextUpcomingEpisode.value && !atMaxSwaps.value)

// Position-chip action menu (teleported so the card's overflow can't clip it).
const openMenuId = ref<string | null>(null)
const menuPos = ref({ x: 0, y: 0 })
const openMenuPlayer = computed(
  () => rosterSorted.value.find((p) => p.contestant_id === openMenuId.value) ?? null,
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

const isGracePeriod = computed(
  () =>
    !!nextUpcomingEpisode.value &&
    nextUpcomingEpisode.value.number <= seasonConfig.value.grace_period_through_episode,
)

const swapCostForRole = (role: 'mvp' | 'player') => {
  if (isGracePeriod.value) return 0
  return role === 'mvp'
    ? seasonConfig.value.swap_penalty_mvp
    : seasonConfig.value.swap_penalty_player
}

const roleChangeCost = computed(() =>
  isGracePeriod.value ? 0 : seasonConfig.value.swap_penalty_role_change,
)

const availableContestants = computed(() => {
  // Anyone not currently on the roster and still in the game is selectable —
  // including contestants who were previously swapped out (they can be re-added;
  // append-only scoring sums each separate stint they spent on the team).
  // Eliminated contestants are excluded — there's no reason to swap one in.
  const activeIds = new Set(activePlayers.value.map((p) => p.contestant_id))
  return allContestants.value.filter(
    (c) => !activeIds.has(c.id) && !eliminatedEpisodeIdByContestant.value[c.id],
  )
})

// Contestant ids that have been voted out — used to grayscale them in selectors.
const eliminatedIds = computed(() =>
  Object.entries(eliminatedEpisodeIdByContestant.value)
    .filter(([, ep]) => !!ep)
    .map(([id]) => id),
)

// The 4 active roster players as full contestant records (for the swap-out select).
const activeRosterContestants = computed(() =>
  activePlayers.value
    .map((p) => allContestants.value.find((c) => c.id === p.contestant_id))
    .filter((c): c is ContestantFull => !!c),
)

// Two-way binding for the swap-out side: reads/writes swappingPlayer by contestant id.
const swapOutId = computed<string | null>({
  get: () => swappingPlayer.value?.contestant_id ?? null,
  set: (id) => {
    swappingPlayer.value = activePlayers.value.find((a) => a.contestant_id === id) ?? null
    if (selectedReplacementId.value === id) selectedReplacementId.value = null
  },
})

// Contestants still in the game (not voted out) — the only valid bounty targets.
const inGameContestants = computed(() =>
  [...allContestants.value]
    .filter((c) => !eliminatedEpisodeIdByContestant.value[c.id])
    .sort((a, b) => fullName(a).localeCompare(fullName(b))),
)

const mergeEpNumber = computed(() => allEpisodes.value.find((e) => e.is_merge)?.number ?? Infinity)

// The bounty value in force for the currently editable episode (or the latest
// one), reflecting its stage: finale > post-merge > pre-merge.
const currentBountyValue = computed<{ points: number; stage: string }>(() => {
  const epNums = allEpisodes.value.map((e) => e.number)
  const targetEpNum =
    nextUpcomingEpisode.value?.number ?? (epNums.length > 0 ? Math.max(...epNums) : 1)
  const ep = allEpisodes.value.find((e) => e.number === targetEpNum) ?? null
  if (ep?.is_finale) return { points: seasonConfig.value.bounty_points_finale, stage: 'finale' }
  if (targetEpNum >= mergeEpNumber.value)
    return { points: seasonConfig.value.bounty_points_post_merge, stage: 'post-merge' }
  return { points: seasonConfig.value.bounty_points_pre_merge, stage: 'pre-merge' }
})

// Episodes that have at least one recorded elimination (bounty is resolved).
const episodesWithEliminations = computed(
  () => new Set(Object.values(eliminatedEpisodeIdByContestant.value).filter(Boolean) as string[]),
)

// Per-episode bounty history: the locked-in pick and whether it hit, newest first.
// Includes completed episodes plus the next upcoming one (still editable).
// Regular episodes resolve from eliminations; the finale resolves from the winner.
const bountyHistory = computed<BountyHistoryRow[]>(() =>
  allEpisodes.value
    .filter(
      (e) =>
        e.status === 'completed' ||
        e.status === 'active' ||
        isPastLock(e.locks_at) ||
        e.id === nextUpcomingEpisode.value?.id,
    )
    .map((ep) => {
      const contestantId = pickForEpisode(ep.number)?.contestant_id ?? null
      const isUpcoming = ep.id === nextUpcomingEpisode.value?.id
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
      } else if (isUpcoming) {
        // Next episode, still editable
        state = { kind: 'upcoming' }
      } else {
        // Active/current (airing) or awaiting results — pick is locked
        state = { kind: 'locked' }
      }
      return { episodeId: ep.id, number: ep.number, contestantId, state, isUpcoming }
    })
    .sort((a, b) => b.number - a.number),
)

// Single load cycle for the selected season, guarded so a fast season switch
// can't let a stale response overwrite fresh data, and wrapped so `loading`
// always clears even if a query rejects.
let loadSeq = 0
async function runLoad() {
  const seq = ++loadSeq
  loading.value = true
  try {
    await Promise.all([loadContestants(), loadMyTeam(), loadTribeColors(selectedSeasonId.value)])
    if (seq !== loadSeq) return
    await Promise.all([loadEpisodesAndBounty(), loadSeasonConfig()])
    if (seq !== loadSeq) return
    await loadMyStanding()
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function onTeamCreated() {
  await runLoad()
}

const roleChangeTargetName = computed(() => {
  const c = allContestants.value.find((c) => c.id === roleChangeTargetId.value)
  return c ? displayName(c) : ''
})

const currentMvpName = computed(() => {
  const mvpPlayer = activePlayers.value.find((p) => p.role === 'mvp')
  const c = allContestants.value.find((c) => c.id === mvpPlayer?.contestant_id)
  return c ? displayName(c) : ''
})

const currentSeason = computed(
  () => seasons.value.find((s) => s.id === selectedSeasonId.value) ?? null,
)
const isOnCurrentSeason = computed(() => selectedSeasonId.value === currentSeasonId.value)

// Registration window: new teams can be created until the season's start time.
// A blank start time keeps registration open; completed seasons are always closed.
function registrationOpenFor(s: Season | null): boolean {
  if (!s || s.status === 'completed') return false
  return !s.starts_at || now.value < new Date(s.starts_at).getTime()
}
// Gate for the wizard/closed message on the season being viewed.
const registrationOpen = computed(() => registrationOpenFor(currentSeason.value))
// The full-page team-creation wizard is showing (mirrors the template branch).
// Published to the UI store so global chrome (invite banner) can hide behind it.
const showWizard = computed(
  () => !loading.value && seasons.value.length > 0 && !existingTeam.value && registrationOpen.value,
)
watch(showWizard, (v) => (uiStore.wizardActive = v), { immediate: true })
onUnmounted(() => {
  uiStore.wizardActive = false
})
const seasonStartDisplay = computed(() =>
  currentSeason.value?.starts_at ? fmtEt(currentSeason.value.starts_at) : null,
)

const ownerName = computed(() =>
  auth.firstName || auth.lastName
    ? `${auth.firstName} ${auth.lastName}`.trim()
    : (auth.user?.email ?? ''),
)

async function loadContestants() {
  if (!selectedSeasonId.value) return
  const { data } = await supabase
    .from('contestants')
    .select(
      'id, first_name, last_name, preferred_name, photo_url, alt_image, video_url, bio, age, hometown, occupation, eliminated_episode_id, contestant_tribe_assignments(tribe, effective_from_episode)',
    )
    .eq('season_id', selectedSeasonId.value)
    .order('first_name')
  allContestants.value = (data ?? []).map((c: any) => ({
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
    (data ?? []).map((c: any) => [c.id, c.eliminated_episode_id ?? null]),
  )
}

async function loadMyTeam() {
  if (!selectedSeasonId.value || !auth.user) return
  const { data } = await supabase
    .from('teams')
    .select(
      'id, team_name, team_image_url, team_emoji, team_color, team_players(contestant_id, role, effective_from_episode, effective_to_episode)',
    )
    .eq('season_id', selectedSeasonId.value)
    .eq('user_id', auth.user.id)
    .maybeSingle()

  if (data) {
    existingTeam.value = {
      id: data.id,
      team_name: data.team_name,
      team_image_url: data.team_image_url,
      team_emoji: data.team_emoji,
      team_color: data.team_color,
    }
    const allTp = data.team_players as TeamPlayer[]
    const currentTp = allTp.filter((p) => p.effective_to_episode === null)
    activePlayers.value = currentTp.map((p) => ({
      contestant_id: p.contestant_id,
      role: p.role as 'mvp' | 'player',
      effective_from_episode: p.effective_from_episode,
    }))
  } else {
    existingTeam.value = null
    activePlayers.value = []
  }
  // Keep the global membership flag (tabs + invite banner gating) in sync.
  uiStore.hasTeam = existingTeam.value !== null
}

function openEditTeam() {
  if (!existingTeam.value) return
  editName.value = existingTeam.value.team_name ?? ''
  editImageFile.value = null
  editImageRemoved.value = false
  editEmoji.value = existingTeam.value.team_emoji
  editColor.value = existingTeam.value.team_color
  // Default to whichever avatar kind the team already uses.
  editAvatarMode.value =
    !existingTeam.value.team_image_url && existingTeam.value.team_emoji ? 'emoji' : 'photo'
  editError.value = ''
  editModalOpen.value = true
}

function onEditImageSelect(file: File) {
  editImageFile.value = file
  editImageRemoved.value = false
}
function onEditImageRemove() {
  editImageFile.value = null
  editImageRemoved.value = true
}

async function saveTeamDetails() {
  if (!existingTeam.value) return
  const name = editName.value.trim()
  if (!name) {
    editError.value = 'Enter a team name'
    return
  }
  editError.value = ''
  savingTeam.value = true
  try {
    // Only one avatar kind is stored at a time; the other is cleared.
    const updates: {
      team_name: string
      team_image_url: string | null
      team_emoji: string | null
      team_color: string | null
    } = {
      team_name: name,
      team_image_url: existingTeam.value.team_image_url,
      team_emoji: null,
      team_color: null,
    }

    if (editAvatarMode.value === 'emoji') {
      updates.team_image_url = null
      updates.team_emoji = editEmoji.value
      updates.team_color = editColor.value
    } else {
      if (editImageFile.value) {
        updates.team_image_url = await uploadImage(editImageFile.value, 'teams')
      } else if (editImageRemoved.value) {
        updates.team_image_url = null
      }
    }

    const { error } = await supabase.from('teams').update(updates).eq('id', existingTeam.value.id)
    if (error) throw new Error(error.message)

    await loadMyTeam()
    editModalOpen.value = false
    toast.success('Team details updated')
  } catch (e) {
    editError.value = e instanceof Error ? e.message : 'Failed to update team'
  } finally {
    savingTeam.value = false
  }
}

async function loadEpisodesAndBounty() {
  if (!selectedSeasonId.value) return
  const { data: eps } = await supabase
    .from('episodes')
    .select('id, number, status, is_merge, is_finale, bounty_contestant_id, locks_at')
    .eq('season_id', selectedSeasonId.value)
    .order('number')

  allEpisodes.value = eps ?? []

  if (!existingTeam.value) {
    allBountyPicks.value = []
    return
  }

  const { data: picks } = await supabase
    .from('bounty_picks')
    .select('contestant_id, effective_from_episode')
    .eq('team_id', existingTeam.value.id)
    .order('effective_from_episode', { ascending: true })
  allBountyPicks.value = picks ?? []

  newBountyContestantId.value = currentBountyPick.value?.contestant_id ?? null
}

// The bounty pick locked in for a given episode: the most recent pick that took
// effect on or before it (append-only versioning carries picks forward).
function pickForEpisode(n: number): BountyPick | null {
  const eligible = allBountyPicks.value.filter((p) => p.effective_from_episode <= n)
  if (eligible.length === 0) return null
  return eligible.reduce((a, b) => (b.effective_from_episode > a.effective_from_episode ? b : a))
}

async function loadSeasonConfig() {
  if (!selectedSeasonId.value) return
  const { data } = await supabase
    .from('seasons')
    .select(
      'grace_period_through_episode, max_swaps, swap_penalty_mvp, swap_penalty_player, swap_penalty_role_change, bounty_points_pre_merge, bounty_points_post_merge, bounty_points_finale',
    )
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
  totalTeams.value = 0
  topScore.value = 0
  secondScore.value = 0
  if (!selectedSeasonId.value || !existingTeam.value) return
  try {
    const board = await computeLeaderboard(selectedSeasonId.value)
    totalTeams.value = board.length
    topScore.value = board[0]?.totalPoints ?? 0
    secondScore.value = board[1]?.totalPoints ?? 0
    const idx = board.findIndex((r) => r.teamId === existingTeam.value!.id)
    if (idx >= 0) {
      myRank.value = idx + 1
      myScore.value = board[idx]!.totalPoints
      myPlayerPoints.value = Object.fromEntries(
        board[idx]!.players.map((p) => [p.contestantId, p.points]),
      )
    }
  } catch {
    // Standing is a nice-to-have; failure shouldn't block the page.
  }
}

async function openBreakdown() {
  breakdownModalOpen.value = true
  if (!selectedSeasonId.value || !existingTeam.value) return
  breakdownLoading.value = true
  try {
    breakdown.value = await computeTeamBreakdown(selectedSeasonId.value, existingTeam.value.id)
  } catch {
    breakdown.value = null
  } finally {
    breakdownLoading.value = false
  }
}

// Open the contestant detail modal for a roster player and load their scored
// actions across this season's episodes (the Event Log tab). Read-only; failure
// just leaves an empty log.
async function openContestantDetails(contestantId: string) {
  const c = allContestants.value.find((x) => x.id === contestantId) ?? null
  if (!c) return
  detailContestant.value = c
  detailEvents.value = []
  detailEventsLoading.value = true
  try {
    const epNumById = Object.fromEntries(allEpisodes.value.map((e) => [e.id, e.number]))
    const episodeIds = allEpisodes.value.map((e) => e.id)
    if (episodeIds.length === 0) return
    const { data } = await supabase
      .from('contestant_actions')
      .select('episode_id, count, action_types(type, points)')
      .eq('contestant_id', contestantId)
      .in('episode_id', episodeIds)
    detailEvents.value = (data ?? []).map((a: any) => ({
      episodeNumber: epNumById[a.episode_id] ?? 0,
      label: (a.action_types as { type: string } | null)?.type ?? 'Action',
      points: (a.action_types as { points: number } | null)?.points ?? 0,
      count: a.count ?? 1,
    }))
  } catch {
    detailEvents.value = []
  } finally {
    detailEventsLoading.value = false
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
  try {
    const { error } = await supabase.from('bounty_picks').upsert(
      {
        team_id: existingTeam.value.id,
        season_id: selectedSeasonId.value,
        contestant_id: newBountyContestantId.value,
        effective_from_episode: nextUpcomingEpisode.value.number,
      },
      { onConflict: 'team_id,effective_from_episode' },
    )
    if (error) throw new Error(error.message)

    confirmingBounty.value = false
    changingBounty.value = false
    await loadEpisodesAndBounty()
    toast.success('Bounty pick updated')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to save bounty pick'
  } finally {
    savingBounty.value = false
  }
}

function contestantName(id: string) {
  const c = allContestants.value.find((c) => c.id === id)
  return c ? displayName(c) : '?'
}

function contestantPhoto(id: string) {
  return allContestants.value.find((c) => c.id === id)?.photo_url ?? null
}

function openSwapModal(player: ActivePlayer) {
  swappingPlayer.value = player
  selectedReplacementId.value = null
  swapModalOpen.value = true
}

// Open the swap modal with nothing preselected (the "Edit" roster button); the
// user picks both the player to swap out and the replacement inside the modal.
function openEditRoster() {
  if (!canManageRoster.value) return
  swappingPlayer.value = null
  selectedReplacementId.value = null
  swapModalOpen.value = true
}

function closeSwapModal() {
  swapModalOpen.value = false
  swappingPlayer.value = null
  selectedReplacementId.value = null
}

async function confirmSwap() {
  if (
    !swappingPlayer.value ||
    !selectedReplacementId.value ||
    !existingTeam.value ||
    !nextUpcomingEpisode.value
  )
    return
  savingSwap.value = true
  errorMsg.value = ''
  const teamId = existingTeam.value.id
  const epNum = nextUpcomingEpisode.value.number
  const outId = swappingPlayer.value.contestant_id
  const role = swappingPlayer.value.role
  const inId = selectedReplacementId.value
  const penalty = -swapCostForRole(role)
  try {
    const { error: e1 } = await supabase
      .from('team_players')
      .update({ effective_to_episode: epNum - 1 })
      .eq('team_id', teamId)
      .eq('contestant_id', outId)
      .is('effective_to_episode', null)
    if (e1) throw new Error(e1.message)

    const { error: e2 } = await supabase.from('team_players').insert({
      team_id: teamId,
      contestant_id: inId,
      role,
      effective_from_episode: epNum,
    })
    if (e2) throw new Error(e2.message)

    const { error: e3 } = await supabase.from('team_swaps').insert({
      team_id: teamId,
      season_id: selectedSeasonId.value,
      swap_type: 'contestant',
      removed_contestant_id: outId,
      added_contestant_id: inId,
      effective_from_episode: epNum,
      penalty_points: penalty,
    })
    if (e3) throw new Error(e3.message)

    closeSwapModal()
    // Refresh roster, swap count, AND standing (a swap penalty changes the score).
    await Promise.all([loadMyTeam(), loadSeasonConfig(), loadMyStanding()])
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Swap failed'
  } finally {
    savingSwap.value = false
  }
}

async function confirmRoleChange() {
  if (!roleChangeTargetId.value || !existingTeam.value || !nextUpcomingEpisode.value) return
  savingSwap.value = true
  errorMsg.value = ''
  const teamId = existingTeam.value.id
  const epNum = nextUpcomingEpisode.value.number
  const newMvpId = roleChangeTargetId.value
  const oldMvpId = activePlayers.value.find((p) => p.role === 'mvp')?.contestant_id
  if (!oldMvpId) {
    savingSwap.value = false
    return
  }
  try {
    const { error: e1 } = await supabase
      .from('team_players')
      .update({ effective_to_episode: epNum - 1 })
      .eq('team_id', teamId)
      .eq('contestant_id', oldMvpId)
      .is('effective_to_episode', null)
    if (e1) throw new Error(e1.message)

    const { error: e2 } = await supabase.from('team_players').insert({
      team_id: teamId,
      contestant_id: oldMvpId,
      role: 'player',
      effective_from_episode: epNum,
    })
    if (e2) throw new Error(e2.message)

    const { error: e3 } = await supabase
      .from('team_players')
      .update({ effective_to_episode: epNum - 1 })
      .eq('team_id', teamId)
      .eq('contestant_id', newMvpId)
      .is('effective_to_episode', null)
    if (e3) throw new Error(e3.message)

    const { error: e4 } = await supabase.from('team_players').insert({
      team_id: teamId,
      contestant_id: newMvpId,
      role: 'mvp',
      effective_from_episode: epNum,
    })
    if (e4) throw new Error(e4.message)

    const { error: e5 } = await supabase.from('team_swaps').insert({
      team_id: teamId,
      season_id: selectedSeasonId.value,
      swap_type: 'role_change',
      removed_contestant_id: oldMvpId,
      added_contestant_id: newMvpId,
      effective_from_episode: epNum,
      penalty_points: roleChangeCost.value === 0 ? 0 : -roleChangeCost.value,
    })
    if (e5) throw new Error(e5.message)

    roleChangeTargetId.value = null
    // Refresh roster, swap count, AND standing (the role change / penalty
    // both affect the score and per-player points).
    await Promise.all([loadMyTeam(), loadSeasonConfig(), loadMyStanding()])
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Role change failed'
  } finally {
    savingSwap.value = false
  }
}

// The shared store owns the season selection; reload the team whenever it
// changes. `immediate` covers the case where the store already resolved before
// this view mounted (empty id is a safe no-op — the loaders guard on it).
watch(selectedSeasonId, runLoad, { immediate: true })

onMounted(async () => {
  nowTimer = setInterval(() => {
    now.value = Date.now()
  }, 1_000)
  await seasonStore.load()
  // If no season got selected (none available), nothing triggers the watch —
  // clear the initial loading state so the page doesn't hang on "Loading…".
  if (!selectedSeasonId.value) loading.value = false
})

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
})
</script>

<template>
  <div class="flex flex-1 flex-col">
    <!-- Viewing a previous season -->
    <div
      v-if="!loading && currentSeasonId && !isOnCurrentSeason"
      class="bg-surface-subtle border-b border-border-subtle px-6 py-2"
    >
      <button
        @click="selectedSeasonId = currentSeasonId"
        class="flex items-center gap-1.5 text-sm font-medium text-text-accent hover:text-interactive-accent-hover"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Return to current season
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="max-w-3xl mx-auto px-4 py-8 text-text-muted text-sm sm:px-6">
      Loading…
    </div>

    <template v-else-if="seasons.length === 0">
      <div class="max-w-3xl mx-auto px-4 py-6 text-text-subtle text-sm sm:px-6">
        No active seasons right now. Check back soon!
      </div>
    </template>

    <!-- Full-page wizard when user has no team and registration is open -->
    <template v-else-if="!existingTeam && registrationOpen">
      <TeamCreateWizard
        class="flex-1"
        :season-id="selectedSeasonId"
        :season-name="seasons.find((s) => s.id === selectedSeasonId)?.name ?? ''"
        :contestants="allContestants"
        :user-id="auth.user!.id"
        @created="onTeamCreated"
      />
    </template>

    <!-- Registration closed: no team and the season has already started -->
    <div v-else-if="!existingTeam" class="max-w-md mx-auto px-4 py-16 text-center sm:px-6">
      <div
        class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle"
      >
        <svg
          class="h-6 w-6 text-text-muted"
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
      </div>
      <h2 class="text-xl font-bold text-text-default">Registration is closed</h2>
      <p class="mt-2 text-sm text-text-muted">
        {{ currentSeason?.name }} has already started<template v-if="seasonStartDisplay">
          ({{ seasonStartDisplay }})</template
        >, so new teams can no longer be created. You can still follow along on the leaderboard.
      </p>
      <BaseButton variant="secondary" class="mt-6" @click="router.push('/leaderboard')">
        View Leaderboard
      </BaseButton>
    </div>

    <!-- Constrained team management view when team exists -->
    <div v-else class="max-w-3xl mx-auto px-4 py-4 w-full sm:px-6 sm:py-6">
      <template v-if="seasons.length > 0">
        <!-- Team, standing, roster, and bounty stacked with a single gap -->
        <div class="flex flex-col gap-4">
          <!-- Team header — team avatar beside the team name (primary identity) -->
          <div class="flex items-center gap-3">
            <TeamAvatar
              v-if="existingTeam?.team_image_url || existingTeam?.team_emoji"
              :image-url="existingTeam.team_image_url"
              :emoji="existingTeam.team_emoji"
              :color="existingTeam.team_color"
              :name="existingTeam.team_name || 'Team'"
              :size="64"
              class="rounded-2xl border border-border-default"
            />
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="truncate text-2xl font-bold text-text-default">
                  {{ existingTeam?.team_name || 'My Team' }}
                </h2>
                <button
                  type="button"
                  aria-label="Edit team details"
                  class="shrink-0 rounded-md p-1.5 text-icon-subtle transition-colors hover:bg-surface-subtle hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
                  @click="openEditTeam"
                >
                  <svg
                    class="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </button>
              </div>
              <p v-if="ownerName" class="text-base text-text-subtle">{{ ownerName }}</p>
            </div>
          </div>

          <!-- My standing: rank + score. Each card is a link to its detail view. -->
          <div v-if="myRank !== null" class="flex flex-wrap gap-3">
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
              <p class="mt-0.5 text-2xl font-bold text-text-default">{{ ordinal(myRank ?? 0) }}</p>
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
              <p class="mt-0.5 text-2xl font-bold text-text-default">{{ fmtPts(myScore ?? 0) }}</p>
              <p class="text-xs text-text-muted">1st Place: {{ fmtPts(topScore) }} points</p>
            </BaseCard>
          </div>

          <!-- Roster management -->
          <TeamRosterList
            v-if="existingTeam"
            title="My Roster"
            :players="activePlayers"
            :contestants="allContestants"
            :eliminated-episode-id-by-contestant="eliminatedEpisodeIdByContestant"
            :episodes="allEpisodes"
            :points-by-id="myPlayerPoints"
            :chip-interactive="canManageRoster"
            details-interactive
            @chip-click="toggleMenu"
            @open-details="openContestantDetails"
          >
            <template #subtitle>
              <p v-if="!nextUpcomingEpisode" class="mt-0.5 text-xs text-text-muted">
                <template v-if="lockedAiringEpisode"
                  >Roster locked — Episode {{ lockedAiringEpisode.number }} in progress</template
                >
                <template v-else>Locked — no upcoming episode scheduled</template>
              </p>
              <p v-else-if="atMaxSwaps" class="mt-0.5 text-xs text-text-muted">
                Maximum swaps reached for this season
              </p>
              <p
                v-else-if="nextUpcomingEpisode.locks_at"
                class="mt-0.5 text-xs font-medium text-text-subtle"
              >
                Roster locks {{ fmtEt(nextUpcomingEpisode.locks_at) }}
              </p>
            </template>
            <template #header-actions>
              <BaseButton
                v-if="canManageRoster"
                variant="secondary"
                size="sm"
                @click="openEditRoster"
                >Edit</BaseButton
              >
            </template>
            <template #footer>
              <div
                v-if="nextUpcomingEpisode && !atMaxSwaps"
                class="px-4 py-2 bg-surface-subtle border-t border-border-subtle"
              >
                <p class="text-xs text-text-subtle">
                  <template v-if="isGracePeriod"
                    >Free swap window active (through Episode
                    {{ seasonConfig.grace_period_through_episode }})</template
                  >
                  <template v-else
                    >Swap cost: −{{ fmtPts(seasonConfig.swap_penalty_player) }} pts (player) · −{{
                      fmtPts(seasonConfig.swap_penalty_mvp)
                    }}
                    pts (MVP) · −{{ fmtPts(seasonConfig.swap_penalty_role_change) }} pts (role
                    change)</template
                  >
                </p>
              </div>
            </template>
          </TeamRosterList>

          <!-- Bounty pick management -->
          <BountyHistoryList
            v-if="existingTeam"
            :rows="bountyHistory"
            :contestants="allContestants"
            show-tribe
            details-interactive
            @open-details="openContestantDetails"
            :empty-text="
              nextUpcomingEpisode ? 'No bounty history yet' : 'Locked — no upcoming episodes'
            "
          >
            <template #subtitle>
              <p v-if="!nextUpcomingEpisode" class="mt-0.5 text-xs text-text-muted">
                <template v-if="lockedAiringEpisode"
                  >Bounty locked — Episode {{ lockedAiringEpisode.number }} in progress</template
                >
                <template v-else>Locked — no upcoming episode scheduled</template>
              </p>
              <p
                v-else-if="nextUpcomingEpisode.locks_at"
                class="mt-0.5 text-xs font-medium text-text-subtle"
              >
                Bounty pick locks {{ fmtEt(nextUpcomingEpisode.locks_at) }}
              </p>
            </template>
            <template #header-actions>
              <BaseButton
                v-if="nextUpcomingEpisode"
                variant="secondary"
                size="sm"
                @click="openBountyModal"
                >{{ currentBountyPick?.contestant_id ? 'Update' : 'Set pick' }}</BaseButton
              >
            </template>
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

        <p v-if="existingTeam && errorMsg" class="text-status-error text-sm mt-4">{{ errorMsg }}</p>
        <InviteBanner />
      </template>
    </div>

    <!-- Edit team details modal -->
    <BaseModal
      :show="editModalOpen"
      title="Edit Team Details"
      size="md"
      @close="editModalOpen = false"
    >
      <div class="space-y-5">
        <BaseInput
          v-model="editName"
          label="Team Name"
          placeholder="e.g. The Fire Starters"
          :maxlength="32"
          @keyup.enter="saveTeamDetails"
        />
        <div>
          <label class="mb-1.5 block text-sm font-medium text-text-default">Team Avatar</label>
          <!-- Photo / Emoji mode toggle -->
          <div class="mb-3 flex rounded-md border border-border-subtle p-0.5">
            <button
              type="button"
              class="flex-1 rounded px-3 py-1 text-sm font-medium transition-colors"
              :class="
                editAvatarMode === 'photo'
                  ? 'bg-surface-subtle text-text-default'
                  : 'text-text-subtle hover:text-text-default'
              "
              @click="editAvatarMode = 'photo'"
            >
              Photo
            </button>
            <button
              type="button"
              class="flex-1 rounded px-3 py-1 text-sm font-medium transition-colors"
              :class="
                editAvatarMode === 'emoji'
                  ? 'bg-surface-subtle text-text-default'
                  : 'text-text-subtle hover:text-text-default'
              "
              @click="editAvatarMode = 'emoji'"
            >
              Emoji
            </button>
          </div>

          <ImageUploadField
            v-if="editAvatarMode === 'photo'"
            :model-value="editImageRemoved ? null : (existingTeam?.team_image_url ?? null)"
            shape="square"
            :size="120"
            @select="onEditImageSelect"
            @remove="onEditImageRemove"
          />
          <EmojiColorPicker v-else v-model:emoji="editEmoji" v-model:color="editColor" />
        </div>
        <p v-if="editError" class="text-sm text-status-error">{{ editError }}</p>
      </div>
      <template #footer>
        <button
          @click="editModalOpen = false"
          class="text-sm text-text-subtle hover:text-text-default px-4 py-2"
        >
          Cancel
        </button>
        <BaseButton :loading="savingTeam" @click="saveTeamDetails">Save changes</BaseButton>
      </template>
    </BaseModal>

    <!-- Score breakdown modal -->
    <ScoreBreakdownModal
      :show="breakdownModalOpen"
      :loading="breakdownLoading"
      :breakdown="breakdown"
      @close="breakdownModalOpen = false"
    />

    <!-- Contestant detail modal (Info + Event Log) -->
    <ContestantDetailModal
      :contestant="detailContestant"
      :show="!!detailContestant"
      :season-name="currentSeason?.name"
      show-event-log
      :events="detailEvents"
      :events-loading="detailEventsLoading"
      @close="detailContestant = null"
    />

    <!-- Swap modal -->
    <BaseModal :show="swapModalOpen" title="Swap Player" size="lg" @close="closeSwapModal">
      <template v-if="swapModalOpen">
        <div class="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <!-- Swapping out -->
          <div>
            <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Swapping out
            </p>
            <ContestantSelect
              v-model="swapOutId"
              :options="activeRosterContestants"
              :eliminated-ids="eliminatedIds"
              placeholder="Select player"
            />
          </div>

          <!-- Swap icon (arrows right/left; rotates to up/down on mobile) -->
          <svg
            class="mx-auto h-6 w-6 shrink-0 rotate-90 self-center text-icon-subtle sm:mt-7 sm:rotate-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M7.5 21 3 16.5 7.5 12M3 16.5h13.5M16.5 3 21 7.5 16.5 12M21 7.5H7.5"
            />
          </svg>

          <!-- Swapping in -->
          <div>
            <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Swapping in
            </p>
            <ContestantSelect
              v-model="selectedReplacementId"
              :options="availableContestants"
              placeholder="Select replacement"
            />
          </div>
        </div>

        <!-- Transaction cost (highlighted) — shown once a player is selected to swap out -->
        <div
          v-if="swappingPlayer"
          class="mt-5 rounded-md px-3 py-2 text-center text-sm font-semibold"
          :class="
            swapCostForRole(swappingPlayer.role) === 0
              ? 'bg-status-success-surface text-status-success'
              : 'bg-status-error-surface text-status-error'
          "
        >
          {{
            swapCostForRole(swappingPlayer.role) === 0
              ? 'Free swap (grace period)'
              : `Cost: −${fmtPts(swapCostForRole(swappingPlayer.role))} pts`
          }}
        </div>
        <p v-else class="mt-5 text-center text-sm text-text-muted">
          Select a player to swap out to see the cost.
        </p>
      </template>
      <template #footer>
        <button
          @click="closeSwapModal"
          class="text-sm text-text-subtle hover:text-text-default px-4 py-2"
        >
          Cancel
        </button>
        <BaseButton
          :loading="savingSwap"
          :disabled="!swappingPlayer || !selectedReplacementId"
          @click="confirmSwap"
          >Confirm swap</BaseButton
        >
      </template>
    </BaseModal>

    <!-- Role change modal -->
    <BaseModal
      :show="!!roleChangeTargetId"
      :title="`Make ${roleChangeTargetName} your MVP?`"
      @close="roleChangeTargetId = null"
    >
      <p class="text-sm text-text-subtle mb-1">
        {{ currentMvpName }} will become a regular player.
      </p>
      <p
        class="text-sm font-semibold"
        :class="roleChangeCost === 0 ? 'text-status-success' : 'text-status-error'"
      >
        {{ roleChangeCost === 0 ? 'Free (grace period)' : `Cost: −${fmtPts(roleChangeCost)} pts` }}
      </p>
      <template #footer>
        <button
          @click="roleChangeTargetId = null"
          class="text-sm text-text-subtle hover:text-text-default px-4 py-2"
        >
          Cancel
        </button>
        <BaseButton :loading="savingSwap" @click="confirmRoleChange">Confirm</BaseButton>
      </template>
    </BaseModal>

    <!-- Bounty pick modal -->
    <BaseModal
      :show="changingBounty"
      title="Update Bounty Pick"
      size="md"
      @close="changingBounty = false"
    >
      <p class="mb-3 text-sm text-text-subtle">
        Choose who you think gets voted out next — only players still in the game are shown.
      </p>
      <ContestantSelect
        v-model="newBountyContestantId"
        :options="inGameContestants"
        placeholder="Select a player"
      />
      <template #footer>
        <button
          @click="changingBounty = false"
          class="text-sm text-text-subtle hover:text-text-default px-4 py-2"
        >
          Cancel
        </button>
        <BaseButton :disabled="!newBountyContestantId" @click="confirmingBounty = true"
          >Save</BaseButton
        >
      </template>
    </BaseModal>

    <!-- Bounty confirmation -->
    <BaseModal
      :show="confirmingBounty"
      title="Confirm Bounty Pick"
      @close="confirmingBounty = false"
    >
      <p class="text-sm text-text-subtle">
        Set this contestant as your bounty pick for Episode {{ nextUpcomingEpisode?.number }}?
      </p>
      <div v-if="newBountyContestantId" class="mt-3 flex items-center gap-3">
        <ContestantAvatar
          :photo-url="contestantPhoto(newBountyContestantId)"
          :name="contestantName(newBountyContestantId)"
          :size="40"
        />
        <span class="font-semibold text-text-default">{{
          contestantName(newBountyContestantId)
        }}</span>
      </div>
      <template #footer>
        <button
          @click="confirmingBounty = false"
          class="text-sm text-text-subtle hover:text-text-default px-4 py-2"
        >
          Cancel
        </button>
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
          >
            Make MVP
          </button>
          <button
            @click="menuSwap"
            class="block w-full px-3 py-2 text-left text-sm text-text-default hover:bg-surface-subtle"
          >
            Swap
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
