<script setup lang="ts">
// Alternative to a team photo: a single emoji on a preset background color.
// v-model:emoji / v-model:color. Pick from a curated grid, or type/paste any
// emoji for something not listed. Pure input — the parent decides when to save.
import { computed, onMounted } from 'vue'
import {
  TEAM_AVATAR_COLORS as SWATCHES,
  TEAM_AVATAR_EMOJIS as BASE_EMOJIS,
} from '../utils/teamAvatar'

const props = defineProps<{ emoji: string | null; color: string | null }>()
const emit = defineEmits<{
  'update:emoji': [v: string | null]
  'update:color': [v: string | null]
}>()

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
function pickEmoji(e: string) {
  emit('update:emoji', e)
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
  <div class="space-y-4">
    <div class="flex items-center gap-4">
      <!-- Live preview -->
      <div
        class="flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-2xl border border-border-default"
        :style="{ backgroundColor: activeColor }"
      >
        <span v-if="emoji" style="font-size: 64px; line-height: 1">{{ emoji }}</span>
        <span v-else class="text-sm text-black/40">Pick an emoji</span>
      </div>

      <div class="min-w-0 flex-1">
        <label class="mb-1.5 block text-sm font-medium text-text-default">Background</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="c in SWATCHES"
            :key="c"
            type="button"
            :aria-label="`Background ${c}`"
            class="h-7 w-7 rounded-full border transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
            :class="
              activeColor === c
                ? 'border-text-default ring-2 ring-border-accent'
                : 'border-border-subtle'
            "
            :style="{ backgroundColor: c }"
            @click="pickColor(c)"
          ></button>
        </div>
      </div>
    </div>

    <div>
      <label class="mb-1.5 block text-sm font-medium text-text-default">Emoji</label>
      <div class="grid grid-cols-7 gap-1.5 sm:grid-cols-10">
        <button
          v-for="e in BASE_EMOJIS"
          :key="e"
          type="button"
          class="flex h-9 items-center justify-center rounded-md border text-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
          :class="
            emoji === e
              ? 'border-border-accent bg-surface-subtle'
              : 'border-transparent hover:bg-surface-subtle'
          "
          @click="pickEmoji(e)"
        >
          {{ e }}
        </button>
      </div>
      <div class="mt-2 flex items-center gap-2">
        <input
          :value="emoji ?? ''"
          @input="onEmojiInput"
          type="text"
          placeholder="🙂"
          class="w-16 rounded-md border border-interactive-input-border bg-interactive-input px-2 py-1.5 text-center text-lg focus:border-border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
        />
        <span class="text-xs text-text-muted">or type / paste your own</span>
      </div>
    </div>
  </div>
</template>
