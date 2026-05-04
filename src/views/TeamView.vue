<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'

type Season = { id: string; name: string }
type Contestant = { id: string; name: string; tribe: string }
type TeamPlayer = { contestant_id: string; role: string }

const auth = useAuthStore()
const router = useRouter()

const seasons = ref<Season[]>([])
const selectedSeasonId = ref('')
const allContestants = ref<Contestant[]>([])
const existingTeam = ref<{ id: string; team_name: string | null; players: TeamPlayer[] } | null>(null)
const loading = ref(true)
const saving = ref(false)
const errorMsg = ref('')

const teamName = ref('')
const selectedIds = ref<string[]>([])
const mvpId = ref<string | null>(null)

const byTribe = computed(() => {
  const map: Record<string, Contestant[]> = {}
  for (const c of allContestants.value) {
    if (!map[c.tribe]) map[c.tribe] = []
    map[c.tribe].push(c)
  }
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
})

const canSave = computed(() =>
  selectedIds.value.length === 4 && mvpId.value !== null && teamName.value.trim() !== '' && !existingTeam.value
)

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
    selectedSeasonId.value = seasons.value[0].id
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
    .select('id, team_name, team_players(contestant_id, role)')
    .eq('season_id', selectedSeasonId.value)
    .eq('user_id', auth.user.id)
    .maybeSingle()

  if (data) {
    existingTeam.value = { id: data.id, team_name: data.team_name, players: data.team_players as TeamPlayer[] }
    selectedIds.value = (data.team_players as TeamPlayer[]).map(p => p.contestant_id)
    mvpId.value = (data.team_players as TeamPlayer[]).find(p => p.role === 'mvp')?.contestant_id ?? null
    teamName.value = data.team_name ?? ''
  } else {
    existingTeam.value = null
    selectedIds.value = []
    mvpId.value = null
    teamName.value = ''
  }
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

  await loadMyTeam()
  saving.value = false
}

async function handleSignOut() {
  await supabase.auth.signOut()
  router.push('/login')
}

watch(selectedSeasonId, async () => {
  loading.value = true
  await Promise.all([loadContestants(), loadMyTeam()])
  loading.value = false
})

onMounted(async () => {
  await loadSeasons()
  await Promise.all([loadContestants(), loadMyTeam()])
  loading.value = false
})
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">The Ultimate Survivor Game</h1>
      <div class="flex items-center gap-4 text-sm">
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
              <h2 class="text-2xl font-bold">{{ seasons[0].name }}</h2>
            </div>
            <div v-else>
              <label class="block text-sm font-medium text-gray-700 mb-1">Season</label>
              <select
                v-model="selectedSeasonId"
                class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
          </div>

          <!-- Locked team banner -->
          <div v-if="existingTeam" class="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
            <p class="font-semibold text-green-800">
              Your team is locked in{{ existingTeam.team_name ? ': ' + existingTeam.team_name : '' }}
            </p>
            <p class="text-sm text-green-700 mt-0.5">4 contestants selected. Your MVP is marked with a star.</p>
          </div>

          <!-- Team name (only before saving) -->
          <div v-if="!existingTeam" class="mb-5">
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Team name
            </label>
            <input
              v-model="teamName"
              type="text"
              placeholder="e.g. The Fire Starters"
              class="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
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
              <div
                v-for="c in members"
                :key="c.id"
                @click="toggle(c.id)"
                :class="[
                  'relative rounded-xl border-2 p-3 transition-all select-none',
                  selectedIds.includes(c.id)
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white',
                  !existingTeam && !selectedIds.includes(c.id) && selectedIds.length >= 4
                    ? 'opacity-35 cursor-not-allowed'
                    : existingTeam
                    ? 'cursor-default'
                    : 'cursor-pointer hover:border-gray-300',
                ]"
              >
                <p class="font-semibold text-sm pr-5">{{ c.name }}</p>

                <!-- MVP toggle (interactive) -->
                <button
                  v-if="selectedIds.includes(c.id) && !existingTeam"
                  @click.stop="setMvp(c.id)"
                  class="absolute top-2 right-2 text-base leading-none"
                  :class="mvpId === c.id ? 'text-yellow-400' : 'text-gray-200 hover:text-yellow-300'"
                  title="Set as MVP"
                >★</button>

                <!-- MVP display (read-only) -->
                <span
                  v-if="existingTeam && mvpId === c.id"
                  class="absolute top-2 right-2 text-yellow-400 text-base leading-none"
                >★</span>
              </div>
            </div>
          </div>

          <!-- Save -->
          <div v-if="!existingTeam">
            <p v-if="errorMsg" class="text-red-600 text-sm mb-3">{{ errorMsg }}</p>
            <button
              @click="saveTeam"
              :disabled="!canSave || saving"
              class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-lg"
            >
              {{ saving ? 'Saving…' : 'Lock in my team' }}
            </button>
            <p v-if="!teamName.trim()" class="text-xs text-gray-400 mt-2">Enter a team name</p>
            <p v-else-if="selectedIds.length < 4" class="text-xs text-gray-400 mt-2">
              Select {{ 4 - selectedIds.length }} more contestant{{ 4 - selectedIds.length === 1 ? '' : 's' }}
            </p>
            <p v-else-if="!mvpId" class="text-xs text-gray-400 mt-2">
              Tap ★ on a contestant to set your MVP
            </p>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
