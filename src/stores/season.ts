import { ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'

// League-wide season selection, shared by every page's season selector so the
// choice persists as the user moves between Dashboard / Leaderboard / etc.
export type Season = {
  id: string
  name: string
  status: string
  current_episode_id: string | null
  starts_at: string | null
  image_url: string | null
}

export const useSeasonStore = defineStore('season', () => {
  const seasons = ref<Season[]>([])
  const selectedSeasonId = ref('')
  // "Current" = the league's active/upcoming season (what a fresh visit defaults to).
  const currentSeasonId = ref('')

  // Load runs once per app session; concurrent callers share the same promise.
  let loadPromise: Promise<void> | null = null

  async function doLoad() {
    const { data } = await supabase
      .from('seasons')
      .select('id, name, status, current_episode_id, starts_at, image_url')
      .order('created_at', { ascending: false })
    seasons.value = (data ?? []) as Season[]
    const current =
      seasons.value.find((s) => s.status === 'active' || s.status === 'upcoming') ??
      seasons.value[0]
    currentSeasonId.value = current?.id ?? ''
    if (!selectedSeasonId.value) selectedSeasonId.value = currentSeasonId.value
  }

  function load() {
    if (!loadPromise) loadPromise = doLoad()
    return loadPromise
  }

  return { seasons, selectedSeasonId, currentSeasonId, load }
})
