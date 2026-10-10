import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth'
import { useSpoilerStore } from './spoiler'
import { aired } from '../utils/spoiler'

// League Chat thread list, shared by the Chat page and the nav's unread badge.
// Threads are admin-made (one per episode automatically, plus custom ones).
// A thread tied to an episode is:
//   - not listed until that episode has started (admin Start or roster lock), and
//   - "gated" for players whose Spoiler Protection cap is before that episode.
// Which threads have unread messages is remembered per device in localStorage.
export type ChatThread = {
  id: string
  season_id: string
  episode_id: string | null
  kind: 'episode' | 'custom'
  title: string | null
  description: string | null
  image_url: string | null // 2:1 cover image (admin-set)
  is_locked: boolean
  last_message_at: string | null
  message_count: number // kept current by DB triggers
  is_highlight: boolean // admin-featured; destined for League Home
  created_at: string
}
type ChatEpisode = {
  id: string
  number: number
  title: string | null
  status: string
  locks_at: string | null
}
export type ThreadEntry = {
  thread: ChatThread
  episode: ChatEpisode | null
  label: string
  gated: boolean // hidden by Spoiler Protection
  unread: boolean
}

// League Chat is admin-only until it's released: non-admins get no Chat tab,
// no /chat pages (router guard), no League Home highlight, and no chat data is
// loaded for them. Flip to true to open it to every player.
export const CHAT_RELEASED = false

const SEEN_KEY = 'chat:lastSeen'

function readSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}')
  } catch {
    return {}
  }
}

// "Episode 4: Title" for episode threads unless the admin renamed it.
export function threadLabel(thread: ChatThread, episode: ChatEpisode | null): string {
  if (thread.title) return thread.title
  if (episode) return `Episode ${episode.number}${episode.title ? `: ${episode.title}` : ''}`
  return 'Discussion'
}

export const useChatStore = defineStore('chat', () => {
  const auth = useAuthStore()
  const spoiler = useSpoilerStore()

  const seasonId = ref('')
  const threads = ref<ChatThread[]>([])
  const episodes = ref<ChatEpisode[]>([])
  const muted = ref(false)
  const loading = ref(false)
  const lastSeen = ref<Record<string, string>>(readSeen())
  // Ticks each minute so threads appear once their episode's roster lock passes.
  const now = ref(Date.now())
  setInterval(() => (now.value = Date.now()), 60_000)

  let channel: RealtimeChannel | null = null

  // Whether this user can use chat at all (see CHAT_RELEASED).
  const enabled = computed(() => CHAT_RELEASED || auth.isAdmin)

  const episodesById = computed(() => Object.fromEntries(episodes.value.map((e) => [e.id, e])))

  // Same "has started" rule the rest of the app uses for an episode.
  function started(e: ChatEpisode): boolean {
    return e.status !== 'upcoming' || (e.locks_at != null && Date.parse(e.locks_at) <= now.value)
  }

  // When a thread went live: an episode thread when its episode started (roster
  // lock, or now if the admin started it early), a custom thread when created.
  function liveAt(t: ChatThread, ep: ChatEpisode | null): number {
    if (t.kind === 'episode' && ep?.locks_at) return Math.min(Date.parse(ep.locks_at), now.value)
    return Date.parse(t.created_at)
  }

  // Listed threads as a feed, newest first by when they went live.
  const entries = computed<ThreadEntry[]>(() => {
    const cap = spoiler.capFor(seasonId.value)
    const list: (ThreadEntry & { liveAt: number })[] = []
    for (const t of threads.value) {
      const ep = t.episode_id ? (episodesById.value[t.episode_id] ?? null) : null
      if (t.kind === 'episode' && (!ep || !started(ep))) continue
      const gated = ep != null && !aired(ep.number, cap)
      const seen = lastSeen.value[t.id]
      const unread = !gated && t.last_message_at != null && (!seen || t.last_message_at > seen)
      const label = threadLabel(t, ep)
      list.push({ thread: t, episode: ep, label, gated, unread, liveAt: liveAt(t, ep) })
    }
    return list.sort((a, b) => b.liveAt - a.liveAt)
  })

  const unreadCount = computed(() => entries.value.filter((e) => e.unread).length)

  function markSeen(threadId: string, at?: string | null) {
    const t = threads.value.find((x) => x.id === threadId)
    // Nothing posted yet means nothing to mark (and a "now" stamp here would
    // change on every call).
    const stamp = at ?? t?.last_message_at
    if (!stamp) return
    const prev = lastSeen.value[threadId]
    if (prev && prev >= stamp) return
    lastSeen.value = { ...lastSeen.value, [threadId]: stamp }
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(lastSeen.value))
    } catch {
      // storage blocked — unread state just won't persist
    }
  }

  function upsertThread(t: ChatThread) {
    const i = threads.value.findIndex((x) => x.id === t.id)
    if (i === -1) threads.value = [...threads.value, t]
    else threads.value = threads.value.map((x) => (x.id === t.id ? t : x))
  }

  function subscribe(sid: string) {
    if (channel) supabase.removeChannel(channel)
    channel = supabase
      // Unique name: removeChannel() finishes asynchronously, and channel() would
      // otherwise hand back the old, already-subscribed channel and throw.
      .channel(`chat-threads:${sid}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_threads', filter: `season_id=eq.${sid}` },
        (p) => upsertThread(p.new as ChatThread),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_threads', filter: `season_id=eq.${sid}` },
        (p) => upsertThread(p.new as ChatThread),
      )
      // Delete events can't be filtered; drop the id if it's one of ours.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_threads' }, (p) => {
        const id = (p.old as { id?: string }).id
        threads.value = threads.value.filter((t) => t.id !== id)
      })
      .subscribe()
  }

  async function load(sid: string) {
    seasonId.value = sid
    if (!sid || !enabled.value) {
      if (channel) supabase.removeChannel(channel)
      channel = null
      threads.value = []
      episodes.value = []
      return
    }
    loading.value = true
    try {
      const uid = auth.user?.id
      const [thRes, epRes, muteRes] = await Promise.all([
        supabase.from('chat_threads').select('*').eq('season_id', sid),
        supabase
          .from('episodes')
          .select('id, number, title, status, locks_at')
          .eq('season_id', sid),
        uid
          ? supabase.from('chat_mutes').select('user_id').eq('user_id', uid).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (seasonId.value !== sid) return // season changed mid-load
      threads.value = (thRes.data ?? []) as ChatThread[]
      episodes.value = (epRes.data ?? []) as ChatEpisode[]
      muted.value = !!muteRes.data
      now.value = Date.now()
      subscribe(sid)
    } finally {
      loading.value = false
    }
  }

  return {
    enabled,
    seasonId,
    threads,
    entries,
    unreadCount,
    muted,
    loading,
    load,
    markSeen,
    upsertThread,
  }
})
