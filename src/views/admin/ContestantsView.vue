<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { supabase } from '../../lib/supabase'

type Season = { id: string; name: string }
type Contestant = { id: string; season_id: string; name: string; photo_url: string | null }

const seasons = ref<Season[]>([])
const selectedSeasonId = ref<string>('')
const contestants = ref<Contestant[]>([])
const loading = ref(false)
const errorMsg = ref('')
const showForm = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)

const form = ref({ name: '', photo_url: '' })

async function loadSeasons() {
  const { data } = await supabase.from('seasons').select('id, name').order('created_at', { ascending: false })
  seasons.value = data ?? []
  if (seasons.value.length > 0 && !selectedSeasonId.value) {
    selectedSeasonId.value = seasons.value[0].id
  }
}

async function loadContestants() {
  if (!selectedSeasonId.value) return
  loading.value = true
  const { data, error } = await supabase
    .from('contestants')
    .select('*')
    .eq('season_id', selectedSeasonId.value)
    .order('name')
  if (error) errorMsg.value = error.message
  else contestants.value = data ?? []
  loading.value = false
}

async function saveContestant() {
  saving.value = true
  errorMsg.value = ''
  const payload = {
    name: form.value.name,
    photo_url: form.value.photo_url || null,
    season_id: selectedSeasonId.value,
  }

  if (editingId.value) {
    const { error } = await supabase.from('contestants').update(payload).eq('id', editingId.value)
    if (error) { errorMsg.value = error.message; saving.value = false; return }
  } else {
    const { error } = await supabase.from('contestants').insert(payload)
    if (error) { errorMsg.value = error.message; saving.value = false; return }
  }

  showForm.value = false
  resetForm()
  await loadContestants()
  saving.value = false
}

async function deleteContestant(id: string, name: string) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
  const { error } = await supabase.from('contestants').delete().eq('id', id)
  if (error) errorMsg.value = error.message
  else await loadContestants()
}

function openCreate() {
  editingId.value = null
  resetForm()
  showForm.value = true
}

function openEdit(c: Contestant) {
  editingId.value = c.id
  form.value = { name: c.name, photo_url: c.photo_url ?? '' }
  showForm.value = true
}

function resetForm() {
  form.value = { name: '', photo_url: '' }
}

watch(selectedSeasonId, loadContestants)
onMounted(async () => { await loadSeasons(); await loadContestants() })
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Contestants</h1>
      <button
        @click="openCreate"
        :disabled="!selectedSeasonId"
        class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg"
      >
        + Add Contestant
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

    <div v-if="!selectedSeasonId" class="text-gray-400 text-sm">
      No seasons found. Create a season first.
    </div>

    <div v-else-if="loading" class="text-gray-400 text-sm">Loading…</div>

    <div v-else-if="contestants.length === 0" class="text-gray-400 text-sm">
      No contestants yet for this season.
    </div>

    <table v-else class="w-full text-sm bg-white rounded-xl shadow overflow-hidden">
      <thead class="bg-gray-100 text-gray-600 text-left">
        <tr>
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Photo URL</th>
          <th class="px-4 py-3"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in contestants" :key="c.id" class="border-t border-gray-100">
          <td class="px-4 py-3 font-medium">{{ c.name }}</td>
          <td class="px-4 py-3 text-gray-400 truncate max-w-xs">{{ c.photo_url ?? '—' }}</td>
          <td class="px-4 py-3 text-right space-x-3">
            <button @click="openEdit(c)" class="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
            <button @click="deleteContestant(c.id, c.name)" class="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
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
        <h2 class="text-lg font-bold mb-4">{{ editingId ? 'Edit Contestant' : 'Add Contestant' }}</h2>

        <form @submit.prevent="saveContestant" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              v-model="form.name"
              type="text"
              required
              placeholder="e.g. Boston Rob"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Photo URL <span class="text-gray-400 font-normal">(optional)</span></label>
            <input
              v-model="form.photo_url"
              type="url"
              placeholder="https://…"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>

          <div class="flex justify-end gap-3 pt-2">
            <button
              type="button"
              @click="showForm = false; resetForm()"
              class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="saving"
              class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Add contestant' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
