<script setup lang="ts">
// App shell for the player-facing pages. Holds the header + primary tab
// navigation and renders the active tab (Leaderboard / My Team) via RouterView.
import { ref, computed, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'
import { useSeasonStore } from '../stores/season'
import { useUiStore } from '../stores/ui'
import SeasonSelectModal from '../components/SeasonSelectModal.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const seasonStore = useSeasonStore()
const ui = useUiStore()
seasonStore.load()

// Track whether the user has a team for the selected season. Without one they
// get no tabs and no invite banner (league code) — only the season selector and
// their profile — and are funneled to the team-creation wizard.
async function loadMembership() {
  const uid = auth.user?.id
  const seasonId = seasonStore.selectedSeasonId
  if (!uid || !seasonId) {
    ui.hasTeam = null
    return
  }
  const { data } = await supabase
    .from('teams')
    .select('id')
    .eq('season_id', seasonId)
    .eq('user_id', uid)
    .maybeSingle()
  ui.hasTeam = !!data
}
watch(() => seasonStore.selectedSeasonId, loadMembership, { immediate: true })

// Whether the user has submitted a team for the *current* season (regardless of
// which season is being viewed). Gates the "complete your profile" banner so it
// only nags players who've actually joined this season.
const hasTeamCurrentSeason = ref(false)
async function loadCurrentSeasonMembership() {
  const uid = auth.user?.id
  const seasonId = seasonStore.currentSeasonId
  if (!uid || !seasonId) {
    hasTeamCurrentSeason.value = false
    return
  }
  const { data } = await supabase
    .from('teams')
    .select('id')
    .eq('season_id', seasonId)
    .eq('user_id', uid)
    .maybeSingle()
  hasTeamCurrentSeason.value = !!data
}
watch(
  [() => seasonStore.currentSeasonId, () => auth.user?.id],
  loadCurrentSeasonMembership,
  { immediate: true },
)

// Team-less players get no tabs, so keep them off the tabbed pages (Profile
// stays reachable via the avatar menu). Admins are exempt — they manage the
// league and may not have a team.
const showTabs = computed(() => ui.hasTeam !== false || auth.isAdmin)
watchEffect(() => {
  if (
    ui.hasTeam === false &&
    !auth.isAdmin &&
    route.path !== '/my-team' &&
    route.path !== '/profile'
  ) {
    router.replace('/my-team')
  }
})

const tabs = [
  { label: 'My Team', to: '/my-team' },
  { label: 'Leaderboard', to: '/leaderboard' },
  { label: 'Event Log', to: '/event-log' },
  // Dashboard hidden for now:
  // { label: 'Dashboard', to: '/dashboard' },
]

const activeTab = computed(() => tabs.find((t) => t.to === route.path) ?? tabs[0]!)
const menuOpen = ref(false)
const userMenuOpen = ref(false)
const seasonModalOpen = ref(false)

// True when the user is browsing a season other than the league's current one —
// drives the "return to current season" banner above the app.
const viewingPastSeason = computed(
  () =>
    !!seasonStore.currentSeasonId &&
    !!seasonStore.selectedSeasonId &&
    seasonStore.selectedSeasonId !== seasonStore.currentSeasonId,
)
const currentSeasonName = computed(
  () => seasonStore.seasons.find((s) => s.id === seasonStore.currentSeasonId)?.name ?? '',
)
// The season currently being viewed — drives the header logo + name.
const selectedSeason = computed(() =>
  seasonStore.seasons.find((s) => s.id === seasonStore.selectedSeasonId),
)
function returnToCurrentSeason() {
  seasonStore.selectedSeasonId = seasonStore.currentSeasonId
}

const ownerName = computed(() =>
  auth.firstName || auth.lastName
    ? `${auth.firstName} ${auth.lastName}`.trim()
    : (auth.user?.email ?? ''),
)

// Avatar initials: first + last initial, falling back to the email's first char.
const userInitials = computed(() => {
  const f = auth.firstName?.trim().charAt(0) ?? ''
  const l = auth.lastName?.trim().charAt(0) ?? ''
  return (f + l).toUpperCase() || (auth.user?.email?.charAt(0).toUpperCase() ?? '?')
})

function goTo(to: string) {
  menuOpen.value = false
  if (route.path !== to) router.push(to)
}

async function handleSignOut() {
  userMenuOpen.value = false
  await supabase.auth.signOut()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-surface-page flex flex-col">
    <!-- Past-season banner: shown while viewing a season other than the current -->
    <div
      v-if="viewingPastSeason"
      class="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-surface-strong px-6 py-2 text-center text-sm text-text-subtle"
    >
      <span>You're viewing a past season.</span>
      <button
        type="button"
        @click="returnToCurrentSeason"
        class="font-medium text-text-accent hover:text-interactive-accent-hover"
      >
        Back to {{ currentSeasonName || 'current season' }} →
      </button>
    </div>

    <!-- Incomplete-profile banner: shown until payment info is filled in, but
         only once the player has a team in the current season -->
    <RouterLink
      v-if="!auth.isProfileComplete && hasTeamCurrentSeason"
      to="/profile"
      class="block shrink-0 bg-status-warning-surface px-6 py-2 text-center text-sm font-medium text-status-warning hover:opacity-90"
    >
      Complete your profile to be eligible for prizes — add your payment info →
    </RouterLink>

    <header
      class="bg-surface-page border-b border-border-subtle px-4 sm:px-6 py-4 flex items-center justify-between shrink-0"
    >
      <div class="flex min-w-0 items-center gap-2.5">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full"
        >
          <img
            v-if="selectedSeason?.image_url"
            :src="selectedSeason.image_url"
            :alt="selectedSeason?.name ?? 'Season'"
            class="h-full w-full object-cover"
          />
        </span>
        <span class="truncate text-base font-semibold text-text-default">
          {{ selectedSeason?.name ?? 'The Ultimate Survivor Game' }}
        </span>
      </div>
      <div class="flex items-center gap-4 text-sm">
        <!-- Account avatar + menu -->
        <div class="relative">
          <button
            @click="userMenuOpen = !userMenuOpen"
            :aria-label="ownerName || 'Account'"
            class="flex items-center gap-2 rounded-full transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
          >
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-subtle text-sm font-semibold text-text-subtle"
            >
              <img
                v-if="auth.avatarUrl"
                :src="auth.avatarUrl"
                :alt="ownerName || 'Account'"
                class="h-full w-full object-cover object-top"
              />
              <template v-else>{{ userInitials }}</template>
            </span>
            <span
              v-if="ownerName"
              class="hidden max-w-[12rem] truncate pr-1 text-sm font-medium text-text-default sm:block"
            >
              {{ ownerName }}
            </span>
          </button>

          <div
            v-if="userMenuOpen"
            class="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-md border border-border-subtle bg-surface-overlay shadow-lg"
          >
            <div class="border-b border-border-subtle px-3 py-2.5">
              <p class="truncate text-sm font-medium text-text-default">
                {{ ownerName || 'Account' }}
              </p>
              <p v-if="auth.user?.email" class="truncate text-xs text-text-subtle">
                {{ auth.user.email }}
              </p>
            </div>
            <RouterLink
              v-if="auth.isAdmin"
              to="/admin"
              @click="userMenuOpen = false"
              class="block px-3 py-2.5 text-sm text-text-default hover:bg-surface-subtle"
            >
              Admin
            </RouterLink>
            <RouterLink
              to="/profile"
              @click="userMenuOpen = false"
              class="block px-3 py-2.5 text-sm text-text-default hover:bg-surface-subtle"
            >
              Profile
            </RouterLink>
            <button
              v-if="auth.isAdmin"
              @click="((userMenuOpen = false), (seasonModalOpen = true))"
              class="block w-full px-3 py-2.5 text-left text-sm text-text-default hover:bg-surface-subtle"
            >
              View Previous Seasons
            </button>
            <button
              @click="handleSignOut"
              class="block w-full px-3 py-2.5 text-left text-sm text-status-error hover:bg-surface-subtle"
            >
              Sign Out
            </button>
          </div>

          <!-- click-away -->
          <div v-if="userMenuOpen" class="fixed inset-0 z-20" @click="userMenuOpen = false"></div>
        </div>
      </div>
    </header>

    <!-- Primary tabs (desktop) — hidden until the user has a team this season -->
    <nav
      v-if="showTabs"
      class="hidden shrink-0 border-b border-border-subtle bg-surface-page px-6 sm:flex"
    >
      <RouterLink
        v-for="t in tabs"
        :key="t.to"
        :to="t.to"
        class="relative mr-4 py-3 text-sm font-semibold transition-colors"
        :class="
          route.path === t.to ? 'text-text-default' : 'text-text-subtle hover:text-text-default'
        "
      >
        {{ t.label }}
        <span
          v-if="route.path === t.to"
          class="absolute inset-x-0 -bottom-px h-0.5 bg-interactive-accent"
        ></span>
      </RouterLink>
    </nav>

    <!-- Primary tabs condensed into a secondary bar (mobile) -->
    <div
      v-if="showTabs && !route.meta.hideMobileTabs"
      class="relative shrink-0 sm:hidden"
    >
      <button
        @click="menuOpen = !menuOpen"
        class="flex min-h-12 w-full items-center gap-2.5 border-b border-border-subtle bg-surface-page px-4 py-2 text-left text-base font-medium text-text-default transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-accent"
      >
        <i class="fa-solid fa-bars shrink-0 text-lg text-icon-subtle"></i>
        <span class="flex-1 truncate font-semibold">{{ activeTab.label }}</span>
        <i
          class="fa-solid fa-chevron-down shrink-0 text-sm text-icon-default transition-transform"
          :class="menuOpen ? 'rotate-180' : ''"
        ></i>
      </button>

      <div
        v-if="menuOpen"
        class="absolute inset-x-0 top-full z-30 overflow-hidden border-b border-border-subtle bg-surface-overlay shadow-lg"
      >
        <button
          v-for="t in tabs"
          :key="t.to"
          @click="goTo(t.to)"
          class="block w-full px-4 py-2.5 text-left text-base hover:bg-surface-subtle"
          :class="route.path === t.to ? 'font-medium text-text-default' : 'text-text-subtle'"
        >
          {{ t.label }}
        </button>
      </div>
      <!-- click-away -->
      <div v-if="menuOpen" class="fixed inset-0 z-20" @click="menuOpen = false"></div>
    </div>

    <main class="flex flex-1 flex-col">
      <RouterView />
    </main>

    <!-- Season picker modal, launched from the profile menu -->
    <SeasonSelectModal :show="seasonModalOpen" @close="seasonModalOpen = false" />
  </div>
</template>
