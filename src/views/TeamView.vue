<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'

type Season = { id: string; name: string }
type Contestant = { id: string; name: string; tribe: string }
type TeamPlayer = { contestant_id: string; role: string; effective_from_episode: number; effective_to_episode: number | null }
type ActivePlayer = { contestant_id: string; role: 'mvp' | 'player' }
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

const seasons = ref<Season[]>([])
const selectedSeasonId = ref('')
const allContestants = ref<Contestant[]>([])
const existingTeam = ref<{ id: string; team_name: string | null } | null>(null)
const activePlayers = ref<ActivePlayer[]>([])
const droppedContestantIds = ref<Set<string>>(new Set())
const loading = ref(true)
const saving = ref(false)
const errorMsg = ref('')

// Team creation
const teamName = ref('')
const selectedIds = ref<string[]>([])
const mvpId = ref<string | null>(null)
const bountyContestantId = ref<string | null>(null)

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

const byTribe = computed(() => {
  const map: Record<string, Contestant[]> = {}
  for (const c of allContestants.value) {
    if (!map[c.tribe]) map[c.tribe] = []
    map[c.tribe]!.push(c)
  }
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
})

const canSave = computed(() =>
  selectedIds.value.length === 4 &&
  mvpId.value !== null &&
  teamName.value.trim() !== '' &&
  bountyContestantId.value !== null &&
  !existingTeam.value
)

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

function contestantName(id: string) {
  return allContestants.value.find(c => c.id === id)?.name ?? '?'
}

function toggle(id: string) {
  if (existingTeam.value) return
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) {
    selectedIds.value.splice(idx, 1)
    if (mvpId.value === id) mvpId.value = null
  } else if (selectedIds.value.length < 4) {
    selectedIds.value.push(id)
  }
}

function setMvp(id: string) {
  mvpId.value = mvpId.value === id ? null : id
}

async function loadSeasons() {
  const { data } = await supabase
    .from('seasons')
    .select('id, name')
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
    activePlayers.value = currentTp.map(p => ({ contestant_id: p.contestant_id, role: p.role as 'mvp' | 'player' }))
    selectedIds.value = currentTp.map(p => p.contestant_id)
    mvpId.value = currentTp.find(p => p.role === 'mvp')?.contestant_id ?? null
    droppedContestantIds.value = new Set(allTp.filter(p => p.effective_to_episode !== null).map(p => p.contestant_id))
    teamName.value = data.team_name ?? ''
  } else {
    existingTeam.value = null
    activePlayers.value = []
    selectedIds.value = []
    mvpId.value = null
    droppedContestantIds.value = new Set()
    teamName.value = ''
  }
}

async function loadEpisodesAndBounty() {
  if (!selectedSeasonId.value) return
  const { data: eps } = await supabase
    .from('episodes')
    .select('id, number, status')
    .eq('season_id', selectedSeasonId.value)
    .order('number')

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

async function saveTeam() {
  if (!canSave.value || !auth.user) return
  saving.value = true
  errorMsg.value = ''

  const { data: team, error: teamErr } = await supabase
    .from('teams')
    .insert({ user_id: auth.user.id, season_id: selectedSeasonId.value, team_name: teamName.value || null })
    .select('id')
    .single()
  if (teamErr) { errorMsg.value = teamErr.message; saving.value = false; return }

  const players = selectedIds.value.map(id => ({
    team_id: team.id,
    contestant_id: id,
    role: id === mvpId.value ? 'mvp' : 'player',
    effective_from_episode: 1,
  }))
  const { error: playersErr } = await supabase.from('team_players').insert(players)
  if (playersErr) { errorMsg.value = playersErr.message; saving.value = false; return }

  const { error: bountyErr } = await supabase.from('bounty_picks').insert({
    team_id: team.id,
    season_id: selectedSeasonId.value,
    contestant_id: bountyContestantId.value,
    effective_from_episode: 1,
  })
  if (bountyErr) { errorMsg.value = bountyErr.message; saving.value = false; return }

  await loadMyTeam()
  await Promise.all([loadEpisodesAndBounty(), loadSeasonConfig()])
  saving.value = false
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
        <RouterLink v-if="auth.isAdmin" to="/admin" class="text-blue-600 hover:text-blue-800">Admin</RouterLink>
        <span class="text-gray-400">{{ auth.user?.email }}</span>
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
            <div v-if="seasons.length === 1">
              <h2 class="text-2xl font-bold">{{ seasons[0]?.name }}</h2>
            </div>
            <div v-else>
              <label class="block text-sm font-medium text-gray-700 mb-1">Season</label>
              <select v-model="selectedSeasonId"
                class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
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

          <!-- Team name (creation) -->
          <div v-if="!existingTeam" class="mb-5">
            <label class="block text-sm font-medium text-gray-700 mb-1">Team name</label>
            <input v-model="teamName" type="text" placeholder="e.g. The Fire Starters"
              class="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <!-- Instructions -->
          <div v-if="!existingTeam" class="mb-5 text-sm text-gray-600">
            Pick 4 contestants. Then tap <span class="text-yellow-500 font-bold">★</span> on one to make them your MVP
            <span class="text-gray-400">(earns 1.5× points)</span>.
            <span class="ml-2 font-semibold text-blue-700">{{ selectedIds.length }}/4 selected</span>
            <span v-if="mvpId" class="ml-2 font-semibold text-yellow-600">· MVP set</span>
          </div>

          <!-- Contestants by tribe -->
          <div v-for="(members, tribe) in byTribe" :key="tribe" class="mb-8">
            <h3 class="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">{{ tribe }}</h3>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div v-for="c in members" :key="c.id" @click="toggle(c.id)" :class="[
                'relative rounded-xl border-2 p-3 transition-all select-none',
                selectedIds.includes(c.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white',
                !existingTeam && !selectedIds.includes(c.id) && selectedIds.length >= 4
                  ? 'opacity-35 cursor-not-allowed'
                  : existingTeam ? 'cursor-default' : 'cursor-pointer hover:border-gray-300',
              ]">
                <p class="font-semibold text-sm pr-5">{{ c.name }}</p>
                <button v-if="selectedIds.includes(c.id) && !existingTeam" @click.stop="setMvp(c.id)"
                  class="absolute top-2 right-2 text-base leading-none"
                  :class="mvpId === c.id ? 'text-yellow-400' : 'text-gray-200 hover:text-yellow-300'"
                  title="Set as MVP">★</button>
                <span v-if="existingTeam && mvpId === c.id"
                  class="absolute top-2 right-2 text-yellow-400 text-base leading-none">★</span>
              </div>
            </div>
          </div>

          <!-- Bounty pick (creation) -->
          <div v-if="!existingTeam" class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-1">Bounty Pick</label>
            <p class="text-xs text-gray-500 mb-2">
              Who gets voted out Episode 1? Your pick carries forward each week — swap it before any episode starts.
            </p>
            <select v-model="bountyContestantId"
              class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option :value="null">Select a contestant…</option>
              <option v-for="c in allContestants" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <!-- Save (creation) -->
          <div v-if="!existingTeam">
            <p v-if="errorMsg" class="text-red-600 text-sm mb-3">{{ errorMsg }}</p>
            <button @click="saveTeam" :disabled="!canSave || saving"
              class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-lg">
              {{ saving ? 'Saving…' : 'Lock in my team' }}
            </button>
            <p v-if="!teamName.trim()" class="text-xs text-gray-400 mt-2">Enter a team name</p>
            <p v-else-if="selectedIds.length < 4" class="text-xs text-gray-400 mt-2">
              Select {{ 4 - selectedIds.length }} more contestant{{ 4 - selectedIds.length === 1 ? '' : 's' }}
            </p>
            <p v-else-if="!mvpId" class="text-xs text-gray-400 mt-2">Tap ★ on a contestant to set your MVP</p>
            <p v-else-if="!bountyContestantId" class="text-xs text-gray-400 mt-2">Set your bounty pick</p>
          </div>

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
