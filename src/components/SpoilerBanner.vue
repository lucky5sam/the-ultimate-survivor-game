<script setup lang="ts">
// Spoiler Protection card, shown at the top of each main page while the latest
// episode is hidden for this player (they chose "Keep Spoiler Protection on").
// The button reveals it everywhere in the app. Renders nothing otherwise.
// Cool blue = "frozen" at the previous episode; the orange button is the thaw.
import { ref, computed } from 'vue'
import BaseCard from './base/BaseCard.vue'
import BaseButton from './base/BaseButton.vue'
import { useSpoilerStore } from '../stores/spoiler'
import { useSeasonStore } from '../stores/season'

const spoiler = useSpoilerStore()
const seasonStore = useSeasonStore()
const cap = computed(() => spoiler.capFor(seasonStore.selectedSeasonId))

const errorMsg = ref('')
async function reveal() {
  errorMsg.value = ''
  try {
    await spoiler.reveal()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong — try again.'
  }
}
</script>

<template>
  <BaseCard v-if="cap !== null" padding="sm" class="border-status-info! bg-status-info/10!">
    <!-- Button sits beside the text on wider screens, below it on phones. -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:pr-4">
      <!-- Icon + title on one line; the description spans the full width
           beneath both. -->
      <div class="min-w-0 flex-1">
        <p class="flex items-center gap-2 font-semibold text-text-default">
          <i class="fa-solid fa-eye-slash"></i>
          Spoiler Protection is on
        </p>
        <p class="mt-1 text-sm text-text-subtle">
          <template v-if="cap > 0">Showing results through Episode {{ cap }}.</template>
          <template v-else>This season's results are hidden.</template>
          Watched Episode {{ spoiler.latest?.number }}? Reveal the latest scores.
        </p>
      </div>
      <BaseButton class="shrink-0" :loading="spoiler.saving" @click="reveal"
        >I've Watched Episode {{ spoiler.latest?.number }}</BaseButton
      >
    </div>
    <p v-if="errorMsg" class="mt-2 text-sm text-status-error">{{ errorMsg }}</p>
  </BaseCard>
</template>
