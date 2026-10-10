<script setup lang="ts">
// One League Chat thread, opened from the feed (ChatView). Full width, Slack
// style (rows highlight on hover). The page itself scrolls, under the same sticky back bar as the public team page ("‹ Chat",
// revealing the thread title as a breadcrumb on scroll), with the reply box
// pinned to the bottom of the screen. New and
// deleted messages stream in live via Supabase Realtime. A thread tied to an
// episode the player hasn't watched stays locked (Spoiler Protection).
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'
import { useChatStore } from '../stores/chat'
import BaseButton from '../components/base/BaseButton.vue'
import LoadingState from '../components/LoadingState.vue'

type Message = { id: string; thread_id: string; user_id: string; body: string; created_at: string }
type Author = { name: string; avatar: string | null; initials: string }

const MAX_LEN = 500
// Newest messages loaded per thread — Supabase's per-request row cap. Replies
// are capped at 500 characters, so even a full page is a small download.
const PAGE_SIZE = 1000

const auth = useAuthStore()
const chat = useChatStore()
const route = useRoute()
const router = useRouter()

const messages = ref<Message[]>([])
const authors = ref<Record<string, Author>>({})
const loadingMessages = ref(false)
const draft = ref('')
const sending = ref(false)
const errorMsg = ref('')
const replyBox = ref<HTMLTextAreaElement | null>(null)
let channel: RealtimeChannel | null = null

const threadId = computed(() => String(route.params.threadId ?? ''))
const entry = computed(() => chat.entries.find((e) => e.thread.id === threadId.value) ?? null)

const canPost = computed(
  () => !!entry.value && !entry.value.gated && !entry.value.thread.is_locked && !chat.muted,
)

// Gated threads don't reveal their title or image.
const image = computed(() =>
  entry.value && !entry.value.gated ? entry.value.thread.image_url : null,
)
const title = computed(() =>
  !entry.value
    ? ''
    : entry.value.gated
      ? `Episode ${entry.value.episode?.number} discussion`
      : entry.value.label,
)

// Breadcrumb: once the thread title scrolls up behind the sticky back bar,
// surface it beside the "Chat" back link (e.g. "‹ Chat / Episode 4"). The
// negative top margin accounts for the bar's height.
const titleEl = ref<HTMLElement | null>(null)
const showBreadcrumb = ref(false)
let titleObserver: IntersectionObserver | undefined
watch(titleEl, (el) => {
  titleObserver?.disconnect()
  showBreadcrumb.value = false
  if (!el) return
  titleObserver = new IntersectionObserver(
    ([e]) => {
      showBreadcrumb.value = !e!.isIntersecting
    },
    { rootMargin: '-56px 0px 0px 0px', threshold: 0 },
  )
  titleObserver.observe(el)
})
onBeforeUnmount(() => titleObserver?.disconnect())

// Names/avatars come from the name-only public_profiles view.
async function loadAuthors(ids: string[]) {
  const missing = [...new Set(ids)].filter((id) => !authors.value[id])
  if (!missing.length) return
  const { data } = await supabase
    .from('public_profiles')
    .select('id, first_name, last_name, avatar_url')
    .in('id', missing)
  const next = { ...authors.value }
  for (const p of data ?? []) {
    const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Player'
    const initials =
      ((p.first_name?.charAt(0) ?? '') + (p.last_name?.charAt(0) ?? '')).toUpperCase() || '?'
    next[p.id] = { name, avatar: p.avatar_url, initials }
  }
  authors.value = next
}

// The window scrolls (not an inner box), so "the bottom" is the page's.
function isNearBottom() {
  const doc = document.documentElement
  return doc.scrollHeight - window.scrollY - window.innerHeight < 120
}
async function scrollToBottom() {
  await nextTick()
  window.scrollTo({ top: document.documentElement.scrollHeight })
}

function addMessage(m: Message) {
  if (messages.value.some((x) => x.id === m.id)) return
  const stick = isNearBottom() || m.user_id === auth.user?.id
  messages.value = [...messages.value, m]
  loadAuthors([m.user_id])
  chat.markSeen(m.thread_id, m.created_at)
  if (stick) scrollToBottom()
}

function unsubscribe() {
  if (channel) supabase.removeChannel(channel)
  channel = null
}

// Each load gets a number; a load that's been overtaken by a newer one (the
// watcher can fire twice in quick succession) quietly bows out.
let loadSeq = 0

async function loadThread(id: string) {
  const seq = ++loadSeq
  unsubscribe()
  messages.value = []
  errorMsg.value = ''
  if (!id || !entry.value || entry.value.gated) {
    loadingMessages.value = false
    return
  }
  loadingMessages.value = true
  try {
    // Newest PAGE_SIZE messages, shown oldest-first.
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, thread_id, user_id, body, created_at')
      .eq('thread_id', id)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (seq !== loadSeq) return
    if (error) throw error
    messages.value = ((data ?? []) as Message[]).reverse()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "Couldn't load this thread."
    return
  } finally {
    if (seq === loadSeq) loadingMessages.value = false
  }
  await loadAuthors(messages.value.map((m) => m.user_id))
  if (seq !== loadSeq) return
  chat.markSeen(id)
  await scrollToBottom()
  // Opened from a card's Reply button: jump straight into the reply box.
  if (route.query.reply) replyBox.value?.focus({ preventScroll: true })

  // A unique channel name per subscription: supabase.channel() hands back an
  // existing channel with the same name, and removeChannel() finishes
  // asynchronously, so reopening a thread could otherwise get the old,
  // already-subscribed channel and throw.
  channel = supabase
    .channel(`chat-thread:${id}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${id}` },
      (p) => addMessage(p.new as Message),
    )
    // Delete events can't be filtered; ignore ids we don't have.
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, (p) => {
      const gone = (p.old as { id?: string }).id
      messages.value = messages.value.filter((m) => m.id !== gone)
    })
    .subscribe()
}

// Load once the thread list has this thread (a direct link can arrive before
// the list loads), and again if it becomes readable. Separate sources, so each
// is compared on its own — a getter returning a fresh array would look
// "changed" on every thread-list update and reload in a loop.
watch([threadId, () => !!entry.value, () => entry.value?.gated], ([id]) => loadThread(id), {
  immediate: true,
})
onBeforeUnmount(unsubscribe)

async function send() {
  const body = draft.value.trim()
  const thread = entry.value?.thread
  const uid = auth.user?.id
  if (!body || !thread || !uid || !canPost.value) return
  sending.value = true
  errorMsg.value = ''
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ thread_id: thread.id, user_id: uid, body })
    .select('id, thread_id, user_id, body, created_at')
    .single()
  sending.value = false
  if (error) {
    errorMsg.value = "Couldn't send — the thread may be closed or you may be muted."
    return
  }
  draft.value = ''
  addMessage(data as Message)
}

// The reply box grows with its text (capped by max-h-36, then it scrolls), and
// shrinks back to one line once a reply is sent.
watch(draft, async () => {
  await nextTick()
  const el = replyBox.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
})

// Enter sends; Shift+Enter adds a new line.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

async function remove(m: Message) {
  if (!confirm('Delete this message?')) return
  const { error } = await supabase.from('chat_messages').delete().eq('id', m.id)
  if (error) errorMsg.value = error.message
  else messages.value = messages.value.filter((x) => x.id !== m.id)
}

function canDelete(m: Message) {
  return auth.isAdmin || m.user_id === auth.user?.id
}

// Show the author line only when the speaker changes or after a 5-minute gap.
function showHeader(i: number) {
  const m = messages.value[i]!
  const prev = messages.value[i - 1]
  return (
    !prev ||
    prev.user_id !== m.user_id ||
    Date.parse(m.created_at) - Date.parse(prev.created_at) > 5 * 60_000
  )
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return d.toLocaleString(
    'en-US',
    sameDay
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  )
}
</script>

<template>
  <div class="flex flex-1 flex-col">
    <!-- Back bar (sticky; reveals the thread title as a breadcrumb on scroll) -->
    <div
      class="sticky top-0 z-20 flex min-w-0 items-center border-b border-border-subtle bg-surface-subtle px-4 py-3"
    >
      <button
        @click="router.push('/chat')"
        class="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm font-medium text-text-default hover:underline"
      >
        <i class="fa-solid fa-chevron-left text-sm"></i>
        Chat
      </button>
      <Transition
        enter-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-200"
        leave-to-class="opacity-0"
      >
        <span
          v-if="showBreadcrumb && title"
          class="ml-1.5 flex min-w-0 items-center gap-1.5 text-sm font-medium text-text-subtle"
        >
          <span class="shrink-0">/</span>
          <img
            v-if="image"
            :src="image"
            alt=""
            class="h-5 w-10 shrink-0 rounded-xs border border-border-default object-cover"
          />
          <span class="min-w-0 truncate">{{ title }}</span>
        </span>
      </Transition>
    </div>

    <div class="flex w-full flex-1 flex-col px-4 sm:px-6">
      <!-- Thread header: full-width cover image (when set), then the title -->
      <div v-if="entry" ref="titleEl" class="-mx-4 border-b border-border-subtle sm:-mx-6">
        <!-- Cover: always its true 2:1, capped at max-w-2xl (~670px) so the
             1200px source stays sharp. Edge to edge on phones; on wider
             screens it's centered over a blurred, zoomed copy of itself that
             fills the full-width strip. -->
        <div
          v-if="image"
          class="relative overflow-hidden border-b border-border-subtle bg-surface-subtle sm:py-6"
        >
          <img
            :src="image"
            alt=""
            aria-hidden="true"
            class="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl"
          />
          <img
            :src="image"
            alt=""
            class="relative mx-auto aspect-[2/1] w-full max-w-2xl object-cover sm:rounded-lg sm:shadow-lg"
          />
        </div>
        <div class="px-4 py-4 sm:px-6">
          <h2 class="text-lg font-bold text-text-default">{{ title }}</h2>
          <p v-if="!entry.gated && entry.thread.description" class="text-sm text-text-subtle">
            {{ entry.thread.description }}
          </p>
        </div>
      </div>

      <LoadingState v-if="chat.loading && !entry" />

      <p v-else-if="!entry" class="py-8 text-center text-sm text-text-muted">
        This thread isn't available.
      </p>

      <div
        v-else-if="entry.gated"
        class="my-6 flex items-start gap-3 rounded-xl border border-border-subtle bg-status-info/10 px-4 py-4"
      >
        <i class="fa-solid fa-eye-slash mt-1 text-text-subtle"></i>
        <p class="text-sm text-text-default">
          Watch Episode {{ entry.episode?.number }} to unlock this thread.
        </p>
      </div>

      <template v-else>
        <!-- Messages -->
        <div class="flex-1 py-4">
          <LoadingState v-if="loadingMessages" />
          <p v-else-if="messages.length === 0" class="py-8 text-center text-sm text-text-muted">
            No messages yet. Start the conversation!
          </p>
          <div
            v-for="(m, i) in messages"
            :key="m.id"
            class="group -mx-4 flex gap-3 px-4 py-0.5 hover:bg-surface-subtle sm:-mx-6 sm:px-6"
            :class="showHeader(i) ? 'mt-3 pt-1.5 first:mt-0' : ''"
          >
            <!-- Circular avatar on the first message of a run; spacer after -->
            <div class="w-8 shrink-0">
              <span
                v-if="showHeader(i)"
                class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-surface-subtle text-xs font-semibold text-text-subtle"
              >
                <img
                  v-if="authors[m.user_id]?.avatar"
                  :src="authors[m.user_id]!.avatar!"
                  :alt="authors[m.user_id]?.name"
                  class="h-full w-full object-cover object-top"
                />
                <template v-else>{{ authors[m.user_id]?.initials ?? '' }}</template>
              </span>
            </div>
            <div class="min-w-0 flex-1">
              <p v-if="showHeader(i)" class="flex items-baseline gap-2">
                <span class="text-base font-semibold text-text-default">
                  {{ authors[m.user_id]?.name ?? '…' }}
                </span>
                <span class="text-xs text-text-muted">{{ fmtTime(m.created_at) }}</span>
              </p>
              <p class="whitespace-pre-wrap break-words text-base text-text-default">
                {{ m.body }}
              </p>
            </div>
            <button
              v-if="canDelete(m)"
              type="button"
              class="flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-md border border-border-default bg-surface-default text-xs text-text-subtle transition-colors hover:border-status-error hover:text-status-error focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              aria-label="Delete message"
              @click="remove(m)"
            >
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>

        <!-- Reply box, pinned to the bottom of the screen -->
        <div
          class="sticky bottom-0 -mx-4 border-t border-border-subtle bg-surface-page px-4 py-3 sm:-mx-6 sm:px-6"
        >
          <p v-if="errorMsg" class="mb-2 text-sm text-status-error">{{ errorMsg }}</p>
          <p v-if="chat.muted" class="text-sm text-text-subtle">
            <i class="fa-solid fa-volume-xmark mr-1"></i> You've been muted from posting in chat.
          </p>
          <p v-else-if="entry.thread.is_locked" class="text-sm text-text-subtle">
            <i class="fa-solid fa-lock mr-1"></i> This thread is closed to new replies.
          </p>
          <!-- One bordered box holding the input and Send. The box's p-1.5 is
               the gap on every side of the button; the one-line textarea is the
               button's height, so the gap is even until the text grows. -->
          <form
            v-else
            class="flex items-end gap-2 rounded-md border border-border-default bg-surface-default p-1.5 focus-within:ring-2 focus-within:ring-border-accent"
            @submit.prevent="send"
          >
            <textarea
              ref="replyBox"
              v-model="draft"
              rows="1"
              :maxlength="MAX_LEN"
              placeholder="Write a reply…"
              class="max-h-36 flex-1 resize-none bg-transparent px-1.5 py-2 text-sm text-text-default focus:outline-none"
              @keydown="onKeydown"
            ></textarea>
            <BaseButton
              type="submit"
              size="md"
              :loading="sending"
              :disabled="!draft.trim() || !canPost"
              aria-label="Send"
            >
              <!-- Font Awesome's plane points up-right; turn it to point right -->
              <i class="fa-solid fa-paper-plane rotate-45"></i>
            </BaseButton>
          </form>
        </div>
      </template>
    </div>
  </div>
</template>
