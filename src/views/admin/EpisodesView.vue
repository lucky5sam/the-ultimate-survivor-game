<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../../lib/supabase'

type Season = { id: string; name: string; current_episode_id: string | null }
type Episode = {
  id: string; number: number; title: string | null; air_date: string | null
  status: string; is_merge: boolean; is_finale: boolean; bounty_contestant_id: string | null
}
type Contestant = { id: string; name: string }

const router = useRouter()
const seasons = ref<Season[]>([])
const selectedSeasonId = ref('')
const selectedSeason = ref<Season | null>(null)
const episodes = ref<Episode[]>([])
const contestants = ref<Contestant[]>([])
const loading = ref(false)
const errorMsg = ref('')
const showForm = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)

const nextNumber = computed(() =>
  episodes.value.length > 0 ? Math.max(...episodes.value.map(e => e.number)) + 1 : 1
)

const form = ref({ number: 1, title: '', air_date: '', is_merge: false, is_finale: false, bounty_contestant_id: '' })

const contestantMap = computed(() =>
  Object.fromEntries(contestants.value.map(c => [c.id, c.name]))
)

async function loadSeasons() {
  const { data } = await supabase
    .from('seasons')
    .select('id, name, current_episode_id')
    .order('created_at', { ascending: false })
  seasons.value = data ?? []
  if (seasons.value.length > 0 && !selectedSeasonId.value) {
    selectedSeasonId.value = seasons.value[0]!.id
    selectedSeason.value = seasons.value[0] ?? null
  }
}

async function loadEpisodes() {
  if (!selectedSeasonId.value) return
  loading.value = true
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('season_id', selectedSeasonId.value)
    .order('number')
  if (error) errorMsg.value = error.message
  else episodes.value = data ?? []
  loading.value = false
}

async function loadContestants() {
  if (!selectedSeasonId.value) return
  const { data } = await supabase
    .from('contestants')
    .select('id, name')
    .eq('season_id', selectedSeasonId.value)
    .order('name')
  contestants.value = data ?? []
}

async function saveEpisode() {
  saving.value = true
  errorMsg.value = ''

  if (editingId.value) {
    const { error } = await supabase.from('episodes').update({
      number: form.value.number,
      title: form.value.title || null,
      air_date: form.value.air_date || null,
      is_merge: form.value.is_merge,
      is_finale: form.value.is_finale,
      bounty_contestant_id: form.value.bounty_contestant_id || null,
    }).eq('id', editingId.value)
    if (error) { errorMsg.value = error.message; saving.value = false; return }
  } else {
    const { error } = await supabase.from('episodes').insert({
      number: form.value.number,
      title: form.value.title || null,
      air_date: form.value.air_date || null,
      season_id: selectedSeasonId.value,
      status: 'upcoming',
      is_merge: form.value.is_merge,
      is_finale: form.value.is_finale,
    })
    if (error) { errorMsg.value = error.message; saving.value = false; return }
  }

  showForm.value = false
  resetForm()
  await loadEpisodes()
  saving.value = false
}

async function startEpisode(episode: Episode) {
  const { error: epErr } = await supabase.from('episodes').update({ status: 'active' }).eq('id', episode.id)
  if (epErr) { errorMsg.value = epErr.message; return }
  const { error: sErr } = await supabase.from('seasons').update({ current_episode_id: episode.id }).eq('id', selectedSeasonId.value)
  if (sErr) { errorMsg.value = sErr.message; return }
  selectedSeason.value = { ...selectedSeason.value!, current_episode_id: episode.id }
  await loadEpisodes()
}

async function endEpisode(episode: Episode) {
  const { error } = await supabase.from('episodes').update({ status: 'completed' }).eq('id', episode.id)
  if (error) { errorMsg.value = error.message; return }
  await loadEpisodes()
}

async function deleteEpisode(id: string, number: number) {
  if (!confirm(`Delete Episode ${number}? This cannot be undone.`)) return
  const { error } = await supabase.from('episodes').delete().eq('id', id)
  if (error) errorMsg.value = error.message
  else await loadEpisodes()
}

function openCreate() {
  editingId.value = null
  form.value = { number: nextNumber.value, title: '', air_date: '', is_merge: false, is_finale: false, bounty_contestant_id: '' }
  showForm.value = true
}

function openEdit(ep: Episode) {
  editingId.value = ep.id
  form.value = {
    number: ep.number,
    title: ep.title ?? '',
    air_date: ep.air_date ?? '',
    is_merge: ep.is_merge,
    is_finale: ep.is_finale,
    bounty_contestant_id: ep.bounty_contestant_id ?? '',
  }
  showForm.value = true
}

function resetForm() {
  form.value = { number: nextNumber.value, title: '', air_date: '', is_merge: false, is_finale: false, bounty_contestant_id: '' }
}

const statusColor: Record<string, string> = {
  upcoming: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-600',
}

watch(selectedSeasonId, async (id) => {
  selectedSeason.value = seasons.value.find(s => s.id === id) ?? null
  await Promise.all([loadEpisodes(), loadContestants()])
})

onMounted(async () => {
  await loadSeasons()
  await Promise.all([loadEpisodes(), loadContestants()])
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Episodes</h1>
      <button
        @click="openCreate"
        :disabled="!selectedSeasonId"
        class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg"
      >
        + New Episode
      </button>
    </div>

    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-1">Season</label>
      <select
        v-model="selectedSeasonId"
        class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <p v-if="errorMsg" class="text-red-600 text-sm mb-4">{{ errorMsg }}</p>
    <div v-if="loading" class="text-gray-400 text-sm">Loading…</div>

    <div v-else-if="episodes.length === 0" class="text-gray-400 text-sm">
      No episodes yet. Create one to get started.
    </div>

    <table v-else class="w-full text-sm bg-white rounded-xl shadow overflow-hidden">
      <thead class="bg-gray-100 text-gray-600 text-left">
        <tr>
          <th class="px-4 py-3">#</th>
          <th class="px-4 py-3">Title</th>
          <th class="px-4 py-3">Air Date</th>
          <th class="px-4 py-3">Status</th>
          <th class="px-4 py-3">Bounty Result</th>
          <th class="px-4 py-3"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="ep in episodes" :key="ep.id" class="border-t border-gray-100">
          <td class="px-4 py-3 font-medium">
            {{ ep.number }}
            <span v-if="ep.id === selectedSeason?.current_episode_id" class="ml-1 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">CURRENT</span>
            <span v-if="ep.is_merge" class="ml-1 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">MERGE</span>
            <span v-if="ep.is_finale" class="ml-1 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">FINALE</span>
          </td>
          <td class="px-4 py-3">{{ ep.title ?? '—' }}</td>
          <td class="px-4 py-3 text-gray-500">{{ ep.air_date ?? '—' }}</td>
          <td class="px-4 py-3">
            <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusColor[ep.status]]">
              {{ ep.status.charAt(0).toUpperCase() + ep.status.slice(1) }}
            </span>
          </td>
          <td class="px-4 py-3 text-xs text-gray-500">
            {{ ep.bounty_contestant_id ? (contestantMap[ep.bounty_contestant_id] ?? '—') : '—' }}
          </td>
          <td class="px-4 py-3 text-right space-x-3">
            <button @click="router.push(`/admin/episodes/${ep.id}/actions`)" class="text-blue-600 hover:text-blue-800 text-xs font-medium">Actions</button>
            <button v-if="ep.status === 'upcoming'" @click="startEpisode(ep)" class="text-green-600 hover:text-green-800 text-xs font-medium">Start</button>
            <button v-if="ep.status === 'active'" @click="endEpisode(ep)" class="text-gray-500 hover:text-gray-700 text-xs font-medium">End</button>
            <button @click="openEdit(ep)" class="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
            <button @click="deleteEpisode(ep.id, ep.number)" class="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Create / Edit Modal -->
    <div
      v-if="showForm"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      @click.self="showForm = false"
    >
      <div class="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
        <h2 class="text-lg font-bold mb-4">{{ editingId ? 'Edit Episode' : 'New Episode' }}</h2>

        <form @submit.prevent="saveEpisode" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Episode number</label>
            <input v-model.number="form.number" type="number" min="1" required
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Title <span class="text-gray-400 font-normal">(optional)</span>
            </label>
            <input v-model="form.title" type="text" placeholder="e.g. It's a New Era"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Air date <span class="text-gray-400 font-normal">(optional)</span>
            </label>
            <input v-model="form.air_date" type="date"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div class="flex gap-6">
            <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" v-model="form.is_merge" class="rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
              Merge episode
            </label>
            <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" v-model="form.is_finale" class="rounded border-gray-300 text-amber-500 focus:ring-amber-500" />
              Finale
            </label>
          </div>

          <!-- Bounty result — only on edit, set after episode airs -->
          <div v-if="editingId">
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Bounty result <span class="text-gray-400 font-normal">(voted out / winner)</span>
            </label>
            <select v-model="form.bounty_contestant_id"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Not set</option>
              <option v-for="c in contestants" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>

          <div class="flex justify-end gap-3 pt-2">
            <button type="button" @click="showForm = false" class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
            <button type="submit" :disabled="saving"
              class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg">
              {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create episode' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
