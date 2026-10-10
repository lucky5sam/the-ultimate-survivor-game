<script setup lang="ts">
// One League Chat thread as a social-post style card: cover image (when set)
// across the top, then title, description, and the reply row. Links to the
// thread page. Used by the Chat feed and League Home's highlights. Callers only
// pass readable (non-gated) threads.
import { computed } from 'vue'
import { useChatStore, type ThreadEntry } from '../stores/chat'

const props = defineProps<{ entry: ThreadEntry }>()
const chat = useChatStore()

// Reply opens the thread with the reply box focused (?reply=1). Hidden when
// the thread is closed or the player is muted.
const canReply = computed(() => !props.entry.thread.is_locked && !chat.muted)

// "just now", "5m ago", "3h ago", "2d ago", then a date.
function ago(iso: string) {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`
  if (mins < 7 * 24 * 60) return `${Math.floor(mins / (24 * 60))}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <!-- The title link stretches over the whole card (after:absolute inset-0), so
       the card is clickable without nesting the Reply link inside another link.
       Reply sits above it (relative z-10). -->
  <div
    class="relative flex w-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-default text-left shadow-sm transition-colors hover:bg-surface-subtle"
  >
    <img
      v-if="entry.thread.image_url"
      :src="entry.thread.image_url"
      alt=""
      class="aspect-[2/1] w-full border-b border-border-subtle object-cover"
    />
    <div class="px-4 py-4">
      <!-- Title + description, with Reply on the right (top-aligned) -->
      <div class="mb-3 flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-text-default" :class="entry.unread ? 'font-bold' : 'font-semibold'">
            <RouterLink
              :to="`/chat/${entry.thread.id}`"
              class="after:absolute after:inset-0 focus:outline-none focus-visible:underline"
              >{{ entry.label }}</RouterLink
            >
            <span
              v-if="entry.unread"
              class="ml-1.5 inline-block h-2 w-2 rounded-full bg-interactive-accent align-middle"
              aria-label="Unread"
            ></span>
          </p>
          <p v-if="entry.thread.description" class="mt-0.5 text-sm text-text-subtle">
            {{ entry.thread.description }}
          </p>
        </div>
        <RouterLink
          v-if="canReply"
          :to="{ path: `/chat/${entry.thread.id}`, query: { reply: '1' } }"
          class="relative z-10 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border-default bg-interactive-neutral px-3 py-1.5 text-sm font-semibold text-text-default transition hover:bg-interactive-neutral-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
        >
          <i class="fa-solid fa-reply text-xs"></i>
          Reply
        </RouterLink>
      </div>
      <p
        class="flex items-center gap-1.5 border-t border-border-subtle pt-3 text-sm text-text-subtle"
      >
        <i class="fa-solid fa-comment"></i>
        <!-- Reply count, then the (lower-contrast) latest-reply time -->
        <span
          :aria-label="`${entry.thread.message_count} ${entry.thread.message_count === 1 ? 'reply' : 'replies'}`"
          >{{ entry.thread.message_count }}</span
        >
        <span class="text-text-muted">
          <template v-if="entry.thread.message_count > 0 && entry.thread.last_message_at">
            latest {{ ago(entry.thread.last_message_at) }}
          </template>
          <template v-else>No replies yet</template>
        </span>
        <template v-if="entry.thread.is_locked">
          <span aria-hidden="true">·</span>
          <i class="fa-solid fa-lock"></i> Closed
        </template>
      </p>
    </div>
  </div>
</template>
