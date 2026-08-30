<script setup lang="ts">
// Shared score-breakdown modal used by the Team page and the public team view.
// Purely presentational — the parent computes the TeamBreakdown and owns the
// open/close state.
import { ref, computed, watch } from 'vue'
import BaseModal from './base/BaseModal.vue'
import type { TeamBreakdown } from '../composables/useLeaderboard'

const props = defineProps<{
  show: boolean
  loading: boolean
  breakdown: TeamBreakdown | null
}>()

defineEmits<{ close: [] }>()

function fmtPts(n: number) {
  return n.toFixed(1)
}

type TabKey = 'players' | 'bounty' | 'swaps'
const activeTab = ref<TabKey>('players')

// Hide swapped-out players (toEpisode set) who never scored — they'd just be
// empty 0.0 rows. Players still on the roster (toEpisode null) always show.
const visibleStints = computed(() =>
  (props.breakdown?.stints ?? []).filter((s) => s.points !== 0 || s.toEpisode === null),
)

const tabs = computed(() => [
  { key: 'players' as const, label: 'Players', count: visibleStints.value.length },
  { key: 'bounty' as const, label: 'Bounty Hits', count: props.breakdown?.bountyHits.length ?? 0 },
  { key: 'swaps' as const, label: 'Swaps', count: props.breakdown?.swaps.length ?? 0 },
])

// Always land on the Players tab when the modal (re)opens.
watch(
  () => props.show,
  (open) => {
    if (open) activeTab.value = 'players'
  },
)
</script>

<template>
  <BaseModal :show="show" title="Score Breakdown" size="md" @close="$emit('close')">
    <div v-if="loading" class="py-6 text-center text-sm text-text-muted">Loading…</div>
    <div v-else-if="breakdown" class="flex min-h-[480px] flex-col">
      <!-- Tab bar: one isolated view per section -->
      <div class="mb-4 flex gap-1 rounded-md bg-surface-subtle p-1">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="flex-1 rounded-sm py-1.5 text-sm font-medium transition-colors"
          :class="
            activeTab === t.key
              ? 'bg-surface-default text-text-default shadow-sm'
              : 'text-text-subtle hover:text-text-default'
          "
          @click="activeTab = t.key"
        >
          {{ t.label
          }}<span v-if="t.count" class="ml-1 text-xs text-text-muted">{{ t.count }}</span>
        </button>
      </div>

      <div class="max-h-[50vh] flex-1 overflow-y-auto">
        <!-- Players -->
        <div v-if="activeTab === 'players'" class="divide-y divide-border-subtle">
          <div
            v-for="(s, i) in visibleStints"
            :key="i"
            class="flex items-center justify-between gap-3 py-2"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-text-default">
                {{ s.name
                }}<span
                  v-if="s.role === 'mvp'"
                  class="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-survivor-sand align-middle"
                  aria-label="MVP"
                >
                  <i class="fa-solid fa-crown text-[9px] text-white"></i>
                </span>
              </p>
              <p class="text-xs text-text-muted">
                Ep {{ s.fromEpisode }}–{{ s.toEpisode ?? 'now'
                }}<template v-if="s.role === 'mvp'"> · MVP ×1.5</template>
              </p>
            </div>
            <span class="shrink-0 text-sm font-semibold tabular-nums text-text-default">{{
              fmtPts(s.points)
            }}</span>
          </div>
        </div>

        <!-- Bounty hits -->
        <div v-else-if="activeTab === 'bounty'">
          <div v-if="breakdown.bountyHits.length" class="divide-y divide-border-subtle">
            <div
              v-for="(b, i) in breakdown.bountyHits"
              :key="i"
              class="flex items-center justify-between gap-3 py-2"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-text-default">{{ b.name }}</p>
                <p class="text-xs text-text-muted">Ep {{ b.episodeNumber }}</p>
              </div>
              <span class="shrink-0 text-sm font-semibold tabular-nums text-status-success"
                >+{{ fmtPts(b.points) }}</span
              >
            </div>
          </div>
          <p v-else class="py-6 text-center text-sm text-text-muted">No bounty hits yet.</p>
        </div>

        <!-- Swaps -->
        <div v-else>
          <div v-if="breakdown.swaps.length" class="divide-y divide-border-subtle">
            <div
              v-for="(sw, i) in breakdown.swaps"
              :key="i"
              class="flex items-center justify-between gap-3 py-2"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-text-default">
                  {{ sw.type === 'role_change' ? 'MVP change' : 'Roster swap' }}
                </p>
                <p class="truncate text-xs text-text-muted">
                  {{
                    sw.type === 'role_change'
                      ? `Made ${sw.addedName} MVP before Ep ${sw.episode}`
                      : `Swapped ${sw.removedName} for ${sw.addedName} before Ep ${sw.episode}`
                  }}
                </p>
              </div>
              <span
                class="shrink-0 text-sm font-semibold tabular-nums"
                :class="sw.penalty === 0 ? 'text-text-muted' : 'text-status-error'"
                >{{ sw.penalty === 0 ? 'Free' : fmtPts(sw.penalty) }}</span
              >
            </div>
          </div>
          <p v-else class="py-6 text-center text-sm text-text-muted">No swaps yet.</p>
        </div>
      </div>

      <!-- Total (always visible across tabs) -->
      <div class="mt-4 flex items-center justify-between border-t border-border-default pt-3">
        <p class="text-sm font-bold text-text-default">Total</p>
        <span class="text-base font-bold tabular-nums text-text-default">{{
          fmtPts(breakdown.totalPoints)
        }}</span>
      </div>
    </div>
    <p v-else class="py-6 text-center text-sm text-text-muted">Couldn't load the breakdown.</p>
  </BaseModal>
</template>
