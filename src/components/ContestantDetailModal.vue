<script setup lang="ts">
import { getTribeColors } from '../utils/tribeColors'
import { computed } from 'vue'
import type { ContestantFull } from '../types/contestant'

const props = defineProps<{
  contestant: ContestantFull | null
  show: boolean
  seasonName?: string
}>()

const emit = defineEmits<{ close: [] }>()

const colors = computed(() => props.contestant ? getTribeColors(props.contestant.tribe) : null)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="show && contestant"
        class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
        @click.self="emit('close')"
      >
        <div class="bg-stone-900 rounded-2xl border border-stone-700 w-full max-w-md overflow-hidden shadow-2xl">
          <!-- Photo header -->
          <div class="relative h-72 bg-stone-800">
            <img
              v-if="contestant.photo_url"
              :src="contestant.photo_url"
              :alt="contestant.name"
              class="w-full h-full object-cover object-top"
            />
            <div v-else class="absolute inset-0 flex items-center justify-center">
              <svg class="w-24 h-24 text-stone-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
              </svg>
            </div>
            <div class="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/10 to-transparent" />
            <!-- Tribe accent bar -->
            <div
              class="absolute bottom-0 left-0 right-0 h-1"
              :style="{ backgroundColor: colors?.primary }"
            />
            <!-- Close button -->
            <button
              class="absolute top-3 right-3 w-8 h-8 bg-black/60 hover:bg-black/90 rounded-full flex items-center justify-center text-white transition-colors"
              @click="emit('close')"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="p-5">
            <div class="mb-4">
              <h2 class="text-2xl font-bold text-white">{{ contestant.name }}</h2>
              <div class="flex items-center gap-2 mt-1 flex-wrap">
                <span class="text-sm font-semibold" :style="{ color: colors?.text }">{{ contestant.tribe }}</span>
                <span v-if="seasonName" class="text-stone-500 text-sm">· {{ seasonName }}</span>
              </div>
            </div>

            <!-- Stats grid -->
            <div class="grid grid-cols-3 gap-2 mb-4">
              <div class="bg-stone-800 rounded-xl p-3 text-center">
                <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Age</p>
                <p class="font-bold text-white text-lg leading-none">{{ contestant.age ?? '—' }}</p>
              </div>
              <div class="bg-stone-800 rounded-xl p-3 text-center">
                <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Hometown</p>
                <p class="font-semibold text-white text-xs leading-snug">{{ contestant.hometown ?? 'TBD' }}</p>
              </div>
              <div class="bg-stone-800 rounded-xl p-3 text-center">
                <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Occupation</p>
                <p class="font-semibold text-white text-xs leading-snug">{{ contestant.occupation ?? 'TBD' }}</p>
              </div>
            </div>

            <!-- Bio -->
            <div class="bg-stone-800 rounded-xl p-4">
              <p class="text-xs text-stone-500 mb-2 uppercase tracking-wide">About</p>
              <p class="text-sm text-stone-200 leading-relaxed">
                {{ contestant.bio ?? 'No bio available yet. Check back after the season premieres.' }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
