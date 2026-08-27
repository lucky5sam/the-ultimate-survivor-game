<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import type { ContestantFull } from '../types/contestant'
import { getTribeColors } from '../utils/tribeColors'
import ContestantCard from './ContestantCard.vue'
import ContestantDetailModal from './ContestantDetailModal.vue'
import BaseButton from './base/BaseButton.vue'
import BaseInput from './base/BaseInput.vue'
import ThemeAtmosphere from './decor/ThemeAtmosphere.vue'

const props = defineProps<{
  seasonId: string
  seasonName: string
  contestants: ContestantFull[]
  userId: string
}>()

const emit = defineEmits<{ created: [] }>()

const TOTAL_STEPS = 6
const STEP_LABELS = [
  'League Code',
  'Team Name',
  'Pick Players',
  'Declare MVP',
  'Bounty Pick',
  'Review',
]

const step = ref(1)
const leagueCode = ref('')
const teamName = ref('')
const selectedIds = ref<string[]>([])
const mvpId = ref<string | null>(null)
const bountyId = ref<string | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const detailContestant = ref<ContestantFull | null>(null)

const sortedContestants = computed(() =>
  [...props.contestants].sort((a, b) => a.name.localeCompare(b.name)),
)

const selectedContestants = computed(() =>
  selectedIds.value.map((id) => props.contestants.find((c) => c.id === id)!).filter(Boolean),
)

const bountyContestant = computed(
  () => props.contestants.find((c) => c.id === bountyId.value) ?? null,
)

const mvpContestant = computed(() => props.contestants.find((c) => c.id === mvpId.value) ?? null)

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
    if (!leagueCode.value.trim()) {
      errorMsg.value = 'Enter the league code'
      return
    }
    loading.value = true
    const { data: valid, error } = await supabase.rpc('check_registration_code', {
      code: leagueCode.value.trim(),
    })
    loading.value = false
    if (error || !valid) {
      errorMsg.value = 'Invalid league code'
      return
    }
    sessionStorage.removeItem('pending_league_code')
  }

  if (step.value === 2 && !teamName.value.trim()) {
    errorMsg.value = 'Enter a team name'
    return
  }
  if (step.value === 3 && selectedIds.value.length < 4) return
  if (step.value === 4 && !mvpId.value) {
    errorMsg.value = 'Choose your MVP'
    return
  }
  if (step.value === 5 && !bountyId.value) {
    errorMsg.value = 'Choose a bounty pick'
    return
  }

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
  if (e1) {
    errorMsg.value = e1.message
    loading.value = false
    return
  }

  const { error: e2 } = await supabase.from('team_players').insert(
    selectedIds.value.map((id) => ({
      team_id: team.id,
      contestant_id: id,
      role: id === mvpId.value ? 'mvp' : 'player',
      effective_from_episode: 1,
    })),
  )
  if (e2) {
    errorMsg.value = e2.message
    loading.value = false
    return
  }

  const { error: e3 } = await supabase.from('bounty_picks').insert({
    team_id: team.id,
    season_id: props.seasonId,
    contestant_id: bountyId.value,
    effective_from_episode: 1,
  })
  if (e3) {
    errorMsg.value = e3.message
    loading.value = false
    return
  }

  loading.value = false
  emit('created')
}
</script>

<template>
  <!-- overflow-x-clip (not overflow-hidden) clips the full-bleed carousel without
       creating a scroll container, so the sticky action bar below still works. -->
  <div class="relative overflow-x-clip bg-surface-page">
    <ThemeAtmosphere />
    <div class="relative z-10 px-8 sm:px-12 lg:px-20 pt-8 pb-16">
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
              step > n
                ? 'bg-interactive-accent text-text-on-accent'
                : step === n
                  ? 'bg-interactive-accent text-text-on-accent ring-4 ring-interactive-accent/20'
                  : 'bg-surface-subtle text-text-muted border border-border-subtle',
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
        <div v-for="(label, i) in STEP_LABELS" :key="i" class="flex-1 text-center">
          <p
            class="text-xs mt-1 transition-colors duration-200 hidden sm:block"
            :class="[
              step === i + 1
                ? 'text-text-accent font-semibold'
                : step > i + 1
                  ? 'text-text-subtle'
                  : 'text-text-muted',
            ]"
          >
            {{ label }}
          </p>
        </div>
      </div>

      <!-- ── Step 1: League Code ── -->
      <template v-if="step === 1">
        <div class="max-w-sm mx-auto">
          <h2 class="text-xl font-bold text-text-default mb-1">Enter League Code</h2>
          <p class="text-text-subtle text-sm mb-6">
            Ask your league admin for the code to join {{ seasonName }}.
          </p>
          <div class="space-y-4">
            <BaseInput
              v-model="leagueCode"
              size="lg"
              placeholder="Enter code…"
              :error="errorMsg"
              @keyup.enter="nextStep"
            />
            <BaseButton
              block
              size="lg"
              :loading="loading"
              :disabled="!leagueCode.trim()"
              @click="nextStep"
            >
              Continue
            </BaseButton>
          </div>
        </div>
      </template>

      <!-- ── Step 2: Team Name ── -->
      <template v-else-if="step === 2">
        <div class="max-w-sm mx-auto">
          <h2 class="text-xl font-bold text-text-default mb-1">Name Your Tribe</h2>
          <p class="text-text-subtle text-sm mb-6">This is how you'll appear on the leaderboard.</p>
          <div class="space-y-4">
            <BaseInput
              v-model="teamName"
              size="lg"
              placeholder="e.g. The Fire Starters"
              :error="errorMsg"
              @keyup.enter="nextStep"
            />
            <div class="flex gap-3">
              <BaseButton variant="secondary" size="lg" @click="step--">Back</BaseButton>
              <BaseButton size="lg" class="flex-1" :disabled="!teamName.trim()" @click="nextStep">
                Continue
              </BaseButton>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Step 3: Pick 4 Players ── -->
      <template v-else-if="step === 3">
        <div class="mb-6">
          <h2 class="text-xl font-bold text-text-default mb-0.5">Pick Your Survivors</h2>
          <p class="text-text-subtle text-sm">Choose 4 castaways for your tribe.</p>
        </div>

        <!-- Reflowing grid, alphabetical. Tribe is shown on each card, so no grouping.
             At least 2 columns on phones; adds columns as space allows, cards never
             narrower than 120px. Capped by max-width so it doesn't sprawl. -->
        <div
          class="mx-auto mb-8 grid max-w-5xl grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4"
        >
          <ContestantCard
            v-for="c in sortedContestants"
            :key="c.id"
            :contestant="c"
            :selected="selectedIds.includes(c.id)"
            :disabled="selectedIds.length >= 4 && !selectedIds.includes(c.id)"
            @select="toggle(c.id)"
            @view-details="detailContestant = c"
          />
        </div>

        <!-- Sticky bar: selected picks (context) + actions, always reachable at thumb height -->
        <div
          class="sticky bottom-0 z-30 -mx-8 mt-4 border-t border-border-subtle bg-surface-page/95 px-8 py-3 backdrop-blur sm:-mx-12 sm:px-12 lg:-mx-20 lg:px-20"
        >
          <div class="mx-auto max-w-2xl">
            <!-- Your 4 picks -->
            <div class="mb-3 flex items-center gap-2">
              <div v-for="i in 4" :key="i" class="flex w-11 flex-col items-center gap-0.5">
                <template v-if="selectedContestants[i - 1]">
                  <div
                    class="h-9 w-9 overflow-hidden rounded-full border-2"
                    :style="{
                      borderColor: getTribeColors(selectedContestants[i - 1]!.tribe).primary,
                      boxShadow: `0 0 6px ${getTribeColors(selectedContestants[i - 1]!.tribe).primary}55`,
                    }"
                  >
                    <img
                      v-if="selectedContestants[i - 1]!.photo_url"
                      :src="selectedContestants[i - 1]!.photo_url ?? undefined"
                      :alt="selectedContestants[i - 1]!.name"
                      class="h-full w-full object-cover object-top"
                    />
                    <div
                      v-else
                      class="flex h-full w-full items-center justify-center bg-surface-strong"
                    >
                      <svg class="h-4 w-4 text-icon-subtle" fill="currentColor" viewBox="0 0 24 24">
                        <path
                          d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
                        />
                      </svg>
                    </div>
                  </div>
                  <span
                    class="w-11 truncate text-center text-[10px] font-medium leading-tight text-text-default"
                  >
                    {{ selectedContestants[i - 1]!.name.split(' ')[0] }}
                  </span>
                </template>
                <template v-else>
                  <div
                    class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-border-subtle bg-surface-subtle/40"
                  >
                    <span class="text-[10px] font-bold text-text-muted">{{ i }}</span>
                  </div>
                  <span class="text-[10px] text-text-muted">—</span>
                </template>
              </div>
              <span class="ml-auto text-xs font-medium text-text-muted"
                >{{ selectedIds.length }}/4</span
              >
            </div>

            <!-- Actions -->
            <div class="flex gap-3">
              <BaseButton variant="secondary" size="lg" @click="step--">Back</BaseButton>
              <BaseButton
                size="lg"
                class="flex-1"
                :disabled="selectedIds.length < 4"
                @click="nextStep"
              >
                {{ selectedIds.length < 4 ? `Pick ${4 - selectedIds.length} more` : 'Continue' }}
              </BaseButton>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Step 4: Declare MVP ── -->
      <template v-else-if="step === 4">
        <div class="text-center mb-8">
          <h2 class="text-xl font-bold text-text-default mb-1">Crown Your Champion</h2>
          <p class="text-text-subtle text-sm">
            Your MVP earns 1.5× points each episode. Choose wisely.
          </p>
        </div>

        <div
          class="mx-auto mb-8 grid max-w-lg grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4"
        >
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

        <!-- Sticky bar: your picks (MVP marked) + actions, mirroring the roster step -->
        <div
          class="sticky bottom-0 z-30 -mx-8 mt-4 border-t border-border-subtle bg-surface-page/95 px-8 py-3 backdrop-blur sm:-mx-12 sm:px-12 lg:-mx-20 lg:px-20"
        >
          <div class="mx-auto max-w-2xl">
            <!-- Your 4 picks, MVP highlighted -->
            <div class="mb-3 flex items-center gap-2">
              <div v-for="i in 4" :key="i" class="flex w-11 flex-col items-center gap-0.5">
                <template v-if="selectedContestants[i - 1]">
                  <div class="relative">
                    <div
                      class="h-9 w-9 overflow-hidden rounded-full border-2"
                      :style="
                        selectedContestants[i - 1]!.id === mvpId
                          ? {
                              borderColor: 'var(--color-survivor-sand)',
                              boxShadow: '0 0 6px var(--color-survivor-sand)',
                            }
                          : {
                              borderColor: getTribeColors(selectedContestants[i - 1]!.tribe)
                                .primary,
                              boxShadow: `0 0 6px ${getTribeColors(selectedContestants[i - 1]!.tribe).primary}55`,
                            }
                      "
                    >
                      <img
                        v-if="selectedContestants[i - 1]!.photo_url"
                        :src="selectedContestants[i - 1]!.photo_url ?? undefined"
                        :alt="selectedContestants[i - 1]!.name"
                        class="h-full w-full object-cover object-top"
                      />
                      <div
                        v-else
                        class="flex h-full w-full items-center justify-center bg-surface-strong"
                      >
                        <svg
                          class="h-4 w-4 text-icon-subtle"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
                          />
                        </svg>
                      </div>
                    </div>
                    <!-- Crown badge for the MVP -->
                    <span
                      v-if="selectedContestants[i - 1]!.id === mvpId"
                      class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-survivor-sand"
                    >
                      <svg class="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z" />
                      </svg>
                    </span>
                  </div>
                  <span
                    class="w-11 truncate text-center text-[10px] font-medium leading-tight"
                    :class="
                      selectedContestants[i - 1]!.id === mvpId
                        ? 'text-survivor-sand'
                        : 'text-text-default'
                    "
                  >
                    {{ selectedContestants[i - 1]!.name.split(' ')[0] }}
                  </span>
                </template>
              </div>
              <span class="ml-auto text-xs font-medium text-survivor-sand">
                {{ mvpContestant ? `MVP: ${mvpContestant.name.split(' ')[0]}` : '' }}
              </span>
            </div>

            <p v-if="errorMsg" class="mb-2 text-sm text-status-error">{{ errorMsg }}</p>

            <!-- Actions -->
            <div class="flex gap-3">
              <BaseButton variant="secondary" size="lg" @click="step--">Back</BaseButton>
              <BaseButton size="lg" class="flex-1" :disabled="!mvpId" @click="nextStep">
                {{ mvpId ? 'Continue' : 'Choose your MVP' }}
              </BaseButton>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Step 5: Bounty Pick ── -->
      <template v-else-if="step === 5">
        <div class="mb-6">
          <h2 class="text-xl font-bold text-text-default mb-0.5">Set Your Bounty</h2>
          <p class="text-text-subtle text-sm">
            Who gets voted out first? Your pick carries forward each week — change it before any
            episode airs.
          </p>
        </div>

        <!-- Same reflowing grid as Pick Players, but a single target selection -->
        <div
          class="mx-auto mb-8 grid max-w-5xl grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4"
        >
          <ContestantCard
            v-for="c in sortedContestants"
            :key="c.id"
            :contestant="c"
            :selected="c.id === bountyId"
            :disabled="false"
            @select="bountyId = bountyId === c.id ? null : c.id"
            @view-details="detailContestant = c"
          />
        </div>

        <!-- Sticky action bar -->
        <div
          class="sticky bottom-0 z-30 -mx-8 mt-4 border-t border-border-subtle bg-surface-page/95 px-8 py-3 backdrop-blur sm:-mx-12 sm:px-12 lg:-mx-20 lg:px-20"
        >
          <div class="mx-auto max-w-2xl">
            <p v-if="errorMsg" class="mb-2 text-sm text-status-error">{{ errorMsg }}</p>
            <div class="flex gap-3">
              <BaseButton variant="secondary" size="lg" @click="step--">Back</BaseButton>
              <BaseButton size="lg" class="flex-1" :disabled="!bountyId" @click="nextStep">
                {{ bountyId ? 'Continue' : 'Pick a target' }}
              </BaseButton>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Step 6: Review ── -->
      <template v-else-if="step === 6">
        <div class="max-w-md mx-auto">
          <h2 class="text-xl font-bold text-text-default mb-1">Review Your Tribe</h2>
          <p class="text-text-subtle text-sm mb-6">
            Once locked in, you can swap players between episodes.
          </p>

          <!-- Team name -->
          <div
            class="surface-card bg-surface-subtle rounded-md border border-border-subtle px-4 py-3 mb-4"
          >
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
          <div
            v-if="bountyContestant"
            class="surface-card bg-surface-subtle rounded-md border border-border-subtle px-4 py-3 mb-6"
          >
            <p class="text-xs text-text-muted uppercase tracking-wide mb-0.5">Bounty Pick</p>
            <div class="flex items-center gap-2">
              <span class="font-semibold text-text-default text-sm">{{
                bountyContestant.name
              }}</span>
              <span class="text-xs" :style="{ color: getTribeColors(bountyContestant.tribe).text }">
                {{ bountyContestant.tribe }}
              </span>
            </div>
          </div>

          <p v-if="errorMsg" class="text-sm text-status-error mb-4">{{ errorMsg }}</p>

          <div class="flex gap-3">
            <BaseButton variant="secondary" size="lg" @click="step--">Back</BaseButton>
            <BaseButton size="lg" class="flex-1" :loading="loading" @click="lockIn">
              {{ loading ? 'Locking in…' : 'Lock In My Tribe 🔥' }}
            </BaseButton>
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
