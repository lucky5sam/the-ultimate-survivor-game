<script setup lang="ts">
// The blocking "new episode" prompt, shown above every page once the admin
// starts an episode the player hasn't answered for. There's no close button,
// backdrop click or Escape — they have to choose: slide to reveal, or stay
// protected (they can reveal later from My Team).
import { ref } from 'vue'
import BaseModal from './base/BaseModal.vue'
import SlideToConfirm from './SlideToConfirm.vue'
import { useSpoilerStore } from '../stores/spoiler'

const spoiler = useSpoilerStore()
const errorMsg = ref('')

async function run(action: () => Promise<void>) {
  errorMsg.value = ''
  try {
    await action()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong — try again.'
  }
}
</script>

<template>
  <BaseModal
    :show="spoiler.needsPrompt"
    title="Spoiler Protection"
    title-icon="fa-solid fa-eye-slash"
    hide-close
    blur-backdrop
    :z-index="60"
    @close="() => {}"
  >
    <div class="flex flex-col gap-5">
      <p class="text-sm text-text-subtle">
        The latest episode has started, which means scores, standings and who was voted out may be
        visible in the app. Have you watched it yet?
      </p>
      <SlideToConfirm
        :label="`Slide to reveal Episode ${spoiler.latest?.number}`"
        :disabled="spoiler.saving"
        @confirm="run(spoiler.reveal)"
      />
      <button
        type="button"
        class="text-sm font-medium text-status-info hover:opacity-80 disabled:opacity-50"
        :disabled="spoiler.saving"
        @click="run(spoiler.decline)"
      >
        Keep Spoiler Protection on
      </button>
      <p v-if="errorMsg" class="text-center text-sm text-status-error">{{ errorMsg }}</p>
    </div>
  </BaseModal>
</template>
