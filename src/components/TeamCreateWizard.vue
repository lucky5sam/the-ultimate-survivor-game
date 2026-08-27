<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import type { ContestantFull } from '../types/contestant'
import { getTribeColors } from '../utils/tribeColors'
import ContestantCard from './ContestantCard.vue'
import ContestantDetailModal from './ContestantDetailModal.vue'
import ContestantAvatar from './ContestantAvatar.vue'
import TeamRosterList from './TeamRosterList.vue'
import WizardPicksStrip from './WizardPicksStrip.vue'
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

// Roster rows for the review step, shaped for the shared TeamRosterList. The
// season hasn't started, so there are no scores or eliminations yet — every
// player reads as "In the Game" with 0 points, previewing the real roster card.
const reviewPlayers = computed(() =>
  selectedIds.value.map((id) => ({
    contestant_id: id,
    role: (id === mvpId.value ? 'mvp' : 'player') as 'mvp' | 'player',
    effective_from_episode: 1,
  })),
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
        <div class="mx-auto mb-6 max-w-5xl">
          <h2 class="text-xl font-bold text-text-default mb-0.5">Pick Your Survivors</h2>
          <p class="text-text-subtle text-sm">Choose 4 castaways for your tribe.</p>
        </div>

        <!-- Reflowing grid, alphabetical. Tribe is shown on each card, so no grouping.
             At least 2 columns on phones (120px min); on larger screens the min jumps
             to 240px for bigger cards. Capped by max-width so it doesn't sprawl. -->
        <div
          class="mx-auto mb-8 grid max-w-5xl grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]"
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
          <!-- Your 4 picks + bounty slot — width matches the grid above -->
          <WizardPicksStrip
            class="mx-auto w-full max-w-5xl"
            :picks="selectedContestants"
            :mvp-id="mvpId"
            :bounty="bountyContestant"
          >
            <span class="text-xs font-medium text-text-muted">{{ selectedIds.length }}/4</span>
          </WizardPicksStrip>

          <!-- Actions -->
          <div class="mx-auto max-w-5xl">
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
        <div class="mx-auto mb-8 max-w-5xl text-center">
          <h2 class="text-xl font-bold text-text-default mb-1">Crown Your Champion</h2>
          <p class="text-text-subtle text-sm">
            Your MVP earns 1.5× points each episode. Choose wisely.
          </p>
        </div>

        <div
          class="mx-auto mb-8 grid max-w-5xl grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]"
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
          <!-- Width matches the grid above -->
          <div class="mx-auto max-w-5xl">
            <!-- Your 4 picks (MVP highlighted) + bounty slot -->
            <WizardPicksStrip :picks="selectedContestants" :mvp-id="mvpId" :bounty="bountyContestant">
              <span class="text-xs font-medium text-survivor-sand">
                {{ mvpContestant ? `MVP: ${mvpContestant.name.split(' ')[0]}` : '' }}
              </span>
            </WizardPicksStrip>

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
        <div class="mx-auto mb-6 max-w-5xl">
          <h2 class="text-xl font-bold text-text-default mb-0.5">Set Your Bounty</h2>
          <p class="text-text-subtle text-sm">
            Who gets voted out first? Your pick carries forward each week — change it before any
            episode airs.
          </p>
        </div>

        <!-- Same reflowing grid as Pick Players, but a single target selection -->
        <div
          class="mx-auto mb-8 grid max-w-5xl grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]"
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
          <!-- Your 4 picks + bounty slot (fills as you choose here) — matches grid width -->
          <WizardPicksStrip
            class="mx-auto w-full max-w-5xl"
            :picks="selectedContestants"
            :mvp-id="mvpId"
            :bounty="bountyContestant"
          >
            <span class="text-xs font-medium text-status-error">
              {{ bountyContestant ? bountyContestant.name.split(' ')[0] : '' }}
            </span>
          </WizardPicksStrip>

          <div class="mx-auto max-w-5xl">
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

          <!-- Roster + bounty, using the same layout as the live team page -->
          <TeamRosterList
            title="Your Roster"
            :players="reviewPlayers"
            :contestants="contestants"
            :eliminated-episode-id-by-contestant="{}"
            :episodes="[]"
            :points-by-id="{}"
            :show-scores="false"
            class="mb-6"
          >
            <template #footer>
              <div
                v-if="bountyContestant"
                class="flex items-center border-t border-border-subtle bg-surface-subtle/40 px-4 py-3"
              >
                <div class="flex items-center gap-3">
                  <span
                    class="w-11 shrink-0 rounded-md bg-status-error/15 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-status-error"
                    >BTY</span
                  >
                  <ContestantAvatar
                    :photo-url="bountyContestant.photo_url"
                    :name="bountyContestant.name"
                    :tribe="bountyContestant.tribe"
                    show-tribe
                  />
                  <div>
                    <p class="text-sm font-medium leading-tight text-text-default">
                      {{ bountyContestant.name }}
                    </p>
                    <p
                      class="mt-0.5 text-xs"
                      :style="{ color: getTribeColors(bountyContestant.tribe).text }"
                    >
                      {{ bountyContestant.tribe }}
                    </p>
                  </div>
                </div>
              </div>
            </template>
          </TeamRosterList>

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
