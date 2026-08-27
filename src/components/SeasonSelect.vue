<script setup lang="ts">
// League season picker, styled like the swap-modal player selector: the trigger
// IS the search input — click it and type to filter. Bound to the shared season
// store so the choice is the same on every page. Seasons have no image yet, so a
// placeholder circle stands in (swap it for the real image once stored).
import { ref, computed, nextTick } from 'vue'
import { useSeasonStore } from '../stores/season'

const store = useSeasonStore()

const open = ref(false)
const search = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const selected = computed(() => store.seasons.find((s) => s.id === store.selectedSeasonId) ?? null)
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? store.seasons.filter((s) => s.name.toLowerCase().includes(q)) : store.seasons
})

// What the input shows: the live search text while open, otherwise the pick.
const inputValue = computed(() => (open.value ? search.value : (selected.value?.name ?? '')))

// Short human label for a season's status (shown on the right of each row).
function statusLabel(status: string): string {
  if (status === 'active') return 'Active'
  if (status === 'upcoming') return 'Upcoming'
  if (status === 'completed') return 'Completed'
  return status
}

function openDropdown() {
  if (open.value) return
  open.value = true
  search.value = ''
}
function closeDropdown() {
  open.value = false
  search.value = ''
}
function toggle() {
  if (open.value) {
    closeDropdown()
  } else {
    openDropdown()
    nextTick(() => inputEl.value?.focus())
  }
}
function onInput(e: Event) {
  open.value = true
  search.value = (e.target as HTMLInputElement).value
}
function choose(id: string) {
  store.selectedSeasonId = id
  closeDropdown()
  inputEl.value?.blur()
}
</script>

<template>
  <div class="relative">
    <div
      class="flex min-h-12 w-full items-center gap-2.5 rounded-md border border-interactive-input-border bg-interactive-input px-3 py-2 text-left transition-colors focus-within:border-border-accent focus-within:ring-2 focus-within:ring-border-accent hover:border-border-strong"
    >
      <!-- Season image (placeholder circle until one is set) -->
      <template v-if="selected && !open">
        <img
          v-if="selected.image_url"
          :src="selected.image_url"
          :alt="selected.name"
          class="h-8 w-8 shrink-0 rounded-full object-cover"
        />
        <span
          v-else
          class="h-8 w-8 shrink-0 rounded-full bg-surface-strong"
          aria-hidden="true"
        ></span>
      </template>
      <input
        ref="inputEl"
        type="text"
        :value="inputValue"
        :placeholder="selected ? selected.name : 'Select season…'"
        @focus="openDropdown"
        @input="onInput"
        class="min-w-0 flex-1 bg-transparent text-sm text-text-default placeholder:text-text-muted focus:outline-none"
        :class="selected && !open ? 'font-medium' : ''"
      />
      <button type="button" @click="toggle" class="shrink-0 text-icon-subtle">
        <svg
          class="h-4 w-4 transition-transform"
          :class="open ? 'rotate-180' : ''"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>

    <div
      v-if="open"
      class="absolute left-0 right-0 z-30 mt-1 rounded-md border border-border-subtle bg-surface-overlay shadow-lg"
    >
      <div class="max-h-56 overflow-y-auto py-1">
        <button
          v-for="s in filtered"
          :key="s.id"
          type="button"
          @click="choose(s.id)"
          class="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-subtle"
        >
          <img
            v-if="s.image_url"
            :src="s.image_url"
            :alt="s.name"
            class="h-7 w-7 shrink-0 rounded-full object-cover"
          />
          <span
            v-else
            class="h-7 w-7 shrink-0 rounded-full bg-surface-strong"
            aria-hidden="true"
          ></span>
          <span class="flex-1 truncate text-sm text-text-default">{{ s.name }}</span>
          <span class="text-xs text-text-muted">{{ statusLabel(s.status) }}</span>
        </button>
        <div v-if="filtered.length === 0" class="px-3 py-3 text-sm text-text-muted">No seasons</div>
      </div>
    </div>

    <!-- click-away -->
    <div v-if="open" class="fixed inset-0 z-20" @click="closeDropdown"></div>
  </div>
</template>
