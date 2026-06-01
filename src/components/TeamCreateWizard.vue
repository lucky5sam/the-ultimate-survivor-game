<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import type { ContestantFull } from '../types/contestant'
import { getTribeColors } from '../utils/tribeColors'
import ContestantCard from './ContestantCard.vue'
import ContestantDetailModal from './ContestantDetailModal.vue'

const props = defineProps<{
  seasonId: string
  seasonName: string
  contestants: ContestantFull[]
  userId: string
}>()

const emit = defineEmits<{ created: [] }>()

const TOTAL_STEPS = 6
const STEP_LABELS = ['League Code', 'Team Name', 'Pick Players', 'Declare MVP', 'Bounty Pick', 'Review']

const step = ref(1)
const leagueCode = ref('')
const teamName = ref('')
const selectedIds = ref<string[]>([])
const mvpId = ref<string | null>(null)
const bountyId = ref<string | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const detailContestant = ref<ContestantFull | null>(null)
const carouselRef = ref<HTMLElement | null>(null)

function scrollCarousel(direction: 'left' | 'right') {
  carouselRef.value?.scrollBy({ left: direction === 'right' ? 780 : -780, behavior: 'smooth' })
}

const byTribe = computed(() => {
  const map: Record<string, ContestantFull[]> = {}
  for (const c of props.contestants) {
    if (!map[c.tribe]) map[c.tribe] = []
    map[c.tribe]!.push(c)
  }
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
})

const selectedContestants = computed(() =>
  selectedIds.value.map(id => props.contestants.find(c => c.id === id)!).filter(Boolean)
)

const bountyContestant = computed(() =>
  props.contestants.find(c => c.id === bountyId.value) ?? null
)

onMounted(() => {
  const saved = sessionStorage.getItem('pending_league_code')
  if (saved) leagueCode.value = saved
})

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
  if (step.value === 3 && selectedIds.value.length < 4) return
  if (step.value === 4 && !mvpId.value) { errorMsg.value = 'Choose your MVP'; return }
  if (step.value === 5 && !bountyId.value) { errorMsg.value = 'Choose a bounty pick'; return }

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
  <div class="bg-surface-page">
    <div class="px-8 sm:px-12 lg:px-20 pt-8 pb-16">

      <!-- Header -->
      <div class="text-center mb-10">
        <h1 class="text-3xl font-bold tracking-tight text-text-default">Build Your Tribe</h1>
        <p class="text-text-subtle mt-1 text-sm">{{ seasonName }}</p>
      </div>

      <!-- Step indicator: circles + lines -->
      <div class="flex items-center max-w-2xl mx-auto mb-2">
        <template v-for="n in TOTAL_STEPS" :key="n">
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all duration-300"
            :class="[
              step > n  ? 'bg-interactive-accent text-text-on-accent' :
              step === n ? 'bg-interactive-accent text-text-on-accent ring-4 ring-interactive-accent/20' :
                           'bg-surface-subtle text-text-muted border border-border-subtle'
            ]"
          >
            <span v-if="step > n">✓</span>
            <span v-else>{{ n }}</span>
          </div>
          <div
            v-if="n < TOTAL_STEPS"
            class="flex-1 h-px transition-colors duration-300"
            :class="step > n ? 'bg-interactive-accent' : 'bg-surface-strong'"
          />
        </template>
      </div>
      <!-- Step labels -->
      <div class="flex max-w-2xl mx-auto mb-10">
        <div
          v-for="(label, i) in STEP_LABELS"
          :key="i"
          class="flex-1 text-center"
        >
          <p
            class="text-xs mt-1 transition-colors duration-200 hidden sm:block"
            :class="[
              step === i + 1 ? 'text-text-accent font-semibold' :
              step > i + 1  ? 'text-text-subtle' :
                               'text-text-muted'
            ]"
          >{{ label }}</p>
        </div>
      </div>

      <!-- ── Step 1: League Code ── -->
      <template v-if="step === 1">
        <div class="max-w-sm mx-auto">
          <h2 class="text-xl font-bold text-text-default mb-1">Enter League Code</h2>
          <p class="text-text-subtle text-sm mb-6">Ask your league admin for the code to join {{ seasonName }}.</p>
          <div class="space-y-4">
            <input
              v-model="leagueCode"
              type="text"
              placeholder="Enter code…"
              @keyup.enter="nextStep"
              class="w-full bg-interactive-input border border-interactive-input-border text-text-default placeholder-text-muted rounded-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-interactive-input-border-focus/40 focus:border-interactive-input-border-focus transition-colors"
            />
            <p v-if="errorMsg" class="text-sm text-status-error">{{ errorMsg }}</p>
            <button
              @click="nextStep"
              :disabled="loading || !leagueCode.trim()"
              class="w-full bg-interactive-accent hover:bg-interactive-accent-hover disabled:opacity-40 text-text-on-accent font-bold px-6 py-3 rounded-md text-sm transition-colors"
            >
              {{ loading ? 'Checking…' : 'Continue' }}
            </button>
          </div>
        </div>
      </template>

      <!-- ── Step 2: Team Name ── -->
      <template v-else-if="step === 2">
        <div class="max-w-sm mx-auto">
          <h2 class="text-xl font-bold text-text-default mb-1">Name Your Tribe</h2>
          <p class="text-text-subtle text-sm mb-6">This is how you'll appear on the leaderboard.</p>
          <div class="space-y-4">
            <input
              v-model="teamName"
              type="text"
              placeholder="e.g. The Fire Starters"
              @keyup.enter="nextStep"
              class="w-full bg-interactive-input border border-interactive-input-border text-text-default placeholder-text-muted rounded-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-interactive-input-border-focus/40 focus:border-interactive-input-border-focus transition-colors"
            />
            <p v-if="errorMsg" class="text-sm text-status-error">{{ errorMsg }}</p>
            <div class="flex gap-3">
              <button
                @click="step--"
                class="bg-interactive-neutral hover:bg-interactive-neutral-hover border border-border-default text-text-subtle font-medium px-5 py-3 rounded-md text-sm transition-colors"
              >Back</button>
              <button
                @click="nextStep"
                :disabled="!teamName.trim()"
                class="flex-1 bg-interactive-accent hover:bg-interactive-accent-hover disabled:opacity-40 text-text-on-accent font-bold px-6 py-3 rounded-md text-sm transition-colors"
              >Continue</button>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Step 3: Pick 4 Players ── -->
      <template v-else-if="step === 3">
        <div class="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h2 class="text-xl font-bold text-text-default mb-0.5">Pick Your Survivors</h2>
            <p class="text-text-subtle text-sm">Choose 4 castaways for your tribe.</p>
          </div>
          <!-- Selection progress -->
          <div class="flex gap-3 shrink-0">
            <div v-for="i in 4" :key="i" class="flex flex-col items-center gap-1">
              <template v-if="selectedContestants[i - 1]">
                <div
                  class="w-12 h-12 rounded-full overflow-hidden border-2 transition-all duration-300"
                  :style="{ borderColor: getTribeColors(selectedContestants[i - 1]!.tribe).primary, boxShadow: `0 0 8px ${getTribeColors(selectedContestants[i - 1]!.tribe).primary}60` }"
                >
                  <img
                    v-if="selectedContestants[i - 1]!.photo_url"
                    :src="selectedContestants[i - 1]!.photo_url ?? undefined"
                    :alt="selectedContestants[i - 1]!.name"
                    class="w-full h-full object-cover object-top"
                  />
                  <div v-else class="w-full h-full bg-surface-strong flex items-center justify-center">
                    <svg class="w-6 h-6 text-icon-subtle" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                    </svg>
                  </div>
                </div>
                <span class="text-xs text-text-default font-medium w-12 text-center truncate leading-tight">
                  {{ selectedContestants[i - 1]!.name.split(' ')[0] }}
                </span>
              </template>
              <template v-else>
                <div class="w-12 h-12 rounded-full border-2 border-dashed border-border-subtle bg-surface-subtle/40 flex items-center justify-center transition-all duration-300">
                  <span class="text-text-muted text-xs font-bold">{{ i }}</span>
                </div>
                <span class="text-xs text-text-muted w-12 text-center">—</span>
              </template>
            </div>
          </div>
        </div>

        <!-- Full-bleed carousel -->
        <div class="relative -mx-8 sm:-mx-12 lg:-mx-20 mb-8">
          <!-- Edge fade — left -->
          <div class="absolute left-0 top-0 bottom-4 w-20 bg-gradient-to-r from-surface-page to-transparent z-10 pointer-events-none" />
          <!-- Edge fade — right -->
          <div class="absolute right-0 top-0 bottom-4 w-20 bg-gradient-to-l from-surface-page to-transparent z-10 pointer-events-none" />

          <!-- Scroll button — left -->
          <button
            @click="scrollCarousel('left')"
            class="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-surface-subtle/90 hover:bg-surface-strong border border-border-default hover:border-border-strong flex items-center justify-center text-text-default shadow-lg backdrop-blur-sm transition-all duration-200 hover:scale-110"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <!-- Scroll button — right -->
          <button
            @click="scrollCarousel('right')"
            class="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-surface-subtle/90 hover:bg-surface-strong border border-border-default hover:border-border-strong flex items-center justify-center text-text-default shadow-lg backdrop-blur-sm transition-all duration-200 hover:scale-110"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <div ref="carouselRef" class="flex gap-8 overflow-x-auto scrollbar-hide px-8 sm:px-12 lg:px-20 pb-4">
            <template v-for="(members, tribe) in byTribe" :key="tribe">
              <!-- Tribe group -->
              <div class="flex flex-col gap-2 shrink-0">
                <!-- Tribe label -->
                <div class="flex items-center gap-1.5 pl-0.5">
                  <div class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: getTribeColors(tribe as string).primary }" />
                  <span
                    class="text-xs font-bold uppercase tracking-widest"
                    :style="{ color: getTribeColors(tribe as string).text }"
                  >{{ tribe }}</span>
                </div>
                <!-- Cards row -->
                <div class="flex gap-3">
                  <div v-for="c in members" :key="c.id" class="w-60 shrink-0">
                    <ContestantCard
                      :contestant="c"
                      :selected="selectedIds.includes(c.id)"
                      :disabled="selectedIds.length >= 4 && !selectedIds.includes(c.id)"
                      @select="toggle(c.id)"
                      @view-details="detailContestant = c"
                    />
                  </div>
                </div>
              </div>
              <!-- Tribe divider -->
              <div class="w-px bg-border-subtle self-stretch shrink-0 mx-2" />
            </template>
          </div>
        </div>

        <div class="flex gap-3">
          <button
            @click="step--"
            class="bg-interactive-neutral hover:bg-interactive-neutral-hover border border-border-default text-text-subtle font-medium px-5 py-3 rounded-md text-sm transition-colors"
          >Back</button>
          <button
            @click="nextStep"
            :disabled="selectedIds.length < 4"
            class="bg-interactive-accent hover:bg-interactive-accent-hover disabled:opacity-40 text-text-on-accent font-bold px-8 py-3 rounded-md text-sm transition-colors"
          >Continue</button>
        </div>
      </template>

      <!-- ── Step 4: Declare MVP ── -->
      <template v-else-if="step === 4">
        <div class="text-center mb-8">
          <h2 class="text-xl font-bold text-text-default mb-1">Crown Your Champion</h2>
          <p class="text-text-subtle text-sm">Your MVP earns 1.5× points each episode. Choose wisely.</p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-xl mx-auto mb-8">
          <ContestantCard
            v-for="c in selectedContestants"
            :key="c.id"
            :contestant="c"
            :selected="c.id === mvpId"
            :disabled="false"
            :show-crown="true"
            @select="mvpId = mvpId === c.id ? null : c.id"
            @view-details="detailContestant = c"
          />
        </div>

        <p v-if="errorMsg" class="text-sm text-status-error text-center mb-4">{{ errorMsg }}</p>

        <div class="flex gap-3 justify-center">
          <button
            @click="step--"
            class="bg-interactive-neutral hover:bg-interactive-neutral-hover border border-border-default text-text-subtle font-medium px-5 py-3 rounded-md text-sm transition-colors"
          >Back</button>
          <button
            @click="nextStep"
            :disabled="!mvpId"
            class="bg-interactive-accent hover:bg-interactive-accent-hover disabled:opacity-40 text-text-on-accent font-bold px-8 py-3 rounded-md text-sm transition-colors"
          >Continue</button>
        </div>
      </template>

      <!-- ── Step 5: Bounty Pick ── -->
      <template v-else-if="step === 5">
        <div class="max-w-sm mx-auto">
          <h2 class="text-xl font-bold text-text-default mb-1">Set Your Bounty</h2>
          <p class="text-text-subtle text-sm mb-6">
            Who gets voted out first? Your pick carries forward each week — change it before any episode airs.
          </p>
          <div class="space-y-4">
            <select
              v-model="bountyId"
              class="w-full bg-interactive-input border border-interactive-input-border text-text-default rounded-md px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-interactive-input-border-focus/40 focus:border-interactive-input-border-focus transition-colors appearance-none"
            >
              <option :value="null" disabled class="text-text-muted">Select a castaway…</option>
              <optgroup
                v-for="(members, tribe) in byTribe"
                :key="tribe"
                :label="tribe as string"
                class="text-text-subtle"
              >
                <option v-for="c in members" :key="c.id" :value="c.id" class="text-text-default">
                  {{ c.name }}
                </option>
              </optgroup>
            </select>
            <p v-if="errorMsg" class="text-sm text-status-error">{{ errorMsg }}</p>
            <div class="flex gap-3">
              <button
                @click="step--"
                class="bg-interactive-neutral hover:bg-interactive-neutral-hover border border-border-default text-text-subtle font-medium px-5 py-3 rounded-md text-sm transition-colors"
              >Back</button>
              <button
                @click="nextStep"
                :disabled="!bountyId"
                class="flex-1 bg-interactive-accent hover:bg-interactive-accent-hover disabled:opacity-40 text-text-on-accent font-bold px-6 py-3 rounded-md text-sm transition-colors"
              >Continue</button>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Step 6: Review ── -->
      <template v-else-if="step === 6">
        <div class="max-w-md mx-auto">
          <h2 class="text-xl font-bold text-text-default mb-1">Review Your Tribe</h2>
          <p class="text-text-subtle text-sm mb-6">Once locked in, you can swap players between episodes.</p>

          <!-- Team name -->
          <div class="bg-surface-subtle rounded-md border border-border-subtle px-4 py-3 mb-4">
            <p class="text-xs text-text-muted uppercase tracking-wide mb-0.5">Tribe Name</p>
            <p class="font-bold text-text-default">{{ teamName }}</p>
          </div>

          <!-- Roster cards -->
          <p class="text-xs text-text-muted uppercase tracking-wide mb-3">Your Roster</p>
          <div class="grid grid-cols-4 gap-2 mb-4">
            <ContestantCard
              v-for="c in selectedContestants"
              :key="c.id"
              :contestant="c"
              :selected="c.id === mvpId"
              :disabled="false"
              :show-crown="true"
              @select="() => {}"
              @view-details="detailContestant = c"
            />
          </div>

          <!-- Bounty pick -->
          <div v-if="bountyContestant" class="bg-surface-subtle rounded-md border border-border-subtle px-4 py-3 mb-6">
            <p class="text-xs text-text-muted uppercase tracking-wide mb-0.5">Bounty Pick</p>
            <div class="flex items-center gap-2">
              <span class="font-semibold text-text-default text-sm">{{ bountyContestant.name }}</span>
              <span class="text-xs" :style="{ color: getTribeColors(bountyContestant.tribe).text }">
                {{ bountyContestant.tribe }}
              </span>
            </div>
          </div>

          <p v-if="errorMsg" class="text-sm text-status-error mb-4">{{ errorMsg }}</p>

          <div class="flex gap-3">
            <button
              @click="step--"
              class="bg-interactive-neutral hover:bg-interactive-neutral-hover border border-border-default text-text-subtle font-medium px-5 py-3 rounded-md text-sm transition-colors"
            >Back</button>
            <button
              @click="lockIn"
              :disabled="loading"
              class="flex-1 bg-interactive-accent hover:bg-interactive-accent-hover disabled:opacity-40 text-text-on-accent font-bold px-6 py-3 rounded-md text-sm transition-colors"
            >
              {{ loading ? 'Locking in…' : 'Lock In My Tribe 🔥' }}
            </button>
          </div>
        </div>
      </template>

    </div>
  </div>

  <!-- Contestant detail modal (teleported to body) -->
  <ContestantDetailModal
    :contestant="detailContestant"
    :show="!!detailContestant"
    :season-name="seasonName"
    @close="detailContestant = null"
  />
</template>
