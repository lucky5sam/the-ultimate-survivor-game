<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'

type Season = { id: string; name: string }
type Player = { name: string; isMvp: boolean; points: number }
type LeaderboardRow = { teamId: string; teamName: string | null; players: Player[]; totalPoints: number }

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

  // Get episode IDs for the season to scope action lookups
  const { data: eps } = await supabase
    .from('episodes')
    .select('id')
    .eq('season_id', selectedSeasonId.value)
  const episodeIds = (eps ?? []).map(e => e.id)

  // Aggregate raw points per contestant across all episodes
  const contestantPoints: Record<string, number> = {}
  if (episodeIds.length > 0) {
    const { data: actions, error: actErr } = await supabase
      .from('contestant_actions')
      .select('contestant_id, count, action_types(points)')
      .in('episode_id', episodeIds)
    if (actErr) { errorMsg.value = actErr.message; loading.value = false; return }
    for (const a of actions ?? []) {
      const pts = (a.action_types as unknown as { points: number } | null)?.points ?? 0
      contestantPoints[a.contestant_id] = (contestantPoints[a.contestant_id] ?? 0) + pts * a.count
    }
  }

  // Fetch all teams with their players and contestant names
  const { data: teams, error: teamsErr } = await supabase
    .from('teams')
    .select('id, team_name, team_players(contestant_id, role, contestants(name))')
    .eq('season_id', selectedSeasonId.value)
  if (teamsErr) { errorMsg.value = teamsErr.message; loading.value = false; return }

  rows.value = ((teams ?? []) as any[]).map(team => {
    const players: Player[] = ((team.team_players ?? []) as any[]).map((p: any) => {
      const raw = contestantPoints[p.contestant_id] ?? 0
      const isMvp = p.role === 'mvp'
      return { name: p.contestants?.name ?? '?', isMvp, points: isMvp ? raw * 1.5 : raw }
    }).sort((a: Player, b: Player) => b.points - a.points)

    return {
      teamId: team.id,
      teamName: team.team_name,
      players,
      totalPoints: players.reduce((s, p) => s + p.points, 0),
    }
  }).sort((a: LeaderboardRow, b: LeaderboardRow) => b.totalPoints - a.totalPoints)

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
              <th class="px-4 py-3 text-right">Points</th>
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
