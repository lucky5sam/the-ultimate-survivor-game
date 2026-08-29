<script setup lang="ts">
// League-wide invite banner shown at the top of every page until the current
// season starts. Self-contained: loads the league's current season, ticks a
// live countdown, and fetches the invite/league code. Renders nothing once the
// season has started (or if there's no upcoming season).
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { supabase } from '../lib/supabase'
import { fmtEt } from '../lib/time'
import { useToast } from '../composables/useToast'
import { useUiStore } from '../stores/ui'
import BaseButton from './base/BaseButton.vue'
import FireGlow from './FireGlow.vue'
import survivorLogoUrl from '../assets/survivor_51_logo.png'

type Season = { id: string; name: string; status: string; starts_at: string | null }

const toast = useToast()
const ui = useUiStore()

const season = ref<Season | null>(null)
const leagueCode = ref('')

// A ticking clock so the countdown and the open/closed state update live.
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | undefined

// Registration (and this banner) stay open until the season starts: no start
// time keeps it open; a completed season is always closed.
const inviteOpen = computed(() => {
  const s = season.value
  if (!s || s.status === 'completed') return false
  return !s.starts_at || now.value < new Date(s.starts_at).getTime()
})

const startDisplay = computed(() =>
  season.value?.starts_at ? fmtEt(season.value.starts_at) : null,
)

const countdown = computed(() => {
  const iso = season.value?.starts_at
  if (!iso) return null
  const diff = new Date(iso).getTime() - now.value
  if (diff <= 0) return null
  const totalSec = Math.floor(diff / 1000)
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
  }
})

async function loadSeason() {
  const { data } = await supabase
    .from('seasons')
    .select('id, name, status, starts_at')
    .order('created_at', { ascending: false })
  const list = (data ?? []) as Season[]
  // "Current" = the most recent active/upcoming season, else the newest overall.
  season.value =
    list.find((s) => s.status === 'active' || s.status === 'upcoming') ?? list[0] ?? null
}

async function loadLeagueCode() {
  try {
    const { data: code } = await supabase.rpc('get_registration_code')
    leagueCode.value = code ?? ''
  } catch {
    leagueCode.value = ''
  }
}

async function copyInviteLink() {
  try {
    const code = leagueCode.value || (await supabase.rpc('get_registration_code')).data
    if (!code) return
    await navigator.clipboard.writeText(`${window.location.origin}/login?mode=signup&code=${code}`)
    toast.success('Invite link copied to clipboard')
  } catch {
    toast.error('Could not copy the invite link')
  }
}

async function copyLeagueCode() {
  try {
    const code = leagueCode.value || (await supabase.rpc('get_registration_code')).data
    if (!code) return
    await navigator.clipboard.writeText(code)
    toast.success('League code copied to clipboard')
  } catch {
    toast.error('Could not copy the league code')
  }
}

onMounted(() => {
  nowTimer = setInterval(() => {
    now.value = Date.now()
  }, 1_000)
  loadSeason()
  loadLeagueCode()
})

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
})
</script>

<template>
  <div
    v-if="inviteOpen && !ui.wizardActive && ui.hasTeam === true"
    class="mx-auto w-full max-w-5xl pt-6"
  >
    <div
      class="relative flex flex-col-reverse items-start gap-6 overflow-hidden rounded-lg border border-border-subtle bg-surface-default p-6 sm:flex-row sm:justify-between"
    >
      <!-- Ambient fire glow flush to the bottom edge (decorative, non-interactive). -->
      <FireGlow position="absolute" :z-index="20" :height="90" :ember-count="8" />

      <!-- Left content -->
      <div class="relative z-10 min-w-0 flex-1">
        <h3 class="text-xl font-bold text-text-default">
          Invite your friends to play The Ultimate Survivor Game
        </h3>
        <p class="mt-1 text-base text-text-subtle">
          <template v-if="startDisplay">{{ season?.name }} starts on {{ startDisplay }}</template>
          <template v-else>Registration is open</template>
        </p>

        <!-- Countdown -->
        <div v-if="countdown" class="mt-4 flex items-center gap-2">
          <div
            v-for="seg in [
              { v: countdown.days, l: 'days' },
              { v: countdown.hours, l: 'hours' },
              { v: countdown.minutes, l: 'mins' },
              { v: countdown.seconds, l: 'secs' },
            ]"
            :key="seg.l"
            class="flex w-14 flex-col items-center rounded-md bg-surface-subtle py-2 shadow-sm"
          >
            <span class="text-xl font-bold tabular-nums leading-none text-text-default">
              {{ seg.l === 'days' ? seg.v : String(seg.v).padStart(2, '0') }}
            </span>
            <span class="mt-1 text-[10px] uppercase tracking-wide text-text-subtle">{{
              seg.l
            }}</span>
          </div>
        </div>

        <!-- League code + copy -->
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <BaseButton variant="primary" @click="copyInviteLink">
            <svg
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            Invite Link
          </BaseButton>
          <button
            v-if="leagueCode"
            type="button"
            @click="copyLeagueCode"
            class="rounded-md bg-surface-subtle px-3 py-2 text-left shadow-sm transition-colors hover:bg-surface-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
          >
            <span class="flex items-center gap-2">
              <span class="text-sm tracking-wide text-text-subtle">League Code:</span>
              <span class="text-sm font-bold text-text-default">{{ leagueCode }}</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Season logo — right side on desktop, above the content on mobile -->
      <img
        :src="survivorLogoUrl"
        alt="Survivor 51"
        class="pointer-events-none relative z-10 h-16 w-auto shrink-0 select-none sm:h-40"
      />
    </div>
  </div>
</template>
