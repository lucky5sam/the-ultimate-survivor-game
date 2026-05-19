<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'

type Contestant = { id: string; name: string; tribe: string }

const props = defineProps<{
  seasonId: string
  seasonName: string
  contestants: Contestant[]
  userId: string
}>()

const emit = defineEmits<{ created: [] }>()

const TOTAL_STEPS = 5

const step = ref(1)
const leagueCode = ref('')
const teamName = ref('')
const selectedIds = ref<string[]>([])
const mvpId = ref<string | null>(null)
const bountyId = ref<string | null>(null)
const loading = ref(false)
const errorMsg = ref('')

const byTribe = computed(() => {
  const map: Record<string, Contestant[]> = {}
  for (const c of props.contestants) {
    if (!map[c.tribe]) map[c.tribe] = []
    map[c.tribe]!.push(c)
  }
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
})

onMounted(() => {
  const saved = sessionStorage.getItem('pending_league_code')
  if (saved) leagueCode.value = saved
})

function contestantName(id: string) {
  return props.contestants.find(c => c.id === id)?.name ?? '?'
}

function toggle(id: string) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) {
    selectedIds.value.splice(idx, 1)
    if (mvpId.value === id) mvpId.value = null
  } else if (selectedIds.value.length < 4) {
    selectedIds.value.push(id)
  }
}

async function nextStep() {
  errorMsg.value = ''

  if (step.value === 1) {
    if (!leagueCode.value.trim()) { errorMsg.value = 'Enter the league code'; return }
    loading.value = true
    const { data: valid, error } = await supabase.rpc('check_registration_code', { code: leagueCode.value.trim() })
    loading.value = false
    if (error || !valid) { errorMsg.value = 'Invalid league code'; return }
    sessionStorage.removeItem('pending_league_code')
  }

  if (step.value === 2 && !teamName.value.trim()) { errorMsg.value = 'Enter a team name'; return }
  if (step.value === 3 && (selectedIds.value.length < 4 || !mvpId.value)) return
  if (step.value === 4 && !bountyId.value) { errorMsg.value = 'Choose a bounty pick'; return }

  step.value++
}

async function lockIn() {
  loading.value = true
  errorMsg.value = ''

  const { data: team, error: e1 } = await supabase
    .from('teams')
    .insert({ user_id: props.userId, season_id: props.seasonId, team_name: teamName.value.trim() })
    .select('id')
    .single()
  if (e1) { errorMsg.value = e1.message; loading.value = false; return }

  const { error: e2 } = await supabase.from('team_players').insert(
    selectedIds.value.map(id => ({
      team_id: team.id,
      contestant_id: id,
      role: id === mvpId.value ? 'mvp' : 'player',
      effective_from_episode: 1,
    }))
  )
  if (e2) { errorMsg.value = e2.message; loading.value = false; return }

  const { error: e3 } = await supabase.from('bounty_picks').insert({
    team_id: team.id,
    season_id: props.seasonId,
    contestant_id: bountyId.value,
    effective_from_episode: 1,
  })
  if (e3) { errorMsg.value = e3.message; loading.value = false; return }

  loading.value = false
  emit('created')
}
</script>

<template>
  <div class="max-w-2xl">
    <!-- Step indicator -->
    <div class="flex items-center mb-8">
      <template v-for="n in TOTAL_STEPS" :key="n">
        <div :class="[
          'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-colors',
          step > n ? 'bg-blue-600 text-white' : step === n ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400'
        ]">
          <span v-if="step > n">✓</span>
          <span v-else>{{ n }}</span>
        </div>
        <div v-if="n < TOTAL_STEPS" :class="['flex-1 h-0.5 mx-2 transition-colors', step > n ? 'bg-blue-600' : 'bg-gray-200']" />
      </template>
    </div>

    <!-- Step 1: League Code -->
    <template v-if="step === 1">
      <h2 class="text-xl font-bold mb-1">Enter League Code</h2>
      <p class="text-sm text-gray-500 mb-6">Ask your league admin for the code to join {{ seasonName }}.</p>
      <div class="space-y-4 max-w-sm">
        <input v-model="leagueCode" type="text" placeholder="Enter code…"
          @keyup.enter="nextStep"
          class="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>
        <button @click="nextStep" :disabled="loading || !leagueCode.trim()"
          class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">
          {{ loading ? 'Checking…' : 'Continue' }}
        </button>
      </div>
    </template>

    <!-- Step 2: Team Name -->
    <template v-else-if="step === 2">
      <h2 class="text-xl font-bold mb-1">Name Your Team</h2>
      <p class="text-sm text-gray-500 mb-6">This is how you'll appear on the leaderboard.</p>
      <div class="space-y-4 max-w-sm">
        <input v-model="teamName" type="text" placeholder="e.g. The Fire Starters"
          @keyup.enter="nextStep"
          class="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>
        <div class="flex gap-3">
          <button @click="step--" class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 border border-gray-200 rounded-lg">Back</button>
          <button @click="nextStep" :disabled="!teamName.trim()"
            class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">
            Continue
          </button>
        </div>
      </div>
    </template>

    <!-- Step 3: Pick Roster + MVP -->
    <template v-else-if="step === 3">
      <h2 class="text-xl font-bold mb-1">Pick Your Roster</h2>
      <p class="text-sm text-gray-500 mb-3">
        Choose 4 contestants. Tap <span class="text-yellow-500 font-bold">★</span> on one to make them your MVP
        <span class="text-gray-400">(earns 1.5× points)</span>.
      </p>
      <div class="flex gap-4 mb-5 text-sm">
        <span :class="selectedIds.length === 4 ? 'text-green-600 font-semibold' : 'text-blue-600 font-semibold'">
          {{ selectedIds.length }}/4 selected
        </span>
        <span v-if="mvpId" class="text-yellow-600 font-semibold">· MVP set ★</span>
        <span v-else-if="selectedIds.length === 4" class="text-gray-400">· Tap ★ to set MVP</span>
      </div>

      <div v-for="(members, tribe) in byTribe" :key="tribe" class="mb-6">
        <h3 class="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">{{ tribe }}</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div v-for="c in members" :key="c.id" @click="toggle(c.id)" :class="[
            'relative rounded-xl border-2 p-3 transition-all select-none',
            selectedIds.includes(c.id)
              ? 'border-blue-500 bg-blue-50 cursor-pointer'
              : selectedIds.length >= 4
                ? 'border-gray-200 bg-white opacity-35 cursor-not-allowed'
                : 'border-gray-200 bg-white cursor-pointer hover:border-gray-300',
          ]">
            <p class="font-semibold text-sm pr-5 leading-snug">{{ c.name }}</p>
            <button v-if="selectedIds.includes(c.id)" @click.stop="mvpId = mvpId === c.id ? null : c.id"
              :class="['absolute top-2 right-2 text-base leading-none', mvpId === c.id ? 'text-yellow-400' : 'text-gray-200 hover:text-yellow-300']">
              ★
            </button>
          </div>
        </div>
      </div>

      <div class="flex gap-3 mt-2">
        <button @click="step--" class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 border border-gray-200 rounded-lg">Back</button>
        <button @click="nextStep" :disabled="selectedIds.length < 4 || !mvpId"
          class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">
          Continue
        </button>
      </div>
    </template>

    <!-- Step 4: Bounty Pick -->
    <template v-else-if="step === 4">
      <h2 class="text-xl font-bold mb-1">Bounty Pick</h2>
      <p class="text-sm text-gray-500 mb-6">
        Who gets voted out first? Your pick carries forward each week — you can change it before any episode airs.
      </p>
      <div class="space-y-4 max-w-sm">
        <select v-model="bountyId"
          class="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option :value="null">Select a contestant…</option>
          <option v-for="c in contestants" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>
        <div class="flex gap-3">
          <button @click="step--" class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 border border-gray-200 rounded-lg">Back</button>
          <button @click="nextStep" :disabled="!bountyId"
            class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">
            Continue
          </button>
        </div>
      </div>
    </template>

    <!-- Step 5: Review -->
    <template v-else-if="step === 5">
      <h2 class="text-xl font-bold mb-1">Review Your Team</h2>
      <p class="text-sm text-gray-500 mb-6">Once locked in, you can swap players between episodes.</p>

      <div class="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-6 max-w-sm">
        <div class="px-4 py-3">
          <p class="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Team name</p>
          <p class="font-semibold">{{ teamName }}</p>
        </div>
        <div class="px-4 py-3">
          <p class="text-xs text-gray-400 uppercase tracking-wide mb-2">Roster</p>
          <div class="space-y-1.5">
            <div v-for="id in selectedIds" :key="id" class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ contestantName(id) }}</span>
              <span v-if="id === mvpId" class="text-yellow-400 text-sm">★ MVP</span>
            </div>
          </div>
        </div>
        <div class="px-4 py-3">
          <p class="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Bounty pick</p>
          <p class="font-medium text-sm">{{ contestantName(bountyId!) }}</p>
        </div>
      </div>

      <p v-if="errorMsg" class="text-sm text-red-600 mb-3">{{ errorMsg }}</p>
      <div class="flex gap-3">
        <button @click="step--" class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 border border-gray-200 rounded-lg">Back</button>
        <button @click="lockIn" :disabled="loading"
          class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold px-6 py-2.5 rounded-lg text-sm">
          {{ loading ? 'Saving…' : 'Lock in my team' }}
        </button>
      </div>
    </template>
  </div>
</template>
