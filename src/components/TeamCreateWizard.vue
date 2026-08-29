<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'
import type { ContestantFull } from '../types/contestant'
import { fullName, displayName, shortName } from '../utils/contestantName'
import ContestantCard from './ContestantCard.vue'
import ContestantDetailModal from './ContestantDetailModal.vue'
import ContestantAvatar from './ContestantAvatar.vue'
import TeamAvatar from './TeamAvatar.vue'
import TeamRosterList from './TeamRosterList.vue'
import WizardPicksStrip from './WizardPicksStrip.vue'
import BaseButton from './base/BaseButton.vue'
import BaseInput from './base/BaseInput.vue'
import ImageUploadField from './ImageUploadField.vue'
import EmojiColorPicker from './EmojiColorPicker.vue'
import ThemeAtmosphere from './decor/ThemeAtmosphere.vue'
import FireGlow from './FireGlow.vue'
import { uploadImage } from '../lib/uploadImage'
import { randomTeamAvatar } from '../utils/teamAvatar'
import survivorLogoUrl from '../assets/survivor_51_logo.png'

const props = defineProps<{
  seasonId: string
  seasonName: string
  contestants: ContestantFull[]
  userId: string
}>()

const emit = defineEmits<{ created: [] }>()

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

// Step indicator (visual only): the League Code step is excluded from the
// counter and the counter is hidden entirely while on it. Each entry keeps its
// real step number so completion/active state still tracks `step` (1–7).
const visibleSteps = computed(() =>
  STEP_LABELS.slice(1).map((label, i) => ({ label, step: i + 2 })),
)

const leagueCode = ref('')
// The league code is a 6-digit number: keep only digits (handles paste and a
// pre-filled code from the invite link) and cap the length.
watch(leagueCode, (v) => {
  const digits = v.replace(/\D/g, '').slice(0, 6)
  if (digits !== v) leagueCode.value = digits
})
const rulesAcknowledged = ref(false)
const teamName = ref('')
// Team avatar is optional: either an uploaded photo (uploaded on lock-in, since
// the team id doesn't exist until then) or an emoji-on-color tile.
const avatarMode = ref<'photo' | 'emoji'>('photo')
const teamImageFile = ref<File | null>(null)
const teamEmoji = ref<string | null>(null)
const teamColor = ref<string | null>(null)

// Live preview URL for an uploaded (not-yet-saved) team photo.
const teamImagePreviewUrl = ref<string | null>(null)
watch(teamImageFile, (file) => {
  if (teamImagePreviewUrl.value) URL.revokeObjectURL(teamImagePreviewUrl.value)
  teamImagePreviewUrl.value = file ? URL.createObjectURL(file) : null
})
onUnmounted(() => {
  if (teamImagePreviewUrl.value) URL.revokeObjectURL(teamImagePreviewUrl.value)
})

// Random emoji tile assigned when the player picks no photo/emoji. Generated
// once so the review step and the saved team show the same thing.
const fallbackAvatar = randomTeamAvatar()

// What the review step (and the saved team) will display.
const displayAvatar = computed<{
  imageUrl: string | null
  emoji: string | null
  color: string | null
}>(() => {
  if (avatarMode.value === 'photo' && teamImageFile.value) {
    return { imageUrl: teamImagePreviewUrl.value, emoji: null, color: null }
  }
  if (avatarMode.value === 'emoji' && teamEmoji.value) {
    return { imageUrl: null, emoji: teamEmoji.value, color: teamColor.value }
  }
  return { imageUrl: null, emoji: fallbackAvatar.emoji, color: fallbackAvatar.color }
})

const auth = useAuthStore()
const ownerName = computed(() => `${auth.firstName ?? ''} ${auth.lastName ?? ''}`.trim())
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
    if (leagueCode.value.length !== 6) {
      errorMsg.value = 'Enter the 6-digit league code'
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

  // Apply the optional team avatar now that we have the team id. Best-effort:
  // a failure here shouldn't block team creation (it can be set later).
  try {
    if (avatarMode.value === 'emoji' && teamEmoji.value) {
      await supabase
        .from('teams')
        .update({ team_emoji: teamEmoji.value, team_color: teamColor.value })
        .eq('id', team.id)
    } else if (avatarMode.value === 'photo' && teamImageFile.value) {
      const url = await uploadImage(teamImageFile.value, 'teams')
      await supabase.from('teams').update({ team_image_url: url }).eq('id', team.id)
    } else {
      // A team identity is required — save the random emoji tile shown on the
      // review step when the player picked no photo or emoji.
      await supabase
        .from('teams')
        .update({ team_emoji: fallbackAvatar.emoji, team_color: fallbackAvatar.color })
        .eq('id', team.id)
    }
  } catch {
    // Non-fatal: the team is created; the avatar can be added later from My Team.
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
    <!-- Ambient fire glow behind the wizard content (decorative, non-interactive). -->
    <FireGlow position="absolute" :z-index="0" />
    <div class="relative z-10 flex flex-1 flex-col px-4 sm:px-12 lg:px-20 pt-8 pb-16">
      <!-- Step indicator: equal-width columns, each with a number and its name
           centered below. A connector line links each number to the next. The
           League Code step is omitted here and the whole bar is hidden while on
           it — purely visual; the wizard still runs on steps 1–7. -->
      <div v-if="step > 1" class="mx-auto mb-6 flex w-full max-w-5xl">
        <div
          v-for="(s, i) in visibleSteps"
          :key="s.step"
          class="relative flex flex-1 flex-col items-center"
        >
          <!-- Connector to the next step, sitting behind the circles -->
          <div
            v-if="i < visibleSteps.length - 1"
            class="absolute left-1/2 top-4 h-0.5 w-full -translate-y-1/2 transition-colors duration-300"
            :class="step > s.step ? 'bg-interactive-accent' : 'bg-surface-strong'"
          />
          <div
            class="relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300"
            :class="[
              step > s.step
                ? 'bg-interactive-accent text-text-on-accent'
                : step === s.step
                  ? 'bg-interactive-accent text-text-on-accent ring-4 ring-interactive-accent/20'
                  : 'bg-surface-subtle text-text-muted border border-border-subtle',
            ]"
          >
            <span v-if="step > s.step">✓</span>
            <span v-else>{{ i + 1 }}</span>
          </div>
          <p
            class="mt-2 hidden text-center text-xs leading-tight transition-colors duration-200 sm:block"
            :class="[
              step === s.step
                ? 'font-semibold text-text-default'
                : step > s.step
                  ? 'text-text-subtle'
                  : 'text-text-muted',
            ]"
          >
            {{ s.label }}
          </p>
        </div>
      </div>

      <!-- Back to the previous step (mobile only). On mobile the footer holds just
           the full-width primary CTA; on desktop Back lives in the footer instead. -->
      <div v-if="step > 1" class="mx-auto mb-2 w-full max-w-5xl sm:hidden">
        <button
          type="button"
          class="inline-flex items-center gap-1 text-sm font-medium text-text-subtle transition-colors hover:text-text-default"
          @click="step--"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </div>

      <!-- ── Step 1: League Code ── -->
      <template v-if="step === 1">
        <div class="mx-auto w-full max-w-2xl">
          <div
            class="flex flex-col items-center rounded-lg border border-border-subtle bg-surface-default p-6 text-center sm:p-8"
          >
            <img
              :src="survivorLogoUrl"
              alt="Survivor 51"
              class="pointer-events-none mb-4 h-20 w-auto select-none sm:h-24"
            />
            <h2 class="text-2xl font-bold text-text-default mb-1">Enter League Code</h2>
            <p class="text-text-subtle text-base mb-4">
              Ask your league admin for the code to join {{ seasonName }}.
            </p>
            <BaseInput
              v-model="leagueCode"
              size="lg"
              class="w-full max-w-md"
              placeholder="6-digit code"
              inputmode="numeric"
              :maxlength="6"
              :error="errorMsg"
              @keyup.enter="nextStep"
            />
            <BaseButton
              size="lg"
              class="mt-4 w-full sm:w-auto"
              :loading="loading"
              :disabled="leagueCode.length !== 6"
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
                Placeholder rules text. Scoring is based on in-game actions, weekly bounty picks,
                and swap penalties. More detail coming soon.
              </p>
              <p>
                Placeholder rules text. Rosters lock at the start of each episode — make your
                changes before the deadline.
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

            <div class="mt-6 flex justify-end gap-3">
              <BaseButton
                variant="secondary"
                size="lg"
                class="hidden! sm:inline-flex!"
                @click="step--"
                >Back</BaseButton
              >
              <BaseButton
                size="lg"
                class="w-full sm:w-auto"
                :disabled="!rulesAcknowledged"
                @click="nextStep"
              >
                Continue
              </BaseButton>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Step 3: Team Name ── -->
      <template v-else-if="step === 3">
        <div class="mx-auto w-full max-w-5xl">
          <div class="mb-6 rounded-lg border border-border-subtle bg-surface-default p-6 sm:p-8">
            <h2 class="text-2xl font-bold text-text-default mb-1">Give Your Team an Identity</h2>
            <p class="text-text-subtle text-base mb-6">
              This is how you'll appear on the leaderboard.
            </p>
            <label class="mb-2 block text-sm font-medium text-text-default">Team Name</label>
            <BaseInput
              v-model="teamName"
              size="lg"
              class="max-w-md"
              placeholder="e.g. The Fire Starters"
              :maxlength="32"
              :error="errorMsg"
              @keyup.enter="nextStep"
            />

            <div class="mt-6">
              <label class="mb-2 block text-sm font-medium text-text-default">Team Avatar</label>
              <div class="mb-4 flex rounded-md border border-border-subtle p-1">
                <button
                  type="button"
                  class="flex-1 rounded px-3 py-1 text-sm font-medium transition-colors"
                  :class="
                    avatarMode === 'photo'
                      ? 'bg-surface-subtle text-text-default'
                      : 'text-text-subtle hover:text-text-default'
                  "
                  @click="avatarMode = 'photo'"
                >
                  Photo
                </button>
                <button
                  type="button"
                  class="flex-1 rounded px-3 py-1 text-sm font-medium transition-colors"
                  :class="
                    avatarMode === 'emoji'
                      ? 'bg-surface-subtle text-text-default'
                      : 'text-text-subtle hover:text-text-default'
                  "
                  @click="avatarMode = 'emoji'"
                >
                  Emoji
                </button>
              </div>

              <ImageUploadField
                v-if="avatarMode === 'photo'"
                :model-value="null"
                shape="square"
                :size="120"
                @select="teamImageFile = $event"
                @remove="teamImageFile = null"
              />
              <EmojiColorPicker v-else v-model:emoji="teamEmoji" v-model:color="teamColor" />
            </div>
          </div>
        </div>

        <!-- Sticky footer: actions only — the pick strip isn't relevant on this step -->
        <div
          class="sticky bottom-0 z-30 -mx-4 -mb-16 mt-auto border-t border-border-subtle bg-surface-page/95 px-4 py-3 backdrop-blur sm:-mx-12 sm:px-12 lg:-mx-20 lg:px-20"
        >
          <div class="mx-auto flex w-full max-w-5xl justify-end gap-3">
            <BaseButton
              variant="secondary"
              size="lg"
              class="hidden! sm:inline-flex!"
              @click="step--"
              >Back</BaseButton
            >
            <BaseButton
              size="lg"
              class="w-full sm:w-auto"
              :disabled="!teamName.trim()"
              @click="nextStep"
            >
              Continue
            </BaseButton>
          </div>
        </div>
      </template>

      <!-- ── Step 4: Pick 4 Players ── -->
      <template v-else-if="step === 4">
        <div class="mx-auto mb-6 w-full max-w-5xl">
          <h2 class="text-2xl font-bold text-text-default mb-0.5">Pick Your Players</h2>
          <p class="text-text-subtle text-base">Choose 4 castaways for your team.</p>
        </div>

        <!-- Reflowing grid, alphabetical. Tribe is shown on each card, so no grouping.
             At least 2 columns on phones (150px min); on larger screens the min jumps
             to 240px for bigger cards. Capped by max-width so it doesn't sprawl. -->
        <div
          class="mx-auto mb-8 grid w-full max-w-5xl grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] sm:gap-4"
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
                class="hidden! sm:inline-flex!"
                @click="step--"
                >Back</BaseButton
              >
              <BaseButton
                size="lg"
                class="w-full sm:w-auto"
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
          <p class="text-text-subtle text-base">Your MVP earns 1.5× points each episode.</p>
        </div>

        <div
          class="mx-auto mb-8 grid w-full max-w-5xl grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] sm:gap-4"
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
                class="hidden! sm:inline-flex!"
                @click="step--"
                >Back</BaseButton
              >
              <BaseButton size="lg" class="w-full sm:w-auto" :disabled="!mvpId" @click="nextStep">
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
          class="mx-auto mb-8 grid w-full max-w-5xl grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] sm:gap-4"
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
                class="hidden! sm:inline-flex!"
                @click="step--"
                >Back</BaseButton
              >
              <BaseButton
                size="lg"
                class="w-full sm:w-auto"
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
        <div class="mx-auto w-full max-w-5xl">
          <h2 class="text-2xl font-bold text-text-default mb-1">Review Your Team</h2>
          <p class="text-text-subtle text-base mb-6">
            You will still be able to make changes to your team after submission.
          </p>

          <!-- Team identity: avatar + team name + owner -->
          <div
            class="surface-card bg-surface-subtle rounded-md border border-border-subtle px-4 py-3 mb-4 flex items-center gap-3"
          >
            <TeamAvatar
              :image-url="displayAvatar.imageUrl"
              :emoji="displayAvatar.emoji"
              :color="displayAvatar.color"
              :name="teamName || 'Team'"
              :size="48"
              class="rounded-lg border border-border-default"
            />
            <div class="min-w-0 flex-1">
              <p class="font-bold text-text-default truncate">{{ teamName }}</p>
              <p v-if="ownerName" class="text-sm text-text-subtle truncate">{{ ownerName }}</p>
            </div>
            <BaseButton variant="secondary" size="sm" class="shrink-0" @click="step = 3"
              >Edit</BaseButton
            >
          </div>

          <!-- Roster, using the same layout as the live team page -->
          <TeamRosterList
            title="Your Roster"
            :players="reviewPlayers"
            :contestants="contestants"
            :eliminated-episode-id-by-contestant="{}"
            :episodes="[]"
            :points-by-id="{}"
            :show-scores="false"
            expand-names
            show-occupation
            class="mb-4"
          >
            <template #row-action="{ player }">
              <BaseButton
                variant="secondary"
                size="sm"
                class="shrink-0"
                @click="step = player.role === 'mvp' ? 5 : 4"
                >Edit</BaseButton
              >
            </template>
          </TeamRosterList>

          <!-- Bounty pick in its own card, mirroring the roster card style -->
          <div
            class="mb-6 overflow-hidden rounded-lg border border-border-subtle bg-surface-default"
          >
            <div
              class="flex items-center gap-3 border-b border-border-subtle bg-surface-subtle px-4 py-3"
            >
              <h3 class="text-sm font-semibold text-text-default">Bounty Pick</h3>
            </div>
            <div v-if="bountyContestant" class="flex items-center justify-between px-4 py-3">
              <div class="flex items-center gap-3">
                <span
                  class="w-11 shrink-0 rounded-md bg-surface-subtle py-1 text-center text-[10px] font-bold uppercase tracking-wide text-text-default"
                  >E1</span
                >
                <ContestantAvatar
                  :photo-url="bountyContestant.photo_url"
                  :name="displayName(bountyContestant)"
                  :tribe="bountyContestant.tribe"
                  border-color-override="var(--color-survivor-bounty)"
                />
                <div>
                  <p class="text-sm font-semibold leading-tight">
                    <span class="text-text-default">{{ shortName(bountyContestant) }}</span>
                    <span v-if="bountyContestant.last_name" class="ml-1 text-text-default">{{
                      bountyContestant.last_name
                    }}</span>
                  </p>
                  <p class="mt-0.5 text-xs text-text-subtle">
                    {{ bountyContestant.tribe }}
                  </p>
                </div>
              </div>
              <BaseButton variant="secondary" size="sm" class="shrink-0" @click="step = 6"
                >Edit</BaseButton
              >
            </div>
            <div v-else class="px-4 py-3 text-xs text-text-subtle">No bounty pick set.</div>
          </div>
        </div>

        <!-- Sticky footer: Submit, hugging its contents and right-aligned like the
             other steps' actions -->
        <div
          class="sticky bottom-0 z-30 -mx-4 -mb-16 mt-auto border-t border-border-subtle bg-surface-page/95 px-4 py-3 backdrop-blur sm:-mx-12 sm:px-12 lg:-mx-20 lg:px-20"
        >
          <div class="mx-auto w-full max-w-5xl">
            <p v-if="errorMsg" class="text-sm text-status-error mb-2">{{ errorMsg }}</p>
            <div class="flex">
              <BaseButton
                size="lg"
                class="w-full sm:ml-auto sm:w-auto"
                :loading="loading"
                @click="lockIn"
              >
                {{ loading ? 'Submitting…' : 'Submit' }}
              </BaseButton>
            </div>
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
