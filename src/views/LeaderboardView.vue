<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'

type Season = { id: string; name: string }
type SeasonConfig = {
  bounty_points_pre_merge: number
  bounty_points_post_merge: number
  bounty_points_finale: number
}
type TeamPlayerRecord = {
  team_id: string
  contestant_id: string
  role: string
  effective_from_episode: number
  effective_to_episode: number | null
}
type Player = { name: string; isMvp: boolean; points: number }
type LeaderboardRow = {
  teamId: string
  teamName: string | null
  players: Player[]
  actionPoints: number
  bountyPoints: number
  swapPenalty: number
  totalPoints: number
}

const auth = useAuthStore()
const router = useRouter()

const seasons = ref<Season[]>([])
const selectedSeasonId = ref('')
const rows = ref<LeaderboardRow[]>([])
const loading = ref(false)
const errorMsg = ref('')

async function loadSeasons() {
  const { data } = await supabase
    .from('seasons')
    .select('id, name')
    .in('status', ['upcoming', 'active'])
    .order('created_at', { ascending: false })
  seasons.value = data ?? []
  if (seasons.value.length > 0) selectedSeasonId.value = seasons.value[0]!.id
}

async function loadLeaderboard() {
  if (!selectedSeasonId.value) return
  loading.value = true
  errorMsg.value = ''

  // Season config for bounty point values
  const { data: seasonData, error: seasonErr } = await supabase
    .from('seasons')
    .select('bounty_points_pre_merge, bounty_points_post_merge, bounty_points_finale')
    .eq('id', selectedSeasonId.value)
    .single()
  if (seasonErr) { errorMsg.value = seasonErr.message; loading.value = false; return }
  const config = seasonData as SeasonConfig

  // All episodes for the season
  const { data: allEps, error: epsErr } = await supabase
    .from('episodes')
    .select('id, number, is_merge, is_finale, bounty_contestant_id, status')
    .eq('season_id', selectedSeasonId.value)
    .order('number')
  if (epsErr) { errorMsg.value = epsErr.message; loading.value = false; return }

  const episodes = allEps ?? []
  const episodeIds = episodes.map(e => e.id)
  const epNumById: Record<string, number> = {}
  for (const ep of episodes) epNumById[ep.id] = ep.number
  const mergeEpNumber = episodes.find(e => e.is_merge)?.number ?? Infinity
  const completedWithResult = episodes.filter(e => e.status === 'completed' && e.bounty_contestant_id)

  // Action points: contestant_id → episode_number → raw points
  const epActsByContestant: Record<string, Record<number, number>> = {}
  if (episodeIds.length > 0) {
    const { data: actions, error: actErr } = await supabase
      .from('contestant_actions')
      .select('contestant_id, episode_id, count, action_types(points)')
      .in('episode_id', episodeIds)
    if (actErr) { errorMsg.value = actErr.message; loading.value = false; return }
    for (const a of actions ?? []) {
      const pts = (a.action_types as unknown as { points: number } | null)?.points ?? 0
      const epNum = epNumById[a.episode_id]
      if (epNum === undefined) continue
      if (!epActsByContestant[a.contestant_id]) epActsByContestant[a.contestant_id] = {}
      epActsByContestant[a.contestant_id]![epNum] =
        (epActsByContestant[a.contestant_id]![epNum] ?? 0) + pts * a.count
    }
  }

  // Teams for the season
  const { data: teamsData, error: teamsErr } = await supabase
    .from('teams')
    .select('id, team_name')
    .eq('season_id', selectedSeasonId.value)
  if (teamsErr) { errorMsg.value = teamsErr.message; loading.value = false; return }
  const teams = teamsData ?? []
  const teamIds = teams.map(t => t.id)

  if (teamIds.length === 0) { rows.value = []; loading.value = false; return }

  // All team_player records (including historical) with effective date range
  const { data: tpData, error: tpErr } = await supabase
    .from('team_players')
    .select('team_id, contestant_id, role, effective_from_episode, effective_to_episode')
    .in('team_id', teamIds)
  if (tpErr) { errorMsg.value = tpErr.message; loading.value = false; return }
  const allTeamPlayers = (tpData ?? []) as TeamPlayerRecord[]

  // Contestant names
  const contestantIds = [...new Set(allTeamPlayers.map(p => p.contestant_id))]
  const contestantNameMap: Record<string, string> = {}
  if (contestantIds.length > 0) {
    const { data: nameData } = await supabase
      .from('contestants')
      .select('id, name')
      .in('id', contestantIds)
    for (const c of nameData ?? []) contestantNameMap[c.id] = c.name
  }

  // Bounty picks grouped by team
  const { data: allBountyPicks } = await supabase
    .from('bounty_picks')
    .select('team_id, contestant_id, effective_from_episode')
    .eq('season_id', selectedSeasonId.value)

  const picksByTeam: Record<string, { contestant_id: string; effective_from_episode: number }[]> = {}
  for (const pick of allBountyPicks ?? []) {
    if (!picksByTeam[pick.team_id]) picksByTeam[pick.team_id] = []
    picksByTeam[pick.team_id]!.push(pick)
  }

  // Bounty points per team using season config values
  const bountyPtsMap: Record<string, number> = {}
  for (const ep of completedWithResult) {
    const ptValue = ep.is_finale
      ? config.bounty_points_finale
      : ep.number >= mergeEpNumber
        ? config.bounty_points_post_merge
        : config.bounty_points_pre_merge
    for (const [teamId, picks] of Object.entries(picksByTeam)) {
      const pick = picks
        .filter(p => p.effective_from_episode <= ep.number)
        .sort((a, b) => b.effective_from_episode - a.effective_from_episode)[0]
      if (pick?.contestant_id === ep.bounty_contestant_id) {
        bountyPtsMap[teamId] = (bountyPtsMap[teamId] ?? 0) + ptValue
      }
    }
  }

  // Swap penalties per team (penalty_points stored as positive magnitude)
  const swapPenaltyMap: Record<string, number> = {}
  const { data: swaps } = await supabase
    .from('team_swaps')
    .select('team_id, penalty_points')
    .in('team_id', teamIds)
  for (const s of swaps ?? []) {
    swapPenaltyMap[s.team_id] = (swapPenaltyMap[s.team_id] ?? 0) + s.penalty_points
  }

  // Group team_player records by team
  const playersByTeam: Record<string, TeamPlayerRecord[]> = {}
  for (const p of allTeamPlayers) {
    if (!playersByTeam[p.team_id]) playersByTeam[p.team_id] = []
    playersByTeam[p.team_id]!.push(p)
  }

  // Build leaderboard rows
  rows.value = teams.map(team => {
    const teamPlayerRecords = playersByTeam[team.id] ?? []

    // Accumulate per-contestant contribution across all their time-bounded records
    const contribMap: Record<string, { pts: number; isMvp: boolean; active: boolean }> = {}

    for (const tp of teamPlayerRecords) {
      let rawPts = 0
      for (const ep of episodes) {
        if (ep.number < tp.effective_from_episode) continue
        if (tp.effective_to_episode !== null && ep.number > tp.effective_to_episode) continue
        rawPts += epActsByContestant[tp.contestant_id]?.[ep.number] ?? 0
      }
      const pts = tp.role === 'mvp' ? rawPts * 1.5 : rawPts
      const isActive = tp.effective_to_episode === null

      if (!contribMap[tp.contestant_id]) {
        contribMap[tp.contestant_id] = { pts: 0, isMvp: false, active: false }
      }
      contribMap[tp.contestant_id]!.pts += pts
      if (isActive) {
        contribMap[tp.contestant_id]!.isMvp = tp.role === 'mvp'
        contribMap[tp.contestant_id]!.active = true
      }
    }

    const players: Player[] = Object.entries(contribMap)
      .filter(([, v]) => v.active)
      .map(([contestantId, v]) => ({
        name: contestantNameMap[contestantId] ?? '?',
        isMvp: v.isMvp,
        points: v.pts,
      }))
      .sort((a, b) => b.points - a.points)

    const actionPoints = Object.values(contribMap).reduce((s, v) => s + v.pts, 0)
    const bountyPoints = bountyPtsMap[team.id] ?? 0
    const swapPenalty = -(swapPenaltyMap[team.id] ?? 0)
    return {
      teamId: team.id,
      teamName: team.team_name,
      players,
      actionPoints,
      bountyPoints,
      swapPenalty,
      totalPoints: actionPoints + bountyPoints + swapPenalty,
    }
  }).sort((a, b) => b.totalPoints - a.totalPoints)

  loading.value = false
}

async function handleSignOut() {
  await supabase.auth.signOut()
  router.push('/login')
}

function fmtPts(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

watch(selectedSeasonId, loadLeaderboard)
onMounted(async () => { await loadSeasons(); await loadLeaderboard() })
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">The Ultimate Survivor Game</h1>
      <div class="flex items-center gap-4 text-sm">
        <RouterLink to="/my-team" class="text-blue-600 hover:text-blue-800">My Team</RouterLink>
        <RouterLink v-if="auth.isAdmin" to="/admin" class="text-blue-600 hover:text-blue-800">Admin</RouterLink>
        <span class="text-gray-400">{{ auth.user?.email }}</span>
        <button @click="handleSignOut" class="text-red-500 hover:text-red-700">Sign out</button>
      </div>
    </header>

    <div class="max-w-3xl mx-auto px-6 py-8">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-bold">Leaderboard</h2>
        <div v-if="seasons.length === 1" class="text-sm text-gray-500">{{ seasons[0]?.name }}</div>
        <select
          v-else-if="seasons.length > 1"
          v-model="selectedSeasonId"
          class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>

      <p v-if="errorMsg" class="text-red-600 text-sm mb-4">{{ errorMsg }}</p>
      <div v-if="loading" class="text-gray-400 text-sm">Loading…</div>

      <div v-else-if="seasons.length === 0" class="text-gray-400 text-sm">
        No active seasons right now.
      </div>

      <div v-else-if="rows.length === 0" class="text-gray-400 text-sm">
        No teams registered yet.
      </div>

      <div v-else class="bg-white rounded-xl shadow overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 text-left">
            <tr>
              <th class="px-4 py-3 w-10">#</th>
              <th class="px-4 py-3">Team</th>
              <th class="px-4 py-3">Players</th>
              <th class="px-4 py-3 text-right">Bounty</th>
              <th class="px-4 py-3 text-right">Swaps</th>
              <th class="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="row.teamId" class="border-t border-gray-100">
              <td class="px-4 py-3 font-bold" :class="i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-gray-300'">
                {{ i + 1 }}
              </td>
              <td class="px-4 py-3 font-semibold">{{ row.teamName ?? '(no name)' }}</td>
              <td class="px-4 py-3 text-gray-600">
                <span v-for="(p, pi) in row.players" :key="p.name">
                  {{ p.name }}<span v-if="p.isMvp" class="text-yellow-400">★</span><span v-if="pi < row.players.length - 1" class="text-gray-300 mx-1">·</span>
                </span>
              </td>
              <td class="px-4 py-3 text-right font-mono text-indigo-600">
                {{ row.bountyPoints > 0 ? '+' + fmtPts(row.bountyPoints) : '—' }}
              </td>
              <td class="px-4 py-3 text-right font-mono text-red-500">
                {{ row.swapPenalty < 0 ? fmtPts(row.swapPenalty) : '—' }}
              </td>
              <td class="px-4 py-3 text-right font-mono font-semibold" :class="row.totalPoints >= 0 ? 'text-green-600' : 'text-red-500'">
                {{ fmtPts(row.totalPoints) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
