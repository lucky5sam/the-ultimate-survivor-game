<script setup lang="ts">
// Admin: lock a season's team with a message (e.g. "Venmo payment overdue").
// While locked, the owner's My Team page shows the message instead of the team
// (TeamView), which also blocks swaps, bounty picks and edits. Scoring and the
// rest of the app are unaffected. Locks live in team_locks (admin-only writes).
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import LoadingState from '../../components/LoadingState.vue'

type Season = { id: string; name: string }
type Team = { id: string; label: string }
type Lock = { team_id: string; message: string; created_at: string }

const MAX_LEN = 500

const seasons = ref<Season[]>([])
const selectedSeasonId = ref('')
const teams = ref<Team[]>([])
const locks = ref<Lock[]>([])
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')

const form = ref({ teamId: '', message: '' })

const teamsById = computed(() => Object.fromEntries(teams.value.map((t) => [t.id, t])))
const lockedIds = computed(() => new Set(locks.value.map((l) => l.team_id)))
const sortedLocks = computed(() =>
  [...locks.value].sort((a, b) => b.created_at.localeCompare(a.created_at)),
)

async function loadSeasons() {
  const { data } = await supabase
    .from('seasons')
    .select('id, name')
    .order('created_at', { ascending: false })
  seasons.value = data ?? []
  if (seasons.value.length && !selectedSeasonId.value) selectedSeasonId.value = seasons.value[0]!.id
}

async function loadSeason() {
  const sid = selectedSeasonId.value
  if (!sid) return
  loading.value = true
  errorMsg.value = ''
  try {
    const { data: teamRows, error: teamErr } = await supabase
      .from('teams')
      .select('id, team_name, user_id')
      .eq('season_id', sid)
    if (teamErr) throw teamErr
    const ids = (teamRows ?? []).map((t) => t.id)
    const ownerIds = [...new Set((teamRows ?? []).map((t) => t.user_id))]
    const [ownersRes, locksRes] = await Promise.all([
      ownerIds.length
        ? supabase.from('public_profiles').select('id, first_name, last_name').in('id', ownerIds)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? supabase.from('team_locks').select('team_id, message, created_at').in('team_id', ids)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (ownersRes.error) throw ownersRes.error
    if (locksRes.error) throw locksRes.error
    const ownerName = Object.fromEntries(
      (ownersRes.data ?? []).map((o) => [
        o.id,
        [o.first_name, o.last_name].filter(Boolean).join(' '),
      ]),
    )
    teams.value = (teamRows ?? [])
      .map((t) => {
        const name = t.team_name || 'Unnamed team'
        const owner = ownerName[t.user_id]
        return { id: t.id, label: owner ? `${owner} — ${name}` : name }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
    locks.value = (locksRes.data ?? []) as Lock[]
  } catch (e) {
    // Supabase errors are plain objects with a message, not Error instances.
    errorMsg.value = (e as { message?: string })?.message ?? 'Failed to load teams'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadSeasons()
  await loadSeason()
})
watch(selectedSeasonId, () => {
  form.value = { teamId: '', message: '' }
  loadSeason()
})

// Picking an already-locked team pre-fills its message, so saving updates it.
watch(
  () => form.value.teamId,
  (id) => {
    const existing = locks.value.find((l) => l.team_id === id)
    if (existing) form.value.message = existing.message
  },
)

async function saveLock() {
  const message = form.value.message.trim()
  if (!form.value.teamId || !message) return
  saving.value = true
  errorMsg.value = ''
  const { error } = await supabase
    .from('team_locks')
    .upsert({ team_id: form.value.teamId, message }, { onConflict: 'team_id' })
  saving.value = false
  if (error) {
    errorMsg.value = error.message
    return
  }
  form.value = { teamId: '', message: '' }
  await loadSeason()
}

async function unlock(l: Lock) {
  const label = teamsById.value[l.team_id]?.label ?? 'this team'
  if (!confirm(`Unlock ${label}?`)) return
  const { error } = await supabase.from('team_locks').delete().eq('team_id', l.team_id)
  if (error) errorMsg.value = error.message
  else await loadSeason()
}

function editLock(l: Lock) {
  form.value = { teamId: l.team_id, message: l.message }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="max-w-3xl">
    <h1 class="mb-6 text-2xl font-bold">Team Locks</h1>

    <div class="mb-6">
      <label class="mb-1 block text-sm font-medium text-gray-700">Season</label>
      <select
        v-model="selectedSeasonId"
        class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <p v-if="errorMsg" class="mb-4 text-sm text-red-600">{{ errorMsg }}</p>
    <LoadingState v-if="loading && !teams.length" />

    <template v-else>
      <!-- Lock (or update) a team -->
      <section class="mb-8 rounded-xl border border-gray-200 bg-white p-5">
        <h2 class="mb-1 text-sm font-semibold text-gray-800">Lock a team</h2>
        <p class="mb-4 text-xs text-gray-500">
          The owner sees your message instead of their My Team page (no swaps, bounty picks, or
          edits) until you unlock it. Scoring and the rest of the app are unaffected.
        </p>
        <form class="space-y-3" @submit.prevent="saveLock">
          <select
            v-model="form.teamId"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" disabled>Select a team…</option>
            <option v-for="t in teams" :key="t.id" :value="t.id">
              {{ t.label }}{{ lockedIds.has(t.id) ? ' (locked)' : '' }}
            </option>
          </select>
          <textarea
            v-model="form.message"
            rows="3"
            :maxlength="MAX_LEN"
            placeholder="Message to the player (e.g. Venmo payment overdue — $20 to @your-handle)"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          ></textarea>
          <button
            type="submit"
            :disabled="saving || !form.teamId || !form.message.trim()"
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
          >
            {{ saving ? 'Saving…' : lockedIds.has(form.teamId) ? 'Update Lock' : 'Lock Team' }}
          </button>
        </form>
      </section>

      <!-- Current locks -->
      <section class="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <h2 class="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-800">
          Locked teams
        </h2>
        <p v-if="!sortedLocks.length" class="px-5 py-4 text-sm text-gray-500">
          No teams are locked.
        </p>
        <div
          v-for="l in sortedLocks"
          :key="l.team_id"
          class="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-3 last:border-b-0"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900">
              {{ teamsById[l.team_id]?.label ?? 'Unknown team' }}
              <span class="ml-1 text-xs font-normal text-gray-500">
                since {{ fmtDate(l.created_at) }}
              </span>
            </p>
            <p class="whitespace-pre-wrap break-words text-sm text-gray-600">{{ l.message }}</p>
          </div>
          <div class="shrink-0 space-x-3 whitespace-nowrap">
            <button
              class="text-xs font-medium text-blue-600 hover:text-blue-800"
              @click="editLock(l)"
            >
              Edit
            </button>
            <button class="text-xs font-medium text-red-600 hover:text-red-800" @click="unlock(l)">
              Unlock
            </button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
