import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth'
import { useSeasonStore } from './season'
import type { VisibleThrough } from '../utils/spoiler'

// Spoiler protection. Once the admin starts an episode, each player must say
// whether they've watched it. Until they confirm, the current season is shown
// "visible through" an earlier episode (see utils/spoiler.ts).
//
// Per player, two profile columns record their answers:
//   spoiler_answered_episode_id — the latest episode they answered the prompt for
//   spoiler_revealed_episode_id — the latest episode they confirmed watching
// Revealing an episode reveals everything before it too.
type EpisodeLite = { id: string; number: number; status: string }

export const useSpoilerStore = defineStore('spoiler', () => {
  const auth = useAuthStore()
  const seasonStore = useSeasonStore()

  const ready = ref(false)
  const seasonId = ref('') // the current season the answers apply to
  const episodes = ref<EpisodeLite[]>([])
  const answeredId = ref<string | null>(null)
  const revealedId = ref<string | null>(null)
  const saving = ref(false)

  // The newest episode that has started (active or completed) this season.
  const latest = computed<EpisodeLite | null>(() => {
    let best: EpisodeLite | null = null
    for (const e of episodes.value) {
      if (e.status !== 'active' && e.status !== 'completed') continue
      if (!best || e.number > best.number) best = e
    }
    return best
  })
  const numberOf = (id: string | null) =>
    id ? (episodes.value.find((e) => e.id === id)?.number ?? null) : null

  // The last episode this player can see results for, or null for everything.
  // Answers saved for another season don't count here.
  const cap = computed<VisibleThrough>(() => {
    const L = latest.value
    if (!L) return null
    const revealed = numberOf(revealedId.value)
    if (revealed != null && revealed >= L.number) return null
    if (revealed != null) return revealed
    // Never revealed this season: they've seen everything before the first
    // episode they declined (or before the current one, if they haven't answered).
    const declined = numberOf(answeredId.value)
    return (declined ?? L.number) - 1
  })

  // Show the blocking prompt: a new episode has started and they haven't answered.
  const needsPrompt = computed(
    () => ready.value && cap.value != null && answeredId.value !== latest.value?.id,
  )

  // The cap for whatever season a page is showing: only the current season is
  // ever protected — past seasons are over.
  function capFor(id: string | null | undefined): VisibleThrough {
    return id && id === seasonId.value ? cap.value : null
  }

  // Re-read the episode list and this player's answers. Called before every
  // navigation so a newly started episode is caught before a page loads data.
  async function refresh() {
    const uid = auth.user?.id
    await seasonStore.load()
    const sid = seasonStore.currentSeasonId
    if (!uid || !sid) {
      episodes.value = []
      ready.value = true
      return
    }
    const [epsRes, profRes] = await Promise.all([
      supabase.from('episodes').select('id, number, status').eq('season_id', sid),
      supabase
        .from('profiles')
        .select('spoiler_answered_episode_id, spoiler_revealed_episode_id')
        .eq('id', uid)
        .single(),
    ])
    // If either read fails, keep the last known state. (Before the profile
    // columns exist, this leaves protection off rather than blocking the app.)
    if (epsRes.error || profRes.error) {
      ready.value = true
      return
    }
    seasonId.value = sid
    episodes.value = (epsRes.data ?? []) as EpisodeLite[]
    answeredId.value = profRes.data?.spoiler_answered_episode_id ?? null
    revealedId.value = profRes.data?.spoiler_revealed_episode_id ?? null
    ready.value = true
  }

  async function save(update: Record<string, string>) {
    const uid = auth.user?.id
    if (!uid) return
    saving.value = true
    try {
      const { error } = await supabase.from('profiles').update(update).eq('id', uid)
      if (error) throw new Error(error.message)
      if (update.spoiler_answered_episode_id) answeredId.value = update.spoiler_answered_episode_id
      if (update.spoiler_revealed_episode_id) revealedId.value = update.spoiler_revealed_episode_id
    } finally {
      saving.value = false
    }
  }

  // "I've watched": reveal the latest episode (and everything before it).
  function reveal() {
    const L = latest.value
    if (!L) return Promise.resolve()
    return save({ spoiler_answered_episode_id: L.id, spoiler_revealed_episode_id: L.id })
  }

  // "Not yet": stay protected and stop asking about this episode.
  function decline() {
    const L = latest.value
    if (!L) return Promise.resolve()
    return save({ spoiler_answered_episode_id: L.id })
  }

  return { ready, latest, cap, needsPrompt, saving, capFor, refresh, reveal, decline }
})
