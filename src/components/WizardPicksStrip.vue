<script setup lang="ts">
// The compact avatar strip shown in the wizard's sticky footer. Renders the 4
// roster slots (empty = dashed circle with the slot number), a vertical divider,
// then a 5th bounty slot (empty = dashed circle with "B"). The MVP slot gets a
// gold ring + crown; the bounty slot gets a red ring. A trailing label is
// supplied per-step via the default slot. When `teamName` is provided it shows
// above the slots (left-aligned), falling back to "Team Name" until one is set.
import { getTribeColors } from '../utils/tribeColors'
import type { ContestantFull } from '../types/contestant'

defineProps<{
  picks: ContestantFull[] // the selected roster, 0–4 entries
  mvpId: string | null
  bounty: ContestantFull | null
  teamName?: string
}>()
</script>

<template>
  <div class="mb-3">
    <!-- Team name above the slots (left-aligned) -->
    <p
      v-if="teamName !== undefined"
      class="mb-2 truncate text-sm font-semibold"
      :class="teamName ? 'text-text-default' : 'text-text-muted'"
    >
      {{ teamName || 'Team Name' }}
    </p>

    <div class="flex flex-wrap items-center gap-x-2 gap-y-3">
      <!-- Roster slots -->
    <div v-for="i in 4" :key="i" class="flex w-11 flex-col items-center gap-0.5">
      <template v-if="picks[i - 1]">
        <div class="relative">
          <div
            class="h-9 w-9 overflow-hidden rounded-full border-2"
            :style="
              picks[i - 1]!.id === mvpId
                ? {
                    borderColor: 'var(--color-survivor-sand)',
                    boxShadow: '0 0 6px var(--color-survivor-sand)',
                  }
                : {
                    borderColor: getTribeColors(picks[i - 1]!.tribe).primary,
                    boxShadow: `0 0 6px ${getTribeColors(picks[i - 1]!.tribe).primary}55`,
                  }
            "
          >
            <img
              v-if="picks[i - 1]!.photo_url"
              :src="picks[i - 1]!.photo_url ?? undefined"
              :alt="picks[i - 1]!.name"
              class="h-full w-full object-cover object-top"
            />
            <div v-else class="flex h-full w-full items-center justify-center bg-surface-strong">
              <svg class="h-4 w-4 text-icon-subtle" fill="currentColor" viewBox="0 0 24 24">
                <path
                  d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
                />
              </svg>
            </div>
          </div>
          <!-- Crown badge for the MVP -->
          <span
            v-if="picks[i - 1]!.id === mvpId"
            class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-survivor-sand"
          >
            <svg class="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2h14v2H5v-2z" />
            </svg>
          </span>
        </div>
        <span
          class="w-11 truncate text-center text-[10px] font-medium leading-tight"
          :class="picks[i - 1]!.id === mvpId ? 'text-survivor-sand' : 'text-text-default'"
        >
          {{ picks[i - 1]!.name.split(' ')[0] }}
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

    <!-- Divider between the roster and the bounty slot -->
    <div class="mx-1 h-9 w-px shrink-0 bg-border-subtle" />

    <!-- Bounty slot -->
    <div class="flex w-11 flex-col items-center gap-0.5">
      <template v-if="bounty">
        <div
          class="h-9 w-9 overflow-hidden rounded-full border-2"
          :style="{
            borderColor: 'var(--color-status-error)',
            boxShadow: '0 0 6px color-mix(in srgb, var(--color-status-error) 45%, transparent)',
          }"
        >
          <img
            v-if="bounty.photo_url"
            :src="bounty.photo_url ?? undefined"
            :alt="bounty.name"
            class="h-full w-full object-cover object-top"
          />
          <div v-else class="flex h-full w-full items-center justify-center bg-surface-strong">
            <svg class="h-4 w-4 text-icon-subtle" fill="currentColor" viewBox="0 0 24 24">
              <path
                d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
              />
            </svg>
          </div>
        </div>
        <span class="w-11 truncate text-center text-[10px] font-medium leading-tight text-status-error">
          {{ bounty.name.split(' ')[0] }}
        </span>
      </template>
      <template v-else>
        <div
          class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-status-error/40 bg-surface-subtle/40"
        >
          <span class="text-[10px] font-bold text-status-error">B</span>
        </div>
        <span class="text-[10px] text-text-muted">Bounty</span>
      </template>
    </div>

      <!-- Per-step trailing content (actions). Hugs the right on wide rows; drops to
           its own full-width line on mobile so the buttons can stretch. -->
      <div class="ml-auto w-full sm:w-auto"><slot /></div>
    </div>
  </div>
</template>
