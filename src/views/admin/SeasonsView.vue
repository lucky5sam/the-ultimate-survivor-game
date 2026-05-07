<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../../lib/supabase'

type Season = {
  id: string
  name: string
  status: string
  bounty_points_pre_merge: number
  bounty_points_post_merge: number
  bounty_points_finale: number
  swap_penalty_mvp: number
  swap_penalty_player: number
  swap_penalty_role_change: number
  grace_period_through_episode: number
  max_swaps: number | null
  created_at: string
}

const seasons = ref<Season[]>([])
const loading = ref(true)
const errorMsg = ref('')
const showForm = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)

const form = ref({
  name: '',
  status: 'upcoming',
  bounty_points_pre_merge: 5,
  bounty_points_post_merge: 10,
  bounty_points_finale: 15,
  swap_penalty_mvp: 15,
  swap_penalty_player: 10,
  swap_penalty_role_change: 5,
  grace_period_through_episode: 1,
  max_swaps: null as number | null,
})

async function loadSeasons() {
  loading.value = true
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) errorMsg.value = error.message
  else seasons.value = data ?? []
  loading.value = false
}

async function saveSeason() {
  saving.value = true
  errorMsg.value = ''

  if (editingId.value) {
    const { error } = await supabase.from('seasons').update(form.value).eq('id', editingId.value)
    if (error) { errorMsg.value = error.message; saving.value = false; return }
  } else {
    const { error } = await supabase.from('seasons').insert(form.value)
    if (error) { errorMsg.value = error.message; saving.value = false; return }
  }

  showForm.value = false
  resetForm()
  await loadSeasons()
  saving.value = false
}

async function deleteSeason(id: string, name: string) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
  const { error } = await supabase.from('seasons').delete().eq('id', id)
  if (error) errorMsg.value = error.message
  else await loadSeasons()
}

function openCreate() {
  editingId.value = null
  resetForm()
  showForm.value = true
}

function openEdit(season: Season) {
  editingId.value = season.id
  form.value = {
    name: season.name,
    status: season.status,
    bounty_points_pre_merge: season.bounty_points_pre_merge,
    bounty_points_post_merge: season.bounty_points_post_merge,
    bounty_points_finale: season.bounty_points_finale,
    swap_penalty_mvp: season.swap_penalty_mvp,
    swap_penalty_player: season.swap_penalty_player,
    swap_penalty_role_change: season.swap_penalty_role_change,
    grace_period_through_episode: season.grace_period_through_episode,
    max_swaps: season.max_swaps,
  }
  showForm.value = true
}

function resetForm() {
  form.value = {
    name: '',
    status: 'upcoming',
    bounty_points_pre_merge: 5,
    bounty_points_post_merge: 10,
    bounty_points_finale: 15,
    swap_penalty_mvp: 15,
    swap_penalty_player: 10,
    swap_penalty_role_change: 5,
    grace_period_through_episode: 1,
    max_swaps: null,
  }
}

const statusLabel: Record<string, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
}

const statusColor: Record<string, string> = {
  upcoming: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-600',
}

onMounted(loadSeasons)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Seasons</h1>
      <button
        @click="openCreate"
        class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
      >
        + New Season
      </button>
    </div>

    <p v-if="errorMsg" class="text-red-600 text-sm mb-4">{{ errorMsg }}</p>
    <div v-if="loading" class="text-gray-400 text-sm">Loading…</div>

    <div v-else-if="seasons.length === 0" class="text-gray-400 text-sm">
      No seasons yet. Create one to get started.
    </div>

    <table v-else class="w-full text-sm bg-white rounded-xl shadow overflow-hidden">
      <thead class="bg-gray-100 text-gray-600 text-left">
        <tr>
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Status</th>
          <th class="px-4 py-3">Bounty (pre/post/finale)</th>
          <th class="px-4 py-3">Swap penalty (MVP/player/role)</th>
          <th class="px-4 py-3">Grace / Max swaps</th>
          <th class="px-4 py-3"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="season in seasons" :key="season.id" class="border-t border-gray-100">
          <td class="px-4 py-3 font-medium">{{ season.name }}</td>
          <td class="px-4 py-3">
            <span :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusColor[season.status]]">
              {{ statusLabel[season.status] ?? season.status }}
            </span>
          </td>
          <td class="px-4 py-3">{{ season.bounty_points_pre_merge }} / {{ season.bounty_points_post_merge }} / {{ season.bounty_points_finale }}</td>
          <td class="px-4 py-3">{{ season.swap_penalty_mvp }} / {{ season.swap_penalty_player }} / {{ season.swap_penalty_role_change }}</td>
          <td class="px-4 py-3">Ep {{ season.grace_period_through_episode }} / {{ season.max_swaps ?? '∞' }}</td>
          <td class="px-4 py-3 text-right space-x-3">
            <button @click="openEdit(season)" class="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
            <button @click="deleteSeason(season.id, season.name)" class="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
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
      <div class="bg-white rounded-xl shadow-lg w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-bold mb-4">{{ editingId ? 'Edit Season' : 'New Season' }}</h2>

        <form @submit.prevent="saveSeason" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Season name</label>
            <input v-model="form.name" type="text" required placeholder="e.g. Survivor 50"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select v-model="form.status"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="upcoming">Upcoming</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Bounty points</p>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Pre-merge</label>
                <input v-model.number="form.bounty_points_pre_merge" type="number" min="0"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Post-merge</label>
                <input v-model.number="form.bounty_points_post_merge" type="number" min="0"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Finale</label>
                <input v-model.number="form.bounty_points_finale" type="number" min="0"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>

          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Swap penalties</p>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">MVP swap</label>
                <input v-model.number="form.swap_penalty_mvp" type="number" min="0"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Player swap</label>
                <input v-model.number="form.swap_penalty_player" type="number" min="0"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Role change</label>
                <input v-model.number="form.swap_penalty_role_change" type="number" min="0"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Grace period through episode</label>
              <input v-model.number="form.grace_period_through_episode" type="number" min="0"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Max swaps <span class="text-gray-400 font-normal">(blank = unlimited)</span>
              </label>
              <input v-model.number="form.max_swaps" type="number" min="1" placeholder="∞"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>

          <div class="flex justify-end gap-3 pt-2">
            <button type="button" @click="showForm = false; resetForm()"
              class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
            <button type="submit" :disabled="saving"
              class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg">
              {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create season' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
