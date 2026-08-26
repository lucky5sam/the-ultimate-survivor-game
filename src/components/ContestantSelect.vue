<script setup lang="ts">
// Searchable contestant dropdown with avatars. v-model is the contestant id.
import { ref, computed } from 'vue'
import ContestantAvatar from './ContestantAvatar.vue'
import type { ContestantFull } from '../types/contestant'

const props = defineProps<{
  modelValue: string | null
  options: ContestantFull[]
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const open = ref(false)
const search = ref('')

const selected = computed(() => props.options.find((c) => c.id === props.modelValue) ?? null)
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? props.options.filter((c) => c.name.toLowerCase().includes(q)) : props.options
})

function toggle() {
  open.value = !open.value
  if (open.value) search.value = ''
}
function choose(id: string) {
  emit('update:modelValue', id)
  open.value = false
  search.value = ''
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      @click="toggle"
      class="flex w-full items-center gap-2.5 rounded-md border border-interactive-input-border bg-interactive-input px-3 py-2 text-left transition-colors hover:border-border-strong"
    >
      <ContestantAvatar
        v-if="selected"
        :photo-url="selected.photo_url"
        :name="selected.name"
        :size="32"
      />
      <span
        class="flex-1 truncate text-sm"
        :class="selected ? 'font-medium text-text-default' : 'text-text-muted'"
        >{{ selected ? selected.name : (placeholder ?? 'Select…') }}</span
      >
      <svg
        class="h-4 w-4 shrink-0 text-icon-subtle"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute left-0 right-0 z-30 mt-1 rounded-md border border-border-subtle bg-surface-overlay shadow-lg"
    >
      <div class="p-2">
        <input
          v-model="search"
          type="text"
          placeholder="Search…"
          class="w-full rounded-md border border-interactive-input-border bg-interactive-input px-2.5 py-1.5 text-sm text-text-default placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-accent"
        />
      </div>
      <div class="max-h-56 overflow-y-auto pb-1">
        <button
          v-for="c in filtered"
          :key="c.id"
          type="button"
          @click="choose(c.id)"
          class="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-subtle"
        >
          <ContestantAvatar :photo-url="c.photo_url" :name="c.name" :size="28" />
          <span class="flex-1 truncate text-sm text-text-default">{{ c.name }}</span>
          <span class="text-xs text-text-muted">{{ c.tribe }}</span>
        </button>
        <div v-if="filtered.length === 0" class="px-3 py-3 text-sm text-text-muted">No matches</div>
      </div>
    </div>

    <!-- click-away -->
    <div v-if="open" class="fixed inset-0 z-20" @click="open = false"></div>
  </div>
</template>
