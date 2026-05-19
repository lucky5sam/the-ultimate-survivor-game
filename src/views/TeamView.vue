<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'
import TeamCreateWizard from '../components/TeamCreateWizard.vue'
import { useToast } from '../composables/useToast'

type Season = { id: string; name: string; status: string; current_episode_id: string | null }
type Contestant = { id: string; name: string; tribe: string }
type TeamPlayer = { contestant_id: string; role: string; effective_from_episode: number; effective_to_episode: number | null }
type ActivePlayer = { contestant_id: string; role: 'mvp' | 'player'; effective_from_episode: number }
type EpisodeInfo = { id: string; number: number; status: string }
type BountyPick = { contestant_id: string; effective_from_episode: number }
type SeasonConfig = {
  grace_period_through_episode: number
  max_swaps: number | null
  swap_penalty_mvp: number
  swap_penalty_player: number
  swap_penalty_role_change: number
}

const auth = useAuthStore()
const router = useRouter()
const toast = useToast()

const seasons = ref<Season[]>([])
const selectedSeasonId = ref('')
const allContestants = ref<Contestant[]>([])
const allEpisodes = ref<EpisodeInfo[]>([])
const existingTeam = ref<{ id: string; team_name: string | null } | null>(null)
const activePlayers = ref<ActivePlayer[]>([])
const droppedContestantIds = ref<Set<string>>(new Set())
const loading = ref(true)
const saving = ref(false)
const errorMsg = ref('')

// Episode + bounty state
const nextUpcomingEpisode = ref<EpisodeInfo | null>(null)
const currentBountyPick = ref<BountyPick | null>(null)
const changingBounty = ref(false)
const newBountyContestantId = ref<string | null>(null)
const savingBounty = ref(false)

// Swap state
const seasonConfig = ref<SeasonConfig>({ grace_period_through_episode: 1, max_swaps: null, swap_penalty_mvp: 15, swap_penalty_player: 10, swap_penalty_role_change: 5 })
const swapsUsed = ref(0)
const swappingPlayer = ref<ActivePlayer | null>(null)
const swapSearch = ref('')
const selectedReplacementId = ref<string | null>(null)
const savingSwap = ref(false)
const roleChangeTargetId = ref<string | null>(null)

const atMaxSwaps = computed(() =>
  seasonConfig.value.max_swaps !== null && swapsUsed.value >= seasonConfig.value.max_swaps
)

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
  const q = swapSearch.value.toLowerCase()
  return allContestants.value.filter(c =>
    !activeIds.has(c.id) &&
    !droppedContestantIds.value.has(c.id) &&
    (!q || c.name.toLowerCase().includes(q))
  )
})

async function onTeamCreated() {
  loading.value = true
  await loadMyTeam()
  await Promise.all([loadEpisodesAndBounty(), loadSeasonConfig()])
  loading.value = false
}

const swappingContestantName = computed(() =>
  allContestants.value.find(c => c.id === swappingPlayer.value?.contestant_id)?.name ?? ''
)

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
    .select('id, name, contestant_tribe_assignments(tribe, effective_from_episode)')
    .eq('season_id', selectedSeasonId.value)
    .order('name')
  allContestants.value = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    tribe: (c.contestant_tribe_assignments as any[]).find(a => a.effective_from_episode === 1)?.tribe ?? 'Unknown',
  }))
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
    .select('id, number, status')
    .eq('season_id', selectedSeasonId.value)
    .order('number')

  allEpisodes.value = eps ?? []
  nextUpcomingEpisode.value = (eps ?? []).find(e => e.status === 'upcoming') ?? null

  if (!existingTeam.value) return

  const epNums = (eps ?? []).map(e => e.number)
  const targetEpNum = nextUpcomingEpisode.value?.number ?? (epNums.length > 0 ? Math.max(...epNums) : 1)

  const { data: picks } = await supabase
    .from('bounty_picks')
    .select('contestant_id, effective_from_episode')
    .eq('team_id', existingTeam.value.id)
    .lte('effective_from_episode', targetEpNum)
    .order('effective_from_episode', { ascending: false })
    .limit(1)

  currentBountyPick.value = picks?.[0] ?? null
  newBountyContestantId.value = currentBountyPick.value?.contestant_id ?? null
}

async function loadSeasonConfig() {
  if (!selectedSeasonId.value) return
  const { data } = await supabase
    .from('seasons')
    .select('grace_period_through_episode, max_swaps, swap_penalty_mvp, swap_penalty_player, swap_penalty_role_change')
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
  changingBounty.value = false
  await loadEpisodesAndBounty()
  savingBounty.value = false
}

function contestantName(id: string) {
  return allContestants.value.find(c => c.id === id)?.name ?? '?'
}

function openSwapModal(player: ActivePlayer) {
  swappingPlayer.value = player
  swapSearch.value = ''
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
  loading.value = false
})

onMounted(async () => {
  await loadSeasons()
  await Promise.all([loadContestants(), loadMyTeam()])
  await Promise.all([loadEpisodesAndBounty(), loadSeasonConfig()])
  loading.value = false
})
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">The Ultimate Survivor Game</h1>
      <div class="flex items-center gap-4 text-sm">
        <RouterLink to="/leaderboard" class="text-blue-600 hover:text-blue-800">Leaderboard</RouterLink>
        <button @click="copyInviteLink" class="text-blue-600 hover:text-blue-800">Copy invite link</button>
        <RouterLink v-if="auth.isAdmin" to="/admin" class="text-blue-600 hover:text-blue-800">Admin</RouterLink>
        <span class="text-gray-400">
          {{ (auth.firstName || auth.lastName) ? `${auth.firstName} ${auth.lastName}`.trim() : auth.user?.email }}
        </span>
        <button @click="handleSignOut" class="text-red-500 hover:text-red-700">Sign out</button>
      </div>
    </header>

    <div class="max-w-3xl mx-auto px-6 py-8">
<div v-if="loading" class="text-gray-400 text-sm">Loading…</div>

      <template v-else>
        <div v-if="seasons.length === 0" class="text-gray-500 text-sm">
          No active seasons right now. Check back soon!
        </div>

        <template v-else>
          <!-- Season selector -->
          <div class="mb-6">
            <div v-if="seasons.length === 1" class="flex items-center gap-3 flex-wrap">
              <h2 class="text-2xl font-bold">{{ seasons[0]?.name }}</h2>
              <span v-if="currentSeason" :class="[
                'px-2.5 py-1 rounded-full text-xs font-semibold',
                currentSeason.status === 'active'    ? 'bg-green-100 text-green-800' :
                currentSeason.status === 'upcoming'  ? 'bg-yellow-100 text-yellow-800' :
                                                       'bg-gray-100 text-gray-600'
              ]">
                {{ currentSeason.status === 'active' && currentEpisodeNumber
                    ? `Active · Episode ${currentEpisodeNumber}`
                    : currentSeason.status === 'active' ? 'Active'
                    : currentSeason.status === 'upcoming' ? 'Upcoming'
                    : 'Completed' }}
              </span>
            </div>
            <div v-else>
              <label class="block text-sm font-medium text-gray-700 mb-1">Season</label>
              <div class="flex items-center gap-3">
                <select v-model="selectedSeasonId"
                  class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>
                <span v-if="currentSeason" :class="[
                  'px-2.5 py-1 rounded-full text-xs font-semibold',
                  currentSeason.status === 'active'    ? 'bg-green-100 text-green-800' :
                  currentSeason.status === 'upcoming'  ? 'bg-yellow-100 text-yellow-800' :
                                                         'bg-gray-100 text-gray-600'
                ]">
                  {{ currentSeason.status === 'active' && currentEpisodeNumber
                      ? `Active · Episode ${currentEpisodeNumber}`
                      : currentSeason.status === 'active' ? 'Active'
                      : currentSeason.status === 'upcoming' ? 'Upcoming'
                      : 'Completed' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Locked team banner -->
          <div v-if="existingTeam" class="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
            <p class="font-semibold text-green-800">
              Your team is locked in{{ existingTeam.team_name ? ': ' + existingTeam.team_name : '' }}
            </p>
            <p class="text-sm text-green-700 mt-0.5">4 contestants selected. Your MVP is marked with a star.</p>
          </div>

          <!-- Bounty pick management -->
          <div v-if="existingTeam" class="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <div class="flex items-center justify-between mb-2">
              <div>
                <h3 class="text-sm font-semibold text-gray-700">
                  Bounty Pick
                  <span v-if="nextUpcomingEpisode" class="text-xs text-gray-400 font-normal ml-1">— Episode {{ nextUpcomingEpisode.number }}</span>
                </h3>
                <p class="text-xs text-gray-400 mt-0.5">Who gets voted out this episode?</p>
              </div>
              <button v-if="nextUpcomingEpisode && !changingBounty" @click="changingBounty = true"
                class="text-xs text-blue-600 hover:text-blue-800 font-medium">Change</button>
            </div>
            <div v-if="!changingBounty">
              <p v-if="currentBountyPick" class="text-sm font-medium">
                {{ allContestants.find(c => c.id === currentBountyPick?.contestant_id)?.name ?? '?' }}
              </p>
              <p v-else class="text-sm text-gray-400">No pick set</p>
              <p v-if="!nextUpcomingEpisode" class="text-xs text-gray-400 mt-1">Locked — no upcoming episodes</p>
            </div>
            <div v-else class="flex gap-2 items-center mt-1">
              <select v-model="newBountyContestantId"
                class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option :value="null">Select contestant…</option>
                <option v-for="c in allContestants" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <button @click="saveBountyChange" :disabled="!newBountyContestantId || savingBounty"
                class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold px-3 py-2 rounded-lg">
                {{ savingBounty ? '…' : 'Save' }}
              </button>
              <button @click="changingBounty = false" class="text-sm text-gray-500 hover:text-gray-700 px-2">Cancel</button>
            </div>
          </div>

          <!-- Roster management -->
          <div v-if="existingTeam" class="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
            <div class="px-4 py-3 flex items-center justify-between bg-gray-50 border-b border-gray-100">
              <h3 class="text-sm font-semibold text-gray-700">My Roster</h3>
              <span class="text-xs text-gray-400">
                {{ swapsUsed }} swap{{ swapsUsed !== 1 ? 's' : '' }} used
                <template v-if="seasonConfig.max_swaps !== null"> · {{ seasonConfig.max_swaps - swapsUsed }} remaining</template>
              </span>
            </div>
            <div v-for="player in activePlayers" :key="player.contestant_id"
              class="flex items-center justify-between px-4 py-3 border-b last:border-0 border-gray-100">
              <div>
                <span class="font-medium text-sm">{{ contestantName(player.contestant_id) }}</span>
                <span v-if="player.role === 'mvp'" class="ml-1 text-yellow-400">★</span>
                <span v-if="player.effective_from_episode > 1" class="ml-2 text-xs text-gray-400">joined ep. {{ player.effective_from_episode }}</span>
              </div>
              <div v-if="nextUpcomingEpisode && !atMaxSwaps" class="flex gap-3">
                <button v-if="player.role === 'player'" @click="roleChangeTargetId = player.contestant_id"
                  class="text-xs text-purple-600 hover:text-purple-800 font-medium">Make MVP</button>
                <button @click="openSwapModal(player)"
                  class="text-xs text-blue-600 hover:text-blue-800 font-medium">Swap</button>
              </div>
            </div>
            <div v-if="!nextUpcomingEpisode" class="px-4 py-3 text-xs text-gray-400">Locked — no upcoming episodes</div>
            <div v-else-if="atMaxSwaps" class="px-4 py-3 text-xs text-gray-400">Maximum swaps reached for this season</div>
            <div v-if="nextUpcomingEpisode && !atMaxSwaps" class="px-4 py-2 bg-gray-50 border-t border-gray-100">
              <p class="text-xs text-gray-400">
                <template v-if="isGracePeriod">Free swap window active (through Episode {{ seasonConfig.grace_period_through_episode }})</template>
                <template v-else>Swap cost: −{{ seasonConfig.swap_penalty_player }} pts (player) · −{{ seasonConfig.swap_penalty_mvp }} pts (MVP) · −{{ seasonConfig.swap_penalty_role_change }} pts (role change)</template>
              </p>
            </div>
          </div>

          <!-- Team creation wizard -->
          <TeamCreateWizard
            v-if="!existingTeam"
            :season-id="selectedSeasonId"
            :season-name="seasons.find(s => s.id === selectedSeasonId)?.name ?? ''"
            :contestants="allContestants"
            :user-id="auth.user!.id"
            @created="onTeamCreated"
          />

          <p v-if="existingTeam && errorMsg" class="text-red-600 text-sm mt-4">{{ errorMsg }}</p>
        </template>
      </template>
    </div>

    <!-- Swap modal -->
    <div v-if="swappingPlayer" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" @click.self="swappingPlayer = null">
      <div class="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
        <h2 class="text-lg font-bold mb-1">Swap out {{ swappingContestantName }}</h2>
        <p class="text-xs mb-4" :class="swapCostForRole(swappingPlayer.role) === 0 ? 'text-green-600' : 'text-red-500'">
          {{ swapCostForRole(swappingPlayer.role) === 0 ? 'Free (grace period)' : `Cost: −${swapCostForRole(swappingPlayer.role)} pts` }}
        </p>
        <input v-model="swapSearch" type="text" placeholder="Search contestants…"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div class="max-h-52 overflow-y-auto border border-gray-200 rounded-lg">
          <label v-for="c in availableContestants" :key="c.id"
            class="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-0 border-gray-100">
            <input type="radio" :value="c.id" v-model="selectedReplacementId" class="text-blue-600" />
            <span class="text-sm flex-1">{{ c.name }}</span>
            <span class="text-xs text-gray-400">{{ c.tribe }}</span>
          </label>
          <div v-if="availableContestants.length === 0" class="px-3 py-3 text-sm text-gray-400">No contestants available</div>
        </div>
        <div class="flex justify-end gap-3 mt-4">
          <button @click="swappingPlayer = null" class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
          <button @click="confirmSwap" :disabled="!selectedReplacementId || savingSwap"
            class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg">
            {{ savingSwap ? 'Saving…' : 'Confirm swap' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Role change modal -->
    <div v-if="roleChangeTargetId" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" @click.self="roleChangeTargetId = null">
      <div class="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
        <h2 class="text-lg font-bold mb-2">Make {{ roleChangeTargetName }} your MVP?</h2>
        <p class="text-sm text-gray-600 mb-1">{{ currentMvpName }} will become a regular player.</p>
        <p class="text-sm font-semibold mb-4" :class="roleChangeCost === 0 ? 'text-green-600' : 'text-red-500'">
          {{ roleChangeCost === 0 ? 'Free (grace period)' : `Cost: −${roleChangeCost} pts` }}
        </p>
        <div class="flex justify-end gap-3">
          <button @click="roleChangeTargetId = null" class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
          <button @click="confirmRoleChange" :disabled="savingSwap"
            class="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg">
            {{ savingSwap ? 'Saving…' : 'Confirm' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
