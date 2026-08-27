<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import type { ContestantFull } from '../types/contestant'
import { getTribeColors } from '../utils/tribeColors'
import { fullName, displayName } from '../utils/contestantName'
import ContestantCard from './ContestantCard.vue'
import ContestantDetailModal from './ContestantDetailModal.vue'
import ContestantAvatar from './ContestantAvatar.vue'
import TeamRosterList from './TeamRosterList.vue'
import WizardPicksStrip from './WizardPicksStrip.vue'
import BaseButton from './base/BaseButton.vue'
import BaseInput from './base/BaseInput.vue'
import ThemeAtmosphere from './decor/ThemeAtmosphere.vue'
import survivorLogoUrl from '../assets/survivor_51_logo.png'

const props = defineProps<{
  seasonId: string
  seasonName: string
  contestants: ContestantFull[]
  userId: string
}>()

const emit = defineEmits<{ created: [] }>()

const TOTAL_STEPS = 7
const STEP_LABELS = [
  'League Code',
  'League Rules',
  'Team Name',
  'Pick Players',
  'Declare MVP',
  'Bounty Pick',
  'Review',
]

const step = ref(1)
const leagueCode = ref('')
const rulesAcknowledged = ref(false)
const teamName = ref('')
const selectedIds = ref<string[]>([])
const mvpId = ref<string | null>(null)
const bountyId = ref<string | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const detailContestant = ref<ContestantFull | null>(null)

const sortedContestants = computed(() =>
  [...props.contestants].sort((a, b) => fullName(a).localeCompare(fullName(b))),
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

// Each step is a section of the same scrolling page, so moving between them keeps
// the old scroll position. Reset to the top on every step change.
watch(step, () => {
  window.scrollTo(0, 0)
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

  if (step.value === 2 && !rulesAcknowledged.value) return
  if (step.value === 3 && !teamName.value.trim()) {
    errorMsg.value = 'Enter a team name'
    return
  }
  if (step.value === 4 && selectedIds.value.length < 4) return
  if (step.value === 5 && !mvpId.value) {
    errorMsg.value = 'Choose your MVP'
    return
  }
  if (step.value === 6 && !bountyId.value) {
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
  <div class="relative flex flex-1 flex-col overflow-x-clip bg-surface-page">
    <ThemeAtmosphere />
    <div class="relative z-10 flex flex-1 flex-col px-4 sm:px-12 lg:px-20 pt-8 pb-16">
      <!-- Step indicator: equal-width columns, each with a number and its name
           centered below. A connector line links each number to the next. -->
      <div class="mx-auto mb-10 flex w-full max-w-5xl">
        <div
          v-for="(label, i) in STEP_LABELS"
          :key="i"
          class="relative flex flex-1 flex-col items-center"
        >
          <!-- Connector to the next step, sitting behind the circles -->
          <div
            v-if="i < TOTAL_STEPS - 1"
            class="absolute left-1/2 top-4 h-0.5 w-full -translate-y-1/2 transition-colors duration-300"
            :class="step > i + 1 ? 'bg-interactive-accent' : 'bg-surface-strong'"
          />
          <div
            class="relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300"
            :class="[
              step > i + 1
                ? 'bg-interactive-accent text-text-on-accent'
                : step === i + 1
                  ? 'bg-interactive-accent text-text-on-accent ring-4 ring-interactive-accent/20'
                  : 'bg-surface-subtle text-text-muted border border-border-subtle',
            ]"
          >
            <span v-if="step > i + 1">✓</span>
            <span v-else>{{ i + 1 }}</span>
          </div>
          <p
            class="mt-2 hidden text-center text-xs leading-tight transition-colors duration-200 sm:block"
            :class="[
              step === i + 1
                ? 'font-semibold text-text-accent'
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
        <div class="mx-auto w-full max-w-5xl">
          <div class="rounded-lg border border-border-subtle bg-surface-default p-6 sm:p-8">
            <img
              :src="survivorLogoUrl"
              alt="Survivor 51"
              class="pointer-events-none mb-4 h-20 w-auto select-none sm:h-24"
            />
            <h2 class="text-2xl font-bold text-text-default mb-1">Enter League Code</h2>
            <p class="text-text-subtle text-base mb-6">
              Ask your league admin for the code to join {{ seasonName }}.
            </p>
            <BaseInput
              v-model="leagueCode"
              size="lg"
              class="max-w-md"
              placeholder="Enter code…"
              :error="errorMsg"
              @keyup.enter="nextStep"
            />
            <BaseButton
              size="lg"
              class="mt-4"
              :loading="loading"
              :disabled="!leagueCode.trim()"
              @click="nextStep"
            >
              Get Started
            </BaseButton>
          </div>
        </div>
      </template>

      <!-- ── Step 2: League Rules ── -->
      <template v-else-if="step === 2">
        <div class="mx-auto w-full max-w-5xl">
          <div class="rounded-lg border border-border-subtle bg-surface-default p-6 sm:p-8">
            <h2 class="text-2xl font-bold text-text-default mb-1">League Rules</h2>
            <p class="text-text-subtle text-base mb-6">
              Please read the rules below before building your tribe.
            </p>

            <div class="space-y-4 text-sm leading-relaxed text-text-subtle">
              <p>
                Placeholder rules text. Draft a team of four Survivor contestants and designate one
                as your MVP for bonus points. Full rules will be added here.
              </p>
              <p>
                Placeholder rules text. Scoring is based on in-game actions, weekly bounty picks, and
                swap penalties. More detail coming soon.
              </p>
              <p>
                Placeholder rules text. Rosters lock at the start of each episode — make your changes
                before the deadline.
              </p>
            </div>

            <label
              class="mt-6 flex cursor-pointer items-start gap-3 rounded-md border border-border-subtle bg-surface-subtle p-4"
            >
              <input
                v-model="rulesAcknowledged"
                type="checkbox"
                class="mt-0.5 h-5 w-5 shrink-0 rounded border-border-default text-interactive-accent focus:ring-interactive-accent"
              />
              <span class="text-sm font-medium text-text-default">
                I have read and agree to the league rules.
              </span>
            </label>

            <div class="mt-6 flex gap-3">
              <BaseButton variant="secondary" size="lg" @click="step--">Back</BaseButton>
              <BaseButton size="lg" :disabled="!rulesAcknowledged" @click="nextStep">
                Continue
              </BaseButton>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Step 3: Team Name ── -->
      <template v-else-if="step === 3">
        <div class="mx-auto w-full max-w-5xl">
          <div class="rounded-lg border border-border-subtle bg-surface-default p-6 sm:p-8">
            <h2 class="text-2xl font-bold text-text-default mb-1">Name Your Team</h2>
            <p class="text-text-subtle text-base mb-6">
              This is how you'll appear on the leaderboard.
            </p>
            <BaseInput
              v-model="teamName"
              size="lg"
              class="max-w-md"
              placeholder="e.g. The Fire Starters"
              :error="errorMsg"
              @keyup.enter="nextStep"
            />
          </div>
        </div>

        <!-- Sticky footer: pick strip (empty here) with team name + actions -->
        <div
          class="sticky bottom-0 z-30 -mx-4 -mb-16 mt-auto border-t border-border-subtle bg-surface-page/95 px-4 py-3 backdrop-blur sm:-mx-12 sm:px-12 lg:-mx-20 lg:px-20"
        >
          <WizardPicksStrip
            class="mx-auto w-full max-w-5xl"
            :picks="selectedContestants"
            :mvp-id="mvpId"
            :bounty="bountyContestant"
            :team-name="teamName"
          >
            <div class="flex w-full gap-3 sm:w-auto">
              <BaseButton
                variant="secondary"
                size="lg"
                class="flex-1 sm:flex-none"
                @click="step--"
                >Back</BaseButton
              >
              <BaseButton
                size="lg"
                class="flex-1 sm:flex-none"
                :disabled="!teamName.trim()"
                @click="nextStep"
              >
                Continue
              </BaseButton>
            </div>
          </WizardPicksStrip>
        </div>
      </template>

      <!-- ── Step 4: Pick 4 Players ── -->
      <template v-else-if="step === 4">
        <div class="mx-auto mb-6 w-full max-w-5xl">
          <h2 class="text-2xl font-bold text-text-default mb-0.5">Pick Your Survivors</h2>
          <p class="text-text-subtle text-base">Choose 4 castaways for your tribe.</p>
        </div>

        <!-- Reflowing grid, alphabetical. Tribe is shown on each card, so no grouping.
             At least 2 columns on phones (120px min); on larger screens the min jumps
             to 240px for bigger cards. Capped by max-width so it doesn't sprawl. -->
        <div
          class="mx-auto mb-8 grid w-full max-w-5xl grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] sm:gap-4"
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
          class="sticky bottom-0 z-30 -mx-4 -mb-16 mt-auto border-t border-border-subtle bg-surface-page/95 px-4 py-3 backdrop-blur sm:-mx-12 sm:px-12 lg:-mx-20 lg:px-20"
        >
          <!-- Your 4 picks + bounty slot, with actions on the right -->
          <WizardPicksStrip
            class="mx-auto w-full max-w-5xl"
            :picks="selectedContestants"
            :mvp-id="mvpId"
            :bounty="bountyContestant"
            :team-name="teamName"
          >
            <div class="flex w-full gap-3 sm:w-auto">
              <BaseButton
                variant="secondary"
                size="lg"
                class="flex-1 sm:flex-none"
                @click="step--"
                >Back</BaseButton
              >
              <BaseButton
                size="lg"
                class="flex-1 sm:flex-none"
                :disabled="selectedIds.length < 4"
                @click="nextStep"
              >
                {{ selectedIds.length < 4 ? `Pick ${4 - selectedIds.length} more` : 'Continue' }}
              </BaseButton>
            </div>
          </WizardPicksStrip>
        </div>
      </template>

      <!-- ── Step 5: Declare MVP ── -->
      <template v-else-if="step === 5">
        <div class="mx-auto mb-8 w-full max-w-5xl">
          <h2 class="text-2xl font-bold text-text-default mb-1">Crown Your MVP</h2>
          <p class="text-text-subtle text-base">
            Your MVP earns 1.5× points each episode. Choose wisely.
          </p>
        </div>

        <div
          class="mx-auto mb-8 grid w-full max-w-5xl grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] sm:gap-4"
        >
          <ContestantCard
            v-for="c in selectedContestants"
            :key="c.id"
            :contestant="c"
            :selected="c.id === mvpId"
            :disabled="false"
            :dimmed="!!mvpId && c.id !== mvpId"
            :show-crown="true"
            @select="mvpId = mvpId === c.id ? null : c.id"
            @view-details="detailContestant = c"
          />
        </div>

        <!-- Sticky bar: your picks (MVP marked) + actions, mirroring the roster step -->
        <div
          class="sticky bottom-0 z-30 -mx-4 -mb-16 mt-auto border-t border-border-subtle bg-surface-page/95 px-4 py-3 backdrop-blur sm:-mx-12 sm:px-12 lg:-mx-20 lg:px-20"
        >
          <!-- Your 4 picks (MVP highlighted) + bounty slot, with actions on the right -->
          <WizardPicksStrip
            class="mx-auto w-full max-w-5xl"
            :picks="selectedContestants"
            :mvp-id="mvpId"
            :bounty="bountyContestant"
            :team-name="teamName"
          >
            <div class="flex w-full gap-3 sm:w-auto">
              <BaseButton
                variant="secondary"
                size="lg"
                class="flex-1 sm:flex-none"
                @click="step--"
                >Back</BaseButton
              >
              <BaseButton size="lg" class="flex-1 sm:flex-none" :disabled="!mvpId" @click="nextStep">
                {{ mvpId ? 'Continue' : 'Choose MVP' }}
              </BaseButton>
            </div>
          </WizardPicksStrip>
          <p v-if="errorMsg" class="mx-auto max-w-5xl text-sm text-status-error">{{ errorMsg }}</p>
        </div>
      </template>

      <!-- ── Step 6: Bounty Pick ── -->
      <template v-else-if="step === 6">
        <div class="mx-auto mb-6 w-full max-w-5xl">
          <h2 class="text-2xl font-bold text-text-default mb-0.5">Place Your Bounty</h2>
          <p class="text-text-subtle text-base">
            Select the castaway that you believe will be voted off on the first episode.
          </p>
        </div>

        <!-- Same reflowing grid as Pick Players, but a single target selection -->
        <div
          class="mx-auto mb-8 grid w-full max-w-5xl grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] sm:gap-4"
        >
          <ContestantCard
            v-for="c in sortedContestants"
            :key="c.id"
            :contestant="c"
            :selected="c.id === bountyId"
            :disabled="false"
            :dimmed="!!bountyId && c.id !== bountyId"
            :bounty="true"
            @select="bountyId = bountyId === c.id ? null : c.id"
            @view-details="detailContestant = c"
          />
        </div>

        <!-- Sticky action bar -->
        <div
          class="sticky bottom-0 z-30 -mx-4 -mb-16 mt-auto border-t border-border-subtle bg-surface-page/95 px-4 py-3 backdrop-blur sm:-mx-12 sm:px-12 lg:-mx-20 lg:px-20"
        >
          <!-- Your 4 picks + bounty slot (fills as you choose here), actions on the right -->
          <WizardPicksStrip
            class="mx-auto w-full max-w-5xl"
            :picks="selectedContestants"
            :mvp-id="mvpId"
            :bounty="bountyContestant"
            :team-name="teamName"
          >
            <div class="flex w-full gap-3 sm:w-auto">
              <BaseButton
                variant="secondary"
                size="lg"
                class="flex-1 sm:flex-none"
                @click="step--"
                >Back</BaseButton
              >
              <BaseButton
                size="lg"
                class="flex-1 sm:flex-none"
                :disabled="!bountyId"
                @click="nextStep"
              >
                {{ bountyId ? 'Continue' : 'Pick a target' }}
              </BaseButton>
            </div>
          </WizardPicksStrip>
          <p v-if="errorMsg" class="mx-auto max-w-5xl text-sm text-status-error">{{ errorMsg }}</p>
        </div>
      </template>

      <!-- ── Step 7: Review ── -->
      <template v-else-if="step === 7">
        <div class="mx-auto w-full max-w-md">
          <h2 class="text-2xl font-bold text-text-default mb-1">Review Your Tribe</h2>
          <p class="text-text-subtle text-base mb-6">
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
                    :name="displayName(bountyContestant)"
                    :tribe="bountyContestant.tribe"
                    show-tribe
                  />
                  <div>
                    <p class="text-sm font-medium leading-tight text-text-default">
                      {{ displayName(bountyContestant) }}
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
