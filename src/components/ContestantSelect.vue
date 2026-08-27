<script setup lang="ts">
// Searchable contestant combobox with avatars. v-model is the contestant id.
// The trigger IS the search input: focus/click it and type to filter — no
// separate search box. When closed it shows the selected contestant (avatar +
// name); when open it shows what you type, with the current pick as placeholder.
import { ref, computed, nextTick } from 'vue'
import ContestantAvatar from './ContestantAvatar.vue'
import { displayName } from '../utils/contestantName'
import type { ContestantFull } from '../types/contestant'

const props = defineProps<{
  modelValue: string | null
  options: ContestantFull[]
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const open = ref(false)
const search = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const selected = computed(() => props.options.find((c) => c.id === props.modelValue) ?? null)
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q
    ? props.options.filter((c) => displayName(c).toLowerCase().includes(q))
    : props.options
})

// What the input shows: the live search text while open, otherwise the pick.
const inputValue = computed(() =>
  open.value ? search.value : selected.value ? displayName(selected.value) : '',
)

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
  emit('update:modelValue', id)
  closeDropdown()
  inputEl.value?.blur()
}
</script>

<template>
  <div class="relative">
    <div
      class="flex min-h-12 w-full items-center gap-2.5 rounded-md border border-interactive-input-border bg-interactive-input px-3 py-2 text-left transition-colors focus-within:border-border-accent focus-within:ring-2 focus-within:ring-border-accent hover:border-border-strong"
    >
      <ContestantAvatar
        v-if="selected && !open"
        :photo-url="selected.photo_url"
        :name="displayName(selected)"
        :size="32"
      />
      <input
        ref="inputEl"
        type="text"
        :value="inputValue"
        :placeholder="selected ? displayName(selected) : (placeholder ?? 'Select…')"
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
          v-for="c in filtered"
          :key="c.id"
          type="button"
          @click="choose(c.id)"
          class="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-subtle"
        >
          <ContestantAvatar :photo-url="c.photo_url" :name="displayName(c)" :size="28" />
          <span class="flex-1 truncate text-sm text-text-default">{{ displayName(c) }}</span>
          <span class="text-xs text-text-muted">{{ c.tribe }}</span>
        </button>
        <div v-if="filtered.length === 0" class="px-3 py-3 text-sm text-text-muted">No matches</div>
      </div>
    </div>

    <!-- click-away -->
    <div v-if="open" class="fixed inset-0 z-20" @click="closeDropdown"></div>
  </div>
</template>
