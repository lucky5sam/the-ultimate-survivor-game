<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/auth'

type Contestant = { id: string; name: string; tribe: string }
type ActionType = { id: string; type: string; category: string; points: number }
type ActionEntry = {
  id: string
  count: number
  note: string | null
  contestants: { name: string }
  action_types: { category: string; points: number; type: string }
}
type Episode = { id: string; number: number; title: string | null; season_id: string }

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const episodeId = route.params.episodeId as string

const episode = ref<Episode | null>(null)
const seasonName = ref('')
const contestants = ref<Contestant[]>([])
const actionTypes = ref<ActionType[]>([])
const entries = ref<ActionEntry[]>([])
const loading = ref(true)
const saving = ref(false)
const errorMsg = ref('')

const form = ref({ contestantIds: [] as string[], actionTypeIds: [] as string[], count: 1, note: '' })
const showContestantDropdown = ref(false)
const showActionDropdown = ref(false)
const contestantSearch = ref('')
const actionSearch = ref('')
const contestantSearchInput = ref<HTMLInputElement | null>(null)
const actionSearchInput = ref<HTMLInputElement | null>(null)

function toggleContestantDropdown() {
  showContestantDropdown.value = !showContestantDropdown.value
  if (showContestantDropdown.value) nextTick(() => contestantSearchInput.value?.focus())
}

function toggleActionDropdown() {
  showActionDropdown.value = !showActionDropdown.value
  if (showActionDropdown.value) nextTick(() => actionSearchInput.value?.focus())
}
const bulkForm = ref({ tribe: '', actionTypeId: '' })

const byType = computed(() => {
  const map: Record<string, ActionType[]> = {}
  for (const a of actionTypes.value) {
    if (!map[a.type]) map[a.type] = []
    map[a.type].push(a)
  }
  return map
})

const tribes = computed(() => [...new Set(contestants.value.map(c => c.tribe))].sort())

const selectedContestantNames = computed(() =>
  form.value.contestantIds.map(id => contestants.value.find(c => c.id === id)?.name ?? '')
)

const selectedActionNames = computed(() =>
  form.value.actionTypeIds.map(id => actionTypes.value.find(a => a.id === id)?.category ?? '')
)

const filteredByTribe = computed(() => {
  const q = contestantSearch.value.toLowerCase()
  const map: Record<string, Contestant[]> = {}
  for (const [tribe, members] of Object.entries(byTribe.value)) {
    const filtered = q ? members.filter(c => c.name.toLowerCase().includes(q)) : members
    if (filtered.length) map[tribe] = filtered
  }
  return map
})

const filteredByType = computed(() => {
  const q = actionSearch.value.toLowerCase()
  const map: Record<string, ActionType[]> = {}
  for (const [type, actions] of Object.entries(byType.value)) {
    const filtered = q ? actions.filter(a => a.category.toLowerCase().includes(q)) : actions
    if (filtered.length) map[type] = filtered
  }
  return map
})

const byTribe = computed(() => {
  const map: Record<string, Contestant[]> = {}
  for (const c of contestants.value) {
    if (!map[c.tribe]) map[c.tribe] = []
    map[c.tribe].push(c)
  }
  return map
})

const totalPoints = computed(() =>
  entries.value.reduce((sum, e) => sum + e.action_types.points * e.count, 0)
)

async function loadEpisode() {
  const { data: ep } = await supabase
    .from('episodes')
    .select('id, number, title, season_id')
    .eq('id', episodeId)
    .single()
  if (!ep) return
  episode.value = ep

  const { data: season } = await supabase
    .from('seasons')
    .select('name')
    .eq('id', ep.season_id)
    .single()
  seasonName.value = season?.name ?? ''
}

async function loadContestants() {
  if (!episode.value) return
  const epNum = episode.value.number

  const [{ data: cData }, { data: tData }] = await Promise.all([
    supabase.from('contestants').select('id, name').eq('season_id', episode.value.season_id).order('name'),
    supabase.from('contestant_tribe_assignments')
      .select('contestant_id, tribe')
      .lte('effective_from_episode', epNum)
      .or(`effective_to_episode.is.null,effective_to_episode.gte.${epNum}`),
  ])

  const tribeMap = Object.fromEntries((tData ?? []).map(t => [t.contestant_id, t.tribe]))
  contestants.value = (cData ?? []).map(c => ({ ...c, tribe: tribeMap[c.id] ?? 'Unknown' }))
}

async function loadActionTypes() {
  if (!episode.value) return
  const { data } = await supabase
    .from('action_types')
    .select('id, type, category, points')
    .eq('season_id', episode.value.season_id)
    .order('sort_order')
  actionTypes.value = data ?? []
}

async function loadEntries() {
  const { data, error } = await supabase
    .from('contestant_actions')
    .select('id, count, note, contestants(name), action_types(category, points, type)')
    .eq('episode_id', episodeId)
    .order('created_at')
  if (error) errorMsg.value = error.message
  else entries.value = data as ActionEntry[] ?? []
}

async function addEntry() {
  if (!form.value.contestantIds.length || !form.value.actionTypeIds.length) return
  saving.value = true
  errorMsg.value = ''

  const rows = form.value.contestantIds.flatMap(cId =>
    form.value.actionTypeIds.map(aId => ({
      episode_id: episodeId,
      contestant_id: cId,
      action_type_id: aId,
      count: form.value.count,
      note: form.value.note || null,
      created_by: auth.user!.id,
    }))
  )

  const { error } = await supabase.from('contestant_actions').insert(rows)
  if (error) { errorMsg.value = error.message; saving.value = false; return }

  form.value = { contestantIds: [], actionTypeIds: [], count: 1, note: '' }
  await loadEntries()
  saving.value = false
}



async function bulkAddByTribe() {
  const members = byTribe.value[bulkForm.value.tribe] ?? []
  if (!members.length || !bulkForm.value.actionTypeId) return
  saving.value = true
  errorMsg.value = ''

  const rows = members.map(c => ({
    episode_id: episodeId,
    contestant_id: c.id,
    action_type_id: bulkForm.value.actionTypeId,
    count: 1,
    created_by: auth.user!.id,
  }))

  const { error } = await supabase.from('contestant_actions').insert(rows)
  if (error) { errorMsg.value = error.message; saving.value = false; return }

  bulkForm.value = { tribe: '', actionTypeId: '' }
  await loadEntries()
  saving.value = false
}

async function deleteEntry(id: string) {
  const { error } = await supabase.from('contestant_actions').delete().eq('id', id)
  if (error) errorMsg.value = error.message
  else await loadEntries()
}

function pointsLabel(points: number) {
  return points > 0 ? `+${points}` : `${points}`
}

onMounted(async () => {
  await loadEpisode()
  await Promise.all([loadContestants(), loadActionTypes(), loadEntries()])
  loading.value = false
})
</script>

<template>
  <div>
    <div class="mb-6">
      <button
        @click="router.push('/admin/episodes')"
        class="text-sm text-gray-500 hover:text-gray-700 mb-3 flex items-center gap-1"
      >
        ← Episodes
      </button>
      <div v-if="episode">
        <h1 class="text-2xl font-bold">
          Episode {{ episode.number }}{{ episode.title ? ': ' + episode.title : '' }}
        </h1>
        <p class="text-sm text-gray-500 mt-0.5">{{ seasonName }}</p>
      </div>
    </div>

    <div v-if="loading" class="text-gray-400 text-sm">Loading…</div>

    <template v-else>
      <!-- Tribe bulk add -->
      <div class="bg-white rounded-xl shadow p-5 mb-4">
        <h2 class="text-sm font-semibold text-gray-700 mb-1">Tribe Quick Add</h2>
        <p class="text-xs text-gray-400 mb-4">Add one action for every contestant currently on a tribe.</p>
        <div class="flex flex-wrap gap-3 items-end">
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">Tribe</label>
            <select
              v-model="bulkForm.tribe"
              class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="" disabled>Select…</option>
              <option v-for="tribe in tribes" :key="tribe" :value="tribe">
                {{ tribe }} ({{ byTribe[tribe]?.length ?? 0 }})
              </option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">Action</label>
            <select
              v-model="bulkForm.actionTypeId"
              class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="" disabled>Select…</option>
              <optgroup v-for="(actions, type) in byType" :key="type" :label="type">
                <option v-for="a in actions" :key="a.id" :value="a.id">
                  {{ a.category }} ({{ pointsLabel(a.points) }})
                </option>
              </optgroup>
            </select>
          </div>

          <button
            @click="bulkAddByTribe"
            :disabled="!bulkForm.tribe || !bulkForm.actionTypeId || saving"
            class="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            {{ saving ? 'Adding…' : `Add for all${bulkForm.tribe ? ' · ' + bulkForm.tribe : ''}` }}
          </button>
        </div>
      </div>

      <!-- Add action form -->
      <div class="bg-white rounded-xl shadow p-5 mb-6">
        <h2 class="text-sm font-semibold text-gray-700 mb-4">Add Action</h2>
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div class="relative">
            <label class="block text-xs font-medium text-gray-600 mb-1">Contestant</label>
            <button
              type="button"
              @click="toggleContestantDropdown"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-left flex flex-wrap items-center gap-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[38px]"
            >
              <template v-if="selectedContestantNames.length">
                <span v-for="name in selectedContestantNames" :key="name" class="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded-full">{{ name }}</span>
              </template>
              <span v-else class="text-gray-400">Select…</span>
              <span class="ml-auto text-gray-400 text-xs">▾</span>
            </button>

            <div v-if="showContestantDropdown" class="fixed inset-0 z-10" @click="showContestantDropdown = false; contestantSearch = ''" />

            <div
              v-if="showContestantDropdown"
              class="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 flex flex-col"
            >
              <div class="p-2 border-b border-gray-100">
                <input
                  ref="contestantSearchInput"
                  v-model="contestantSearch"
                  type="text"
                  placeholder="Search…"
                  class="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div class="overflow-y-auto">
              <div v-for="(members, tribe) in filteredByTribe" :key="tribe">
                <div class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-400 bg-gray-50 sticky top-0">
                  {{ tribe }}
                </div>
                <label
                  v-for="c in members"
                  :key="c.id"
                  class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                >
                  <input type="checkbox" :value="c.id" v-model="form.contestantIds" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span class="text-sm">{{ c.name }}</span>
                </label>
              </div>
              </div>
            </div>
          </div>

          <div class="relative">
            <label class="block text-xs font-medium text-gray-600 mb-1">Action</label>
            <button
              type="button"
              @click="toggleActionDropdown"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-left flex flex-wrap items-center gap-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[38px]"
            >
              <template v-if="selectedActionNames.length">
                <span v-for="name in selectedActionNames" :key="name" class="bg-indigo-100 text-indigo-800 text-xs font-medium px-2 py-0.5 rounded-full">{{ name }}</span>
              </template>
              <span v-else class="text-gray-400">Select…</span>
              <span class="ml-auto text-gray-400 text-xs">▾</span>
            </button>

            <div v-if="showActionDropdown" class="fixed inset-0 z-10" @click="showActionDropdown = false; actionSearch = ''" />

            <div
              v-if="showActionDropdown"
              class="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 flex flex-col"
            >
              <div class="p-2 border-b border-gray-100">
                <input
                  ref="actionSearchInput"
                  v-model="actionSearch"
                  type="text"
                  placeholder="Search…"
                  class="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div class="overflow-y-auto">
              <div v-for="(actions, type) in filteredByType" :key="type">
                <div class="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-400 bg-gray-50 sticky top-0">
                  {{ type }}
                </div>
                <label
                  v-for="a in actions"
                  :key="a.id"
                  class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                >
                  <input type="checkbox" :value="a.id" v-model="form.actionTypeIds" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span class="text-sm flex-1">{{ a.category }}</span>
                  <span class="text-xs font-mono" :class="a.points >= 0 ? 'text-green-600' : 'text-red-500'">{{ pointsLabel(a.points) }}</span>
                </label>
              </div>
              </div>
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">Count</label>
            <input
              v-model.number="form.count"
              type="number"
              min="1"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">
              Note <span class="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              v-model="form.note"
              type="text"
              placeholder="e.g. idol played on ally"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <p v-if="errorMsg" class="text-red-600 text-sm mt-3">{{ errorMsg }}</p>

        <button
          @click="addEntry"
          :disabled="!form.contestantIds.length || !form.actionTypeIds.length || saving"
          class="mt-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          {{ saving ? 'Adding…' : 'Add' }}
        </button>
      </div>

      <!-- Action log -->
      <div class="bg-white rounded-xl shadow overflow-hidden">
        <div class="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-700">
            Action Log <span class="text-gray-400 font-normal">({{ entries.length }} entries)</span>
          </h2>
          <span class="text-sm font-semibold" :class="totalPoints >= 0 ? 'text-green-600' : 'text-red-600'">
            {{ pointsLabel(totalPoints) }} pts total
          </span>
        </div>

        <div v-if="entries.length === 0" class="px-4 py-6 text-sm text-gray-400">
          No actions logged yet.
        </div>

        <table v-else class="w-full text-sm">
          <thead class="bg-gray-50 text-gray-500 text-left text-xs uppercase tracking-wide">
            <tr>
              <th class="px-4 py-2">Contestant</th>
              <th class="px-4 py-2">Action</th>
              <th class="px-4 py-2">Pts</th>
              <th class="px-4 py-2">Count</th>
              <th class="px-4 py-2">Note</th>
              <th class="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.id" class="border-t border-gray-100">
              <td class="px-4 py-2 font-medium">{{ entry.contestants.name }}</td>
              <td class="px-4 py-2">{{ entry.action_types.category }}</td>
              <td class="px-4 py-2 font-mono" :class="entry.action_types.points >= 0 ? 'text-green-600' : 'text-red-500'">
                {{ pointsLabel(entry.action_types.points) }}
              </td>
              <td class="px-4 py-2">{{ entry.count > 1 ? `×${entry.count}` : '—' }}</td>
              <td class="px-4 py-2 text-gray-400">{{ entry.note ?? '—' }}</td>
              <td class="px-4 py-2 text-right">
                <button @click="deleteEntry(entry.id)" class="text-red-400 hover:text-red-600 text-xs font-medium">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
