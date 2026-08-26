<script setup lang="ts">
// App shell for the player-facing pages. Holds the header + primary tab
// navigation and renders the active tab (Leaderboard / My Team) via RouterView.
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const tabs = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Leaderboard', to: '/leaderboard' },
  { label: 'Event Log', to: '/event-log' },
  { label: 'My Team', to: '/my-team' },
]

const activeTab = computed(() => tabs.find((t) => t.to === route.path) ?? tabs[0]!)
const menuOpen = ref(false)

const ownerName = computed(() =>
  auth.firstName || auth.lastName
    ? `${auth.firstName} ${auth.lastName}`.trim()
    : (auth.user?.email ?? ''),
)

function goTo(to: string) {
  menuOpen.value = false
  if (route.path !== to) router.push(to)
}

async function handleSignOut() {
  await supabase.auth.signOut()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-surface-page flex flex-col">
    <!-- Incomplete-profile banner: shown until payment info is filled in -->
    <RouterLink
      v-if="!auth.isProfileComplete"
      to="/profile"
      class="block shrink-0 bg-status-warning-surface px-6 py-2 text-center text-sm font-medium text-status-warning hover:opacity-90"
    >
      Complete your profile to be eligible for prizes — add your payment info →
    </RouterLink>

    <header
      class="bg-surface-default border-b border-border-subtle px-6 py-4 flex items-center justify-between shrink-0"
    >
      <h1 class="text-xl font-bold text-text-default">The Ultimate Survivor Game</h1>
      <div class="flex items-center gap-4 text-sm">
        <RouterLink
          v-if="auth.isAdmin"
          to="/admin"
          class="text-text-accent hover:text-interactive-accent-hover"
          >Admin</RouterLink
        >
        <RouterLink to="/profile" class="text-text-accent hover:text-interactive-accent-hover">
          {{ ownerName || 'Profile' }}
        </RouterLink>
        <button @click="handleSignOut" class="text-status-error hover:opacity-80">Sign out</button>
      </div>
    </header>

    <!-- Primary tabs (desktop) -->
    <nav class="hidden shrink-0 border-b border-border-subtle bg-surface-default px-6 sm:flex">
      <RouterLink
        v-for="t in tabs"
        :key="t.to"
        :to="t.to"
        class="relative px-4 py-3 text-sm font-medium transition-colors"
        :class="
          route.path === t.to ? 'text-text-accent' : 'text-text-muted hover:text-text-default'
        "
      >
        {{ t.label }}
        <span
          v-if="route.path === t.to"
          class="absolute inset-x-0 -bottom-px h-0.5 bg-interactive-accent"
        ></span>
      </RouterLink>
    </nav>

    <!-- Primary tabs condensed into a dropdown (mobile) -->
    <div
      class="relative shrink-0 border-b border-border-subtle bg-surface-default px-4 py-2 sm:hidden"
    >
      <button
        @click="menuOpen = !menuOpen"
        class="flex w-full items-center justify-between rounded-md border border-interactive-input-border bg-interactive-input px-3 py-2 text-sm font-medium text-text-default"
      >
        {{ activeTab.label }}
        <svg
          class="h-4 w-4 text-icon-subtle transition-transform"
          :class="menuOpen ? 'rotate-180' : ''"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div
        v-if="menuOpen"
        class="absolute inset-x-4 z-30 mt-1 overflow-hidden rounded-md border border-border-subtle bg-surface-overlay shadow-lg"
      >
        <button
          v-for="t in tabs"
          :key="t.to"
          @click="goTo(t.to)"
          class="block w-full px-3 py-2.5 text-left text-sm hover:bg-surface-subtle"
          :class="route.path === t.to ? 'font-medium text-text-accent' : 'text-text-default'"
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
  </div>
</template>
