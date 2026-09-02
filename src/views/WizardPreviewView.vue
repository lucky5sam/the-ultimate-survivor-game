<script setup lang="ts">
// Admin-only, read-only preview of the player team-creation wizard. Admins who
// already have a team can't otherwise reach the wizard, so this lets them walk
// the exact flow players see (rules, scoring, pick/MVP/bounty). Nothing saves.
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { useSeasonStore } from '../stores/season'
import { useAuthStore } from '../stores/auth'
import { loadTribeColors } from '../utils/tribeColors'
import type { ContestantFull } from '../types/contestant'
import TeamCreateWizard from '../components/TeamCreateWizard.vue'
import LoadingState from '../components/LoadingState.vue'

const seasonStore = useSeasonStore()
const auth = useAuthStore()

const contestants = ref<ContestantFull[]>([])
const loading = ref(false)
const errorMsg = ref('')

const seasonId = computed(() => seasonStore.selectedSeasonId)
const seasonName = computed(
  () => seasonStore.seasons.find((s) => s.id === seasonId.value)?.name ?? '',
)

async function loadContestants() {
  if (!seasonId.value) {
    contestants.value = []
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    // Load the season's saved tribe colors so cards match the real wizard (which
    // resolves colors from these overrides, not the fallback hash palette).
    await loadTribeColors(seasonId.value)
    const { data, error } = await supabase
      .from('contestants')
      .select(
        'id, first_name, last_name, preferred_name, photo_url, alt_image, video_url, bio, age, hometown, occupation, contestant_tribe_assignments(tribe, effective_from_episode)',
      )
      .eq('season_id', seasonId.value)
      .order('first_name')
    if (error) throw new Error(error.message)
    contestants.value = (data ?? []).map((c: any) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name ?? null,
      preferred_name: c.preferred_name ?? null,
      tribe:
        (c.contestant_tribe_assignments as any[]).find((a) => a.effective_from_episode === 1)
          ?.tribe ?? 'Unknown',
      photo_url: c.photo_url ?? null,
      alt_image: c.alt_image ?? null,
      video_url: c.video_url ?? null,
      bio: c.bio ?? null,
      age: c.age ?? null,
      hometown: c.hometown ?? null,
      occupation: c.occupation ?? null,
    }))
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load contestants'
  } finally {
    loading.value = false
  }
}

onMounted(() => seasonStore.load())
watch(seasonId, loadContestants, { immediate: true })
</script>

<template>
  <div class="flex min-h-full flex-1 flex-col">
    <div
      class="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-subtle px-4 py-2 text-sm text-text-subtle"
    >
      <i class="fa-solid fa-eye text-icon-subtle"></i>
      <span>
        <strong class="text-text-default">Admin preview</strong> — the player team-creation flow.
        Nothing here is saved.
      </span>
    </div>

    <p v-if="errorMsg" class="px-4 py-4 text-sm text-status-error">{{ errorMsg }}</p>
    <LoadingState v-else-if="loading" />
    <div v-else-if="!seasonId" class="px-4 py-8 text-sm text-text-muted">
      No active season to preview.
    </div>
    <TeamCreateWizard
      v-else
      class="flex-1"
      preview
      :season-id="seasonId"
      :season-name="seasonName"
      :contestants="contestants"
      :user-id="auth.user?.id ?? ''"
    />
  </div>
</template>
