<script setup lang="ts">
import { ref, computed, watchEffect, onMounted } from 'vue'
import { supabase } from '../../lib/supabase'
import { etInputToIso, isoToEtInput, fmtEt } from '../../lib/time'
import { getTribeColors } from '../../utils/tribeColors'

type Season = {
  id: string
  name: string
  status: string
  starts_at: string | null
  image_url: string | null
  bounty_points_pre_merge: number
  bounty_points_post_merge: number
  bounty_points_finale: number
  swap_penalty_mvp: number
  swap_penalty_player: number
  swap_penalty_role_change: number
  grace_period_through_episode: number
  max_swaps: number | null
  payouts: Payout[] | null
  created_at: string
}

// A prize payout for a finishing place, e.g. { place: 1, amount: 100 }.
type Payout = { place: number; amount: number }

type LocalSeasonAction = {
  catalogId: string
  seasonActionTypeId?: string
  type: string
  category: string
  defaultPoints: number
  points: number
  enabled: boolean
}

const seasons = ref<Season[]>([])
const loading = ref(true)
const errorMsg = ref('')
const showForm = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const activeTab = ref<'config' | 'actions' | 'tribes' | 'payouts'>('config')

// Tribes state (name + color per season)
type LocalTribe = { id?: string; name: string; color: string }
const localTribes = ref<LocalTribe[]>([])
const originalTribeIds = ref<Set<string>>(new Set())

const form = ref({
  name: '',
  status: 'upcoming',
  starts_at: '',
  image_url: '',
  bounty_points_pre_merge: 5,
  bounty_points_post_merge: 10,
  bounty_points_finale: 15,
  swap_penalty_mvp: 15,
  swap_penalty_player: 10,
  swap_penalty_role_change: 5,
  grace_period_through_episode: 1,
  max_swaps: null as number | null,
  payouts: [] as Payout[],
})

function addPayout() {
  // Default the new row's place to the next position in the list.
  form.value.payouts.push({ place: form.value.payouts.length + 1, amount: 0 })
}
function removePayout(i: number) {
  form.value.payouts.splice(i, 1)
}
// Total prize pool across all payout rows.
const payoutsTotal = computed(() =>
  form.value.payouts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
)

// Action types state
const localActionTypes = ref<LocalSeasonAction[]>([])
const masterCheckboxRef = ref<HTMLInputElement | null>(null)

const allEnabled = computed(
  () => localActionTypes.value.length > 0 && localActionTypes.value.every((a) => a.enabled),
)
const someEnabled = computed(() => localActionTypes.value.some((a) => a.enabled))
const enabledCount = computed(() => localActionTypes.value.filter((a) => a.enabled).length)

watchEffect(() => {
  if (masterCheckboxRef.value) {
    masterCheckboxRef.value.indeterminate = someEnabled.value && !allEnabled.value
  }
})

function toggleEnableAll() {
  const next = !allEnabled.value
  localActionTypes.value.forEach((a) => (a.enabled = next))
}

async function loadCatalog() {
  const { data } = await supabase
    .from('action_types')
    .select('id, type, category, points, sort_order')
    .order('sort_order')
  localActionTypes.value = (data ?? []).map((c) => ({
    catalogId: c.id,
    seasonActionTypeId: undefined,
    type: c.type,
    category: c.category,
    defaultPoints: c.points,
    points: c.points,
    enabled: true,
  }))
}

async function loadActionTypes(seasonId: string) {
  const [{ data: catalog }, { data: seasonActions }] = await Promise.all([
    supabase
      .from('action_types')
      .select('id, type, category, points, sort_order')
      .order('sort_order'),
    supabase
      .from('season_action_types')
      .select('id, action_type_id, points')
      .eq('season_id', seasonId),
  ])

  const seasonMap = new Map((seasonActions ?? []).map((a) => [a.action_type_id, a]))

  localActionTypes.value = (catalog ?? []).map((c) => {
    const existing = seasonMap.get(c.id)
    return {
      catalogId: c.id,
      seasonActionTypeId: existing?.id,
      type: c.type,
      category: c.category,
      defaultPoints: c.points,
      points: existing?.points ?? c.points,
      enabled: !!existing,
    }
  })
}

async function saveActionTypes(seasonId: string) {
  const enabled = localActionTypes.value.filter((a) => a.enabled)
  const disabledWithExisting = localActionTypes.value.filter(
    (a) => !a.enabled && a.seasonActionTypeId,
  )

  if (disabledWithExisting.length) {
    const { error } = await supabase
      .from('season_action_types')
      .delete()
      .in(
        'id',
        disabledWithExisting.map((a) => a.seasonActionTypeId!),
      )
    if (error) throw new Error(error.message)
  }

  const toUpsert = enabled.map((a, i) => ({
    ...(a.seasonActionTypeId ? { id: a.seasonActionTypeId } : {}),
    season_id: seasonId,
    action_type_id: a.catalogId,
    points: a.points,
    sort_order: i,
  }))

  if (toUpsert.length) {
    const { error } = await supabase
      .from('season_action_types')
      .upsert(toUpsert, { onConflict: 'id' })
    if (error) throw new Error(error.message)
  }
}

async function loadTribes(seasonId: string) {
  // Merge the saved tribes table with any tribe names already used on the roster
  // (assignments) that don't yet have a row — so the admin can just pick a color.
  const [{ data: tribeRows }, { data: contRows }] = await Promise.all([
    supabase.from('tribes').select('id, name, color').eq('season_id', seasonId),
    supabase
      .from('contestants')
      .select('contestant_tribe_assignments(tribe)')
      .eq('season_id', seasonId),
  ])

  originalTribeIds.value = new Set((tribeRows ?? []).map((t) => t.id))
  const byName = new Map((tribeRows ?? []).map((t) => [t.name, t]))

  const usedNames = new Set<string>()
  for (const c of contRows ?? []) {
    for (const a of (c.contestant_tribe_assignments as any[]) ?? []) {
      if (a.tribe) usedNames.add(a.tribe)
    }
  }

  const list: LocalTribe[] = (tribeRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
  }))
  for (const name of usedNames) {
    if (!byName.has(name)) list.push({ name, color: getTribeColors(name).primary })
  }
  localTribes.value = list.sort((a, b) => a.name.localeCompare(b.name))
}

async function saveTribes(seasonId: string) {
  const rows = localTribes.value.filter((t) => t.name.trim())

  const toUpsert = rows.map((t) => ({
    ...(t.id ? { id: t.id } : {}),
    season_id: seasonId,
    name: t.name.trim(),
    color: t.color,
  }))
  if (toUpsert.length) {
    const { error } = await supabase.from('tribes').upsert(toUpsert, { onConflict: 'id' })
    if (error) throw new Error(error.message)
  }

  // Delete tribes the admin removed from the list.
  const keptIds = new Set(rows.filter((t) => t.id).map((t) => t.id!))
  const toDelete = [...originalTribeIds.value].filter((id) => !keptIds.has(id))
  if (toDelete.length) {
    const { error } = await supabase.from('tribes').delete().in('id', toDelete)
    if (error) throw new Error(error.message)
  }
}

function addTribe() {
  localTribes.value.push({ name: '', color: '#f97316' })
}
function removeTribe(i: number) {
  localTribes.value.splice(i, 1)
}

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
  try {
    // starts_at is entered as an ET wall-clock string; store it as a UTC instant.
    const payload = {
      ...form.value,
      starts_at: etInputToIso(form.value.starts_at),
      image_url: form.value.image_url.trim() || null,
    }
    let seasonId = editingId.value

    if (editingId.value) {
      const { error } = await supabase.from('seasons').update(payload).eq('id', editingId.value)
      if (error) throw new Error(error.message)
    } else {
      const { data, error } = await supabase.from('seasons').insert(payload).select('id').single()
      if (error) throw new Error(error.message)
      seasonId = data.id
      // Promote to edit mode immediately so a failure in the steps below can't
      // create a duplicate season if the user retries the still-open form.
      editingId.value = seasonId
    }

    await saveActionTypes(seasonId!)
    await saveTribes(seasonId!)

    showForm.value = false
    resetForm()
    await loadSeasons()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to save season'
  } finally {
    saving.value = false
  }
}

async function deleteSeason(id: string, name: string) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
  const { error } = await supabase.from('seasons').delete().eq('id', id)
  if (error) errorMsg.value = error.message
  else await loadSeasons()
}

async function openCreate() {
  editingId.value = null
  resetForm()
  localTribes.value = []
  originalTribeIds.value = new Set()
  activeTab.value = 'config'
  await loadCatalog()
  showForm.value = true
}

async function openEdit(season: Season) {
  editingId.value = season.id
  form.value = {
    name: season.name,
    status: season.status,
    starts_at: isoToEtInput(season.starts_at),
    image_url: season.image_url ?? '',
    bounty_points_pre_merge: season.bounty_points_pre_merge,
    bounty_points_post_merge: season.bounty_points_post_merge,
    bounty_points_finale: season.bounty_points_finale,
    swap_penalty_mvp: season.swap_penalty_mvp,
    swap_penalty_player: season.swap_penalty_player,
    swap_penalty_role_change: season.swap_penalty_role_change,
    grace_period_through_episode: season.grace_period_through_episode,
    max_swaps: season.max_swaps,
    payouts: season.payouts ?? [],
  }
  activeTab.value = 'config'
  await Promise.all([loadActionTypes(season.id), loadTribes(season.id)])
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  resetForm()
}

function resetForm() {
  form.value = {
    name: '',
    status: 'upcoming',
    starts_at: '',
    image_url: '',
    bounty_points_pre_merge: 5,
    bounty_points_post_merge: 10,
    bounty_points_finale: 15,
    swap_penalty_mvp: 15,
    swap_penalty_player: 10,
    swap_penalty_role_change: 5,
    grace_period_through_episode: 1,
    max_swaps: null,
    payouts: [],
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
          <th class="px-4 py-3">Starts / Reg. closes</th>
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
            <span
              :class="['px-2 py-0.5 rounded-full text-xs font-medium', statusColor[season.status]]"
            >
              {{ statusLabel[season.status] ?? season.status }}
            </span>
          </td>
          <td class="px-4 py-3 text-gray-500">
            {{ season.starts_at ? fmtEt(season.starts_at) : '—' }}
          </td>
          <td class="px-4 py-3">
            {{ season.bounty_points_pre_merge }} / {{ season.bounty_points_post_merge }} /
            {{ season.bounty_points_finale }}
          </td>
          <td class="px-4 py-3">
            {{ season.swap_penalty_mvp }} / {{ season.swap_penalty_player }} /
            {{ season.swap_penalty_role_change }}
          </td>
          <td class="px-4 py-3">
            Ep {{ season.grace_period_through_episode }} / {{ season.max_swaps ?? '∞' }}
          </td>
          <td class="px-4 py-3 text-right space-x-3">
            <button
              @click="openEdit(season)"
              class="text-blue-600 hover:text-blue-800 text-xs font-medium"
            >
              Edit
            </button>
            <button
              @click="deleteSeason(season.id, season.name)"
              class="text-red-500 hover:text-red-700 text-xs font-medium"
            >
              Delete
            </button>
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
      <div class="bg-white rounded-xl shadow-lg w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-bold mb-4">{{ editingId ? 'Edit Season' : 'New Season' }}</h2>

        <!-- Tabs -->
        <div class="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1">
          <button
            @click="activeTab = 'config'"
            :class="[
              'flex-1 text-sm font-medium py-1.5 rounded-md transition-colors',
              activeTab === 'config'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700',
            ]"
          >
            Season Config
          </button>
          <button
            @click="activeTab = 'actions'"
            :class="[
              'flex-1 text-sm font-medium py-1.5 rounded-md transition-colors',
              activeTab === 'actions'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700',
            ]"
          >
            Action Types
            <span v-if="localActionTypes.length" class="ml-1 text-xs text-gray-400"
              >({{ enabledCount }}/{{ localActionTypes.length }})</span
            >
          </button>
          <button
            @click="activeTab = 'tribes'"
            :class="[
              'flex-1 text-sm font-medium py-1.5 rounded-md transition-colors',
              activeTab === 'tribes'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700',
            ]"
          >
            Tribes
            <span v-if="localTribes.length" class="ml-1 text-xs text-gray-400"
              >({{ localTribes.length }})</span
            >
          </button>
          <button
            @click="activeTab = 'payouts'"
            :class="[
              'flex-1 text-sm font-medium py-1.5 rounded-md transition-colors',
              activeTab === 'payouts'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700',
            ]"
          >
            Payouts
            <span v-if="form.payouts.length" class="ml-1 text-xs text-gray-400"
              >({{ form.payouts.length }})</span
            >
          </button>
        </div>

        <!-- Config tab -->
        <div v-if="activeTab === 'config'">
          <form @submit.prevent class="space-y-4">
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
              <label class="block text-sm font-medium text-gray-700 mb-1">Season image URL</label>
              <div class="flex items-center gap-3">
                <img
                  v-if="form.image_url.trim()"
                  :src="form.image_url.trim()"
                  alt="Season image preview"
                  class="h-10 w-10 shrink-0 rounded-full border border-gray-200 object-cover"
                />
                <span
                  v-else
                  class="h-10 w-10 shrink-0 rounded-full border border-gray-200 bg-gray-100"
                ></span>
                <input
                  v-model="form.image_url"
                  type="url"
                  placeholder="https://example.com/survivor-51.png"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <p class="mt-1 text-xs text-gray-400">
                Shown in the season selector. Leave blank for a placeholder circle.
              </p>
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

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Season starts
                <span class="text-gray-400 font-normal">(ET — registration closes)</span>
              </label>
              <input
                v-model="form.starts_at"
                type="datetime-local"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p class="mt-1 text-xs text-gray-400">
                New teams can be created until this time (Eastern). After it passes, the league is
                locked to new players. Leave blank to keep registration open.
              </p>
            </div>

            <div>
              <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Bounty points
              </p>
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Pre-merge</label>
                  <input
                    v-model.number="form.bounty_points_pre_merge"
                    type="number"
                    min="0"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Post-merge</label>
                  <input
                    v-model.number="form.bounty_points_post_merge"
                    type="number"
                    min="0"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Finale</label>
                  <input
                    v-model.number="form.bounty_points_finale"
                    type="number"
                    min="0"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div>
              <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Swap penalties
              </p>
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">MVP swap</label>
                  <input
                    v-model.number="form.swap_penalty_mvp"
                    type="number"
                    min="0"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Player swap</label>
                  <input
                    v-model.number="form.swap_penalty_player"
                    type="number"
                    min="0"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Role change</label>
                  <input
                    v-model.number="form.swap_penalty_role_change"
                    type="number"
                    min="0"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1"
                  >Grace period through episode</label
                >
                <input
                  v-model.number="form.grace_period_through_episode"
                  type="number"
                  min="0"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  Max swaps <span class="text-gray-400 font-normal">(blank = unlimited)</span>
                </label>
                <input
                  v-model.number="form.max_swaps"
                  type="number"
                  min="1"
                  placeholder="∞"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </form>
        </div>

        <!-- Action Types tab -->
        <div v-else-if="activeTab === 'actions'">
          <div class="flex items-center justify-between mb-3">
            <p class="text-sm text-gray-500">
              <span class="font-medium text-gray-700">{{ enabledCount }}</span> of
              {{ localActionTypes.length }} enabled
            </p>
            <p class="text-xs text-gray-400">
              To add or remove actions, edit the global catalog in Admin → Action Types.
            </p>
          </div>

          <div
            v-if="localActionTypes.length === 0"
            class="text-center py-8 text-sm text-gray-400 border border-gray-200 rounded-lg"
          >
            No actions in the catalog yet. Add some in Admin → Action Types.
          </div>

          <div v-else class="border border-gray-200 rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th class="w-10 px-3 py-2 text-center">
                    <input
                      ref="masterCheckboxRef"
                      type="checkbox"
                      :checked="allEnabled"
                      @change="toggleEnableAll"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 w-36">Type</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Category</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 w-24">Points</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-400 w-20">
                    Default
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="action in localActionTypes"
                  :key="action.catalogId"
                  :class="[
                    'border-t border-gray-100 transition-colors',
                    action.enabled ? '' : 'opacity-40',
                  ]"
                >
                  <td class="px-3 py-1.5 text-center">
                    <input
                      type="checkbox"
                      v-model="action.enabled"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td class="px-3 py-1.5 text-xs text-gray-600">{{ action.type }}</td>
                  <td class="px-3 py-1.5 text-xs font-medium text-gray-800">
                    {{ action.category }}
                  </td>
                  <td class="px-3 py-1.5">
                    <input
                      v-model.number="action.points"
                      type="number"
                      :disabled="!action.enabled"
                      class="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-transparent disabled:border-transparent"
                    />
                  </td>
                  <td class="px-3 py-1.5 text-xs text-gray-400">{{ action.defaultPoints }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tribes tab -->
        <div v-else-if="activeTab === 'tribes'">
          <div class="flex items-center justify-between mb-3">
            <p class="text-sm text-gray-500">
              Pick a color for each tribe. Used for the tribe badges across the app.
            </p>
            <button
              type="button"
              @click="addTribe"
              class="text-blue-600 hover:text-blue-800 text-sm font-medium shrink-0"
            >
              + Add tribe
            </button>
          </div>

          <div
            v-if="localTribes.length === 0"
            class="text-center py-8 text-sm text-gray-400 border border-gray-200 rounded-lg"
          >
            No tribes yet. Add one here, or set starting tribes in Admin → Contestants.
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="(t, i) in localTribes"
              :key="i"
              class="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2"
            >
              <input
                v-model="t.color"
                type="color"
                class="h-9 w-10 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
              />
              <input
                v-model="t.name"
                type="text"
                placeholder="Tribe name"
                class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold text-white"
                :style="{ backgroundColor: t.color }"
                :title="t.name"
                >{{ t.name.charAt(0).toUpperCase() || '?' }}</span
              >
              <button
                type="button"
                @click="removeTribe(i)"
                class="text-red-500 hover:text-red-700 text-xs font-medium shrink-0"
              >
                Remove
              </button>
            </div>
          </div>
        </div>

        <!-- Payouts tab -->
        <div v-else-if="activeTab === 'payouts'">
          <div class="flex items-center justify-between mb-3">
            <p class="text-sm text-gray-500">
              Prize amount awarded for each finishing place. Add as many as you like.
            </p>
            <button
              type="button"
              @click="addPayout"
              class="text-blue-600 hover:text-blue-800 text-sm font-medium shrink-0"
            >
              + Add payout
            </button>
          </div>

          <div
            v-if="form.payouts.length === 0"
            class="text-center py-8 text-sm text-gray-400 border border-gray-200 rounded-lg"
          >
            No payouts yet. Add one to define the prize pool.
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="(p, i) in form.payouts"
              :key="i"
              class="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2"
            >
              <div class="flex-1">
                <label class="block text-xs font-medium text-gray-700 mb-1">Place</label>
                <input
                  v-model.number="p.place"
                  type="number"
                  min="1"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div class="flex-1">
                <label class="block text-xs font-medium text-gray-700 mb-1">Amount ($)</label>
                <input
                  v-model.number="p.amount"
                  type="number"
                  min="0"
                  step="0.01"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                @click="removePayout(i)"
                class="text-red-500 hover:text-red-700 text-xs font-medium shrink-0 self-end pb-2"
              >
                Remove
              </button>
            </div>

            <div class="flex items-center justify-between border-t border-gray-200 pt-3 mt-1">
              <span class="text-sm font-semibold text-gray-700">Total prize pool</span>
              <span class="text-sm font-bold tabular-nums text-gray-900"
                >${{ payoutsTotal.toFixed(2) }}</span
              >
            </div>
          </div>
        </div>

        <p v-if="errorMsg" class="text-sm text-red-600 mt-4">{{ errorMsg }}</p>

        <div class="flex justify-end gap-3 pt-5 mt-2 border-t border-gray-100">
          <button
            type="button"
            @click="closeForm"
            class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
          >
            Cancel
          </button>
          <button
            @click="saveSeason"
            :disabled="saving"
            class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create season' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
