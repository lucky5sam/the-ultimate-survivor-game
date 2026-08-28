<script setup lang="ts">
// Alternative to a team photo: a single emoji on a preset background color.
// v-model:emoji / v-model:color. Pure input — the parent decides when to save.
import { computed, onMounted } from 'vue'

const props = defineProps<{ emoji: string | null; color: string | null }>()
const emit = defineEmits<{ 'update:emoji': [v: string | null]; 'update:color': [v: string | null] }>()

// Curated, on-brand palette. First entry is the default when none is chosen.
const SWATCHES = [
  '#d4a857',
  '#c25b5b',
  '#e07a5f',
  '#f59e0b',
  '#22c55e',
  '#0ea5e9',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#64748b',
]

const activeColor = computed(() => props.color || SWATCHES[0]!)

// Reduce arbitrary input to a single emoji (grapheme cluster), so multi-codepoint
// emoji (flags, ZWJ sequences, skin tones) survive but only one is kept.
function firstEmoji(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const { segment } of seg.segment(t)) return segment
  } catch {
    return [...t][0] ?? null
  }
  return null
}

function onEmojiInput(e: Event) {
  emit('update:emoji', firstEmoji((e.target as HTMLInputElement).value))
}
function pickColor(c: string) {
  emit('update:color', c)
}

// Ensure the saved color always matches the previewed one: adopt the default
// swatch when no color has been chosen yet.
onMounted(() => {
  if (!props.color) emit('update:color', SWATCHES[0]!)
})
</script>

<template>
  <div class="flex items-center gap-4">
    <!-- Live preview -->
    <div
      class="flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-2xl border border-border-default"
      :style="{ backgroundColor: activeColor }"
    >
      <span v-if="emoji" style="font-size: 64px; line-height: 1">{{ emoji }}</span>
      <span v-else class="text-sm text-white/70">Pick an emoji</span>
    </div>

    <div class="min-w-0 flex-1 space-y-3">
      <div>
        <label class="mb-1 block text-sm font-medium text-text-default">Emoji</label>
        <input
          :value="emoji ?? ''"
          @input="onEmojiInput"
          type="text"
          inputmode="text"
          placeholder="🔥"
          class="w-20 rounded-md border border-interactive-input-border bg-interactive-input px-3 py-2 text-center text-2xl focus:border-border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
        />
        <p class="mt-1 text-xs text-text-muted">
          Tap your emoji keyboard (⌘⌃Space on Mac) and pick one.
        </p>
      </div>

      <div>
        <label class="mb-1.5 block text-sm font-medium text-text-default">Background</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="c in SWATCHES"
            :key="c"
            type="button"
            :aria-label="`Background ${c}`"
            class="h-7 w-7 rounded-full border transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
            :class="activeColor === c ? 'border-text-default ring-2 ring-border-accent' : 'border-border-subtle'"
            :style="{ backgroundColor: c }"
            @click="pickColor(c)"
          ></button>
        </div>
      </div>
    </div>
  </div>
</template>
