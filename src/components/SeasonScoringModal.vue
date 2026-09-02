<script setup lang="ts">
// Read-only list of the scoring actions enabled for a season and their point
// values. Reuses the same season_action_types → action_types read model as the
// admin action-entry view, so players see exactly what scores. Each row leads
// with the action name; its category is small subtext.
import { ref, watch } from 'vue'
import { supabase } from '../lib/supabase'
import BaseModal from './base/BaseModal.vue'
import BaseButton from './base/BaseButton.vue'

// `modalZIndex` lets a caller stack this above another open modal (e.g. when the
// scoring list is launched from the rules modal rather than the wizard page).
const props = defineProps<{ show: boolean; seasonId: string; modalZIndex?: number }>()
const emit = defineEmits<{ close: [] }>()

type ScoringAction = { id: string; type: string; category: string; points: number }
const actions = ref<ScoringAction[]>([])
const loading = ref(false)
const errorMsg = ref('')
// Cache per season so reopening the modal doesn't refetch.
let loadedSeason = ''

async function load() {
  if (!props.seasonId || loadedSeason === props.seasonId) return
  loading.value = true
  errorMsg.value = ''
  try {
    const { data, error } = await supabase
      .from('season_action_types')
      .select('id, points, sort_order, action_types!inner(type, category)')
      .eq('season_id', props.seasonId)
      .order('sort_order')
    if (error) throw new Error(error.message)
    actions.value = (data ?? []).map((sat) => {
      const at = sat.action_types as unknown as { type: string; category: string | null }
      return {
        id: sat.id as string,
        type: at.type,
        category: at.category?.trim() || '',
        points: sat.points as number,
      }
    })
    loadedSeason = props.seasonId
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the scoring list.'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  (open) => {
    if (open) load()
  },
)
</script>

<template>
  <BaseModal
    :show="show"
    title="Scoring List"
    subtitle="Points your contestants earn for in-game actions this season."
    size="lg"
    :z-index="modalZIndex"
    @close="emit('close')"
  >
    <div v-if="loading" class="py-6 text-center text-sm text-text-subtle">Loading…</div>
    <p v-else-if="errorMsg" class="py-4 text-sm text-status-error">{{ errorMsg }}</p>
    <p v-else-if="!actions.length" class="py-4 text-sm text-text-subtle">
      No scoring actions have been set for this season yet.
    </p>
    <ul v-else class="max-h-[60vh] divide-y divide-border-subtle overflow-y-auto pr-1">
      <li
        v-for="a in actions"
        :key="a.id"
        class="flex items-center justify-between gap-4 py-2.5"
      >
        <div class="min-w-0">
          <p class="text-sm font-semibold text-text-default">{{ a.category }}</p>
          <p v-if="a.category" class="text-xs text-text-subtle">{{ a.type }}</p>
        </div>
        <span
          class="shrink-0 text-sm font-bold tabular-nums"
          :class="a.points >= 0 ? 'text-status-success' : 'text-status-error'"
        >
          {{ a.points >= 0 ? '+' : '' }}{{ a.points }}
        </span>
      </li>
    </ul>

    <template #footer>
      <BaseButton variant="secondary" @click="emit('close')">Close</BaseButton>
    </template>
  </BaseModal>
</template>
