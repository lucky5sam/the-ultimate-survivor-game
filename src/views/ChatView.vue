<script setup lang="ts">
// League Chat feed. Threads are made by the admin (one per episode automatically,
// plus custom ones); players reply. One column, newest thread first — tapping a
// thread opens it on its own page (ChatThreadView). Threads tied to an episode
// the player hasn't watched stay locked behind Spoiler Protection (see
// stores/chat.ts). The thread list itself is loaded by AppLayout.
import { useSeasonStore } from '../stores/season'
import { useChatStore } from '../stores/chat'
import SpoilerBanner from '../components/SpoilerBanner.vue'
import LoadingState from '../components/LoadingState.vue'
import ChatThreadCard from '../components/ChatThreadCard.vue'

const seasonStore = useSeasonStore()
const chat = useChatStore()
</script>

<template>
  <div class="mx-auto w-full max-w-2xl px-4 py-4 sm:px-6 sm:py-6">
    <SpoilerBanner class="mb-6" />

    <LoadingState v-if="chat.loading && !chat.threads.length" />

    <div v-else-if="!seasonStore.selectedSeasonId" class="text-sm text-text-muted">
      No active seasons right now.
    </div>

    <div v-else-if="chat.entries.length === 0" class="text-sm text-text-muted">
      No threads yet. Each episode's thread opens when rosters lock.
    </div>

    <!-- Feed: newest thread first -->
    <div v-else class="space-y-3">
      <template v-for="e in chat.entries" :key="e.thread.id">
        <div
          v-if="e.gated"
          class="flex items-start gap-3 rounded-lg border border-border-subtle bg-status-info/10 px-4 py-4"
        >
          <i class="fa-solid fa-eye-slash mt-1 text-text-subtle"></i>
          <div class="min-w-0">
            <p class="font-semibold text-text-default">
              Episode {{ e.episode?.number }} discussion
            </p>
            <p class="text-sm text-text-subtle">Watch Episode {{ e.episode?.number }} to unlock</p>
          </div>
        </div>
        <ChatThreadCard v-else :entry="e" />
      </template>
    </div>
  </div>
</template>
