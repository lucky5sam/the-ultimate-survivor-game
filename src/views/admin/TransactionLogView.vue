<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../../lib/supabase'
import { useSeasonStore } from '../../stores/season'
import { fmtEt } from '../../lib/time'
import { displayName } from '../../utils/contestantName'

const seasonStore = useSeasonStore()

const loading = ref(true)
const errorMsg = ref('')

type TeamOption = { id: string; label: string; ownerLabel: string }
type Entry = {
  key: string
  teamId: string
  at: string // created_at, ISO
  kind: 'Drafted' | 'Swap' | 'MVP change'
  details: string
  episode: number | null
  penalty: number | null // stored negative
}

const teams = ref<TeamOption[]>([])
const entries = ref<Entry[]>([])
const teamFilter = ref('') // '' = all teams

// The filter dropdown lists owners (user names); the table keeps team names.
const teamsByOwner = computed(() =>
  [...teams.value].sort((a, b) => a.ownerLabel.localeCompare(b.ownerLabel)),
)
const teamLabel = computed(() => Object.fromEntries(teams.value.map((t) => [t.id, t.label])))
const visible = computed(() =>
  teamFilter.value ? entries.value.filter((e) => e.teamId === teamFilter.value) : entries.value,
)

async function load() {
  loading.value = true
  errorMsg.value = ''
  entries.value = []
  try {
    await seasonStore.load()
    const seasonId = seasonStore.currentSeasonId
    if (!seasonId) {
      errorMsg.value = 'No active season found.'
      return
    }

    const [teamsRes, contestantsRes, draftRes, swapsRes] = await Promise.all([
      supabase.from('teams').select('id, team_name, user_id, is_test').eq('season_id', seasonId),
      supabase
        .from('contestants')
        .select('id, first_name, last_name, preferred_name')
        .eq('season_id', seasonId),
      // Drafted rosters always start at episode 1 (TeamCreateWizard).
      supabase
        .from('team_players')
        .select('team_id, contestant_id, role, created_at, teams!inner(season_id)')
        .eq('teams.season_id', seasonId)
        .eq('effective_from_episode', 1),
      supabase
        .from('team_swaps')
        .select(
          'id, team_id, swap_type, removed_contestant_id, added_contestant_id, effective_from_episode, penalty_points, created_at',
        )
        .eq('season_id', seasonId),
    ])
    for (const r of [teamsRes, contestantsRes, draftRes, swapsRes]) {
      if (r.error) throw new Error(r.error.message)
    }

    // Owner names for the team labels (public_profiles is the name-only view).
    const ownerIds = [...new Set((teamsRes.data ?? []).map((t) => t.user_id))]
    const { data: owners, error: ownerErr } = await supabase
      .from('public_profiles')
      .select('id, first_name, last_name')
      .in('id', ownerIds)
    if (ownerErr) throw new Error(ownerErr.message)
    const ownerName = Object.fromEntries(
      (owners ?? []).map((o) => [o.id, [o.first_name, o.last_name].filter(Boolean).join(' ')]),
    )

    teams.value = (teamsRes.data ?? []).map((t) => {
      const name = t.team_name || 'Unnamed team'
      const owner = ownerName[t.user_id]
      const test = t.is_test ? ' · Test' : ''
      return {
        id: t.id,
        label: `${name}${owner ? ` (${owner})` : ''}${test}`,
        ownerLabel: `${owner || name}${test}`,
      }
    })

    const nameOf: Record<string, string> = Object.fromEntries(
      (contestantsRes.data ?? []).map((c) => [c.id, displayName(c)]),
    )
    const who = (id: string | null) => (id ? (nameOf[id] ?? 'Unknown') : '—')

    // The draft is one bulk insert, so its rows share the team's earliest
    // created_at. A swap made before episode 1 locks also lands at episode 1,
    // but later — keeping only the earliest batch leaves it out.
    const draftByTeam: Record<string, { at: string; picks: { id: string; role: string }[] }> = {}
    for (const r of draftRes.data ?? []) {
      const at = r.created_at as string
      const d = draftByTeam[r.team_id]
      if (!d || at < d.at) draftByTeam[r.team_id] = { at, picks: [] }
      if (draftByTeam[r.team_id]!.at === at) {
        draftByTeam[r.team_id]!.picks.push({ id: r.contestant_id, role: r.role })
      }
    }
    const drafts: Entry[] = Object.entries(draftByTeam).map(([teamId, d]) => ({
      key: `draft-${teamId}`,
      teamId,
      at: d.at,
      kind: 'Drafted',
      // MVP first, then the players.
      details: d.picks
        .sort((a, b) => (a.role === 'mvp' ? -1 : b.role === 'mvp' ? 1 : 0))
        .map((p) => (p.role === 'mvp' ? `${who(p.id)} (MVP)` : who(p.id)))
        .join(', '),
      episode: 1,
      penalty: null,
    }))

    const swaps: Entry[] = (swapsRes.data ?? []).map((s) => ({
      key: s.id,
      teamId: s.team_id,
      at: s.created_at as string,
      kind: s.swap_type === 'role_change' ? 'MVP change' : 'Swap',
      details:
        s.swap_type === 'role_change'
          ? `MVP ${who(s.removed_contestant_id)} → ${who(s.added_contestant_id)}`
          : `${who(s.removed_contestant_id)} out → ${who(s.added_contestant_id)} in`,
      episode: s.effective_from_episode,
      penalty: s.penalty_points,
    }))

    // Newest first.
    entries.value = [...drafts, ...swaps].sort((a, b) => b.at.localeCompare(a.at))
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load transactions'
  } finally {
    loading.value = false
  }
}

const kindClass: Record<Entry['kind'], string> = {
  Drafted: 'bg-gray-100 text-gray-700',
  Swap: 'bg-blue-50 text-blue-700',
  'MVP change': 'bg-amber-50 text-amber-700',
}

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-start justify-between mb-6">
      <div>
        <h2 class="text-xl font-semibold text-gray-900">Transaction Log</h2>
        <p class="text-sm text-gray-500 mt-1">
          Every draft, swap, and MVP change this season, newest first.
        </p>
      </div>
      <button
        @click="load"
        :disabled="loading"
        class="text-sm text-gray-600 hover:text-gray-800 px-3 py-2 border border-gray-200 rounded-lg disabled:opacity-50 shrink-0"
      >
        Refresh
      </button>
    </div>

    <div v-if="loading" class="text-sm text-gray-500">Loading transactions…</div>
    <p v-else-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>

    <template v-else>
      <div class="flex items-center gap-3 mb-3">
        <select
          v-model="teamFilter"
          class="border border-gray-200 rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All teams</option>
          <option v-for="t in teamsByOwner" :key="t.id" :value="t.id">
            {{ t.ownerLabel }}
          </option>
        </select>
        <p class="text-xs text-gray-400">
          {{ visible.length }} {{ visible.length === 1 ? 'transaction' : 'transactions' }}
        </p>
      </div>

      <p v-if="!visible.length" class="text-sm text-gray-500">No transactions yet.</p>
      <div v-else class="overflow-x-auto border border-gray-200 rounded-lg bg-white">
        <table class="w-full text-xs">
          <thead class="bg-gray-50 text-gray-500">
            <tr>
              <th class="text-left font-medium px-3 py-2 border-b border-gray-200">When</th>
              <th class="text-left font-medium px-3 py-2 border-b border-gray-200">Team</th>
              <th class="text-left font-medium px-3 py-2 border-b border-gray-200">Type</th>
              <th class="text-left font-medium px-3 py-2 border-b border-gray-200">Details</th>
              <th class="text-left font-medium px-3 py-2 border-b border-gray-200">Effective</th>
              <th class="text-right font-medium px-3 py-2 border-b border-gray-200">Penalty</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in visible" :key="e.key" class="bg-white even:bg-gray-50">
              <td class="px-3 py-2 text-gray-500 border-b border-gray-100 whitespace-nowrap">
                {{ fmtEt(e.at) }}
              </td>
              <td class="px-3 py-2 text-gray-700 border-b border-gray-100">
                <button
                  class="text-left hover:text-blue-600 hover:underline"
                  title="Show only this team"
                  @click="teamFilter = e.teamId"
                >
                  {{ teamLabel[e.teamId] ?? 'Unknown team' }}
                </button>
              </td>
              <td class="px-3 py-2 border-b border-gray-100 whitespace-nowrap">
                <span class="rounded-full px-2 py-0.5 font-medium" :class="kindClass[e.kind]">
                  {{ e.kind }}
                </span>
              </td>
              <td class="px-3 py-2 text-gray-700 border-b border-gray-100">{{ e.details }}</td>
              <td class="px-3 py-2 text-gray-500 border-b border-gray-100 whitespace-nowrap">
                {{ e.episode != null ? `Ep ${e.episode}` : '—' }}
              </td>
              <td
                class="px-3 py-2 text-right tabular-nums border-b border-gray-100 whitespace-nowrap"
                :class="e.penalty ? 'text-red-600' : 'text-gray-400'"
              >
                {{ e.penalty == null ? '—' : e.penalty ? `${e.penalty} pts` : 'Free' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
