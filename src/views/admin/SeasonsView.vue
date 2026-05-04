<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../../lib/supabase'

type Season = {
  id: string
  name: string
  status: string
  bounty_points_pre_merge: number
  bounty_points_post_merge: number
  swap_penalty_mvp: number
  swap_penalty_player: number
  grace_period_through_episode: number
  created_at: string
}

const seasons = ref<Season[]>([])
const loading = ref(true)
const errorMsg = ref('')
const showForm = ref(false)
const saving = ref(false)

const form = ref({
  name: '',
  status: 'upcoming',
  bounty_points_pre_merge: 5,
  bounty_points_post_merge: 10,
  swap_penalty_mvp: 15,
  swap_penalty_player: 10,
  grace_period_through_episode: 1,
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

async function createSeason() {
  saving.value = true
  errorMsg.value = ''
  const { error } = await supabase.from('seasons').insert(form.value)
  if (error) {
    errorMsg.value = error.message
  } else {
    showForm.value = false
    resetForm()
    await loadSeasons()
  }
  saving.value = false
}

function resetForm() {
  form.value = {
    name: '',
    status: 'upcoming',
    bounty_points_pre_merge: 5,
    bounty_points_post_merge: 10,
    swap_penalty_mvp: 15,
    swap_penalty_player: 10,
    grace_period_through_episode: 1,
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
        @click="showForm = true"
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
          <th class="px-4 py-3">Bounty (pre/post)</th>
          <th class="px-4 py-3">Swap penalty (MVP/player)</th>
          <th class="px-4 py-3">Grace period</th>
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
          <td class="px-4 py-3">{{ season.bounty_points_pre_merge }} / {{ season.bounty_points_post_merge }}</td>
          <td class="px-4 py-3">{{ season.swap_penalty_mvp }} / {{ season.swap_penalty_player }}</td>
          <td class="px-4 py-3">Ep {{ season.grace_period_through_episode }}</td>
        </tr>
      </tbody>
    </table>

    <!-- Create Season Modal -->
    <div
      v-if="showForm"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      @click.self="showForm = false"
    >
      <div class="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
        <h2 class="text-lg font-bold mb-4">New Season</h2>

        <form @submit.prevent="createSeason" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Season name</label>
            <input
              v-model="form.name"
              type="text"
              required
              placeholder="e.g. Survivor 50"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              v-model="form.status"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="upcoming">Upcoming</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Bounty pts (pre-merge)</label>
              <input v-model.number="form.bounty_points_pre_merge" type="number" min="0"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Bounty pts (post-merge)</label>
              <input v-model.number="form.bounty_points_post_merge" type="number" min="0"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Swap penalty (MVP)</label>
              <input v-model.number="form.swap_penalty_mvp" type="number" min="0"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Swap penalty (player)</label>
              <input v-model.number="form.swap_penalty_player" type="number" min="0"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Grace period through episode</label>
            <input v-model.number="form.grace_period_through_episode" type="number" min="1"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
              {{ saving ? 'Saving…' : 'Create season' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
