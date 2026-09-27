<script setup lang="ts">
import { getTribeColors } from '../utils/tribeColors'
import { displayName, shortName } from '../utils/contestantName'
import { computed, ref, watch, onUnmounted } from 'vue'
import { supabase } from '../lib/supabase'
import parchmentUrl from '../assets/survivor_decor_parchment.svg'
import { formatPlace } from '../utils/place'
import type { ContestantFull } from '../types/contestant'

// One scored action for the Scoring tab. `points` is the per-action value and
// `count` how many times it happened that episode; the line total is points×count.
export type ContestantEventItem = {
  episodeNumber: number
  label: string
  points: number
  count: number
}

const props = withDefaults(
  defineProps<{
    contestant: ContestantFull | null
    show: boolean
    // When set, the modal shows Info / Scoring tabs. The parent supplies the
    // events (fetched on open) and the loading flag. Off by default so the
    // wizard's info-only usage is unchanged.
    showEventLog?: boolean
    events?: ContestantEventItem[]
    eventsLoading?: boolean
    // When set, adds a Votes tab and self-fetches this contestant's per-episode
    // voting record (who they voted for, and who voted for them).
    showVotes?: boolean
  }>(),
  { showEventLog: false, events: () => [], eventsLoading: false, showVotes: false },
)

const emit = defineEmits<{ close: [] }>()

const colors = computed(() => (props.contestant ? getTribeColors(props.contestant.tribe) : null))

// True once the photo has scrolled far enough that the identity/tabs bar is
// stuck to the top. Drives which close button is shown (over the photo vs. in
// the header). The photo is h-72 (288px); flip a bit before it's fully gone.
const scrollEl = ref<HTMLElement | null>(null)
const stuck = ref(false)
function onScroll() {
  stuck.value = (scrollEl.value?.scrollTop ?? 0) > 240
}

// Lock background scroll while the modal is open, restoring it on close/unmount.
// Also reset the scroll position/stuck state each time it opens.
watch(
  () => props.show,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) stuck.value = false
  },
)
onUnmounted(() => {
  document.body.style.overflow = ''
})

type TabId = 'info' | 'events' | 'votes'
const activeTab = ref<TabId>('info')

// The tab bar: Info always, then Scoring / Votes when their data is enabled.
const tabs = computed(() => {
  const t: { id: TabId; label: string }[] = [{ id: 'info', label: 'Info' }]
  if (props.showEventLog) t.push({ id: 'events', label: 'Scoring' })
  if (props.showVotes) t.push({ id: 'votes', label: 'Votes' })
  return t
})

// Per-episode voting record for this contestant, newest episode first.
// `success` (voted-for only) is whether the target was eliminated that episode.
type VoteRef = { name: string; nullified: boolean; success?: boolean }
type VoteEpisode = { episodeNumber: number; votedFor: VoteRef[]; votedBy: VoteRef[] }
const votes = ref<VoteEpisode[]>([])
const votesLoading = ref(false)

async function loadVotes() {
  const c = props.contestant
  if (!c) return
  votesLoading.value = true
  votes.value = []
  try {
    const { data } = await supabase
      .from('episode_votes')
      .select(
        'nullified, voter_contestant_id, target_contestant_id,' +
          ' episode:episodes!episode_votes_episode_id_fkey(id, number),' +
          ' voter:contestants!episode_votes_voter_fkey(first_name, last_name, preferred_name),' +
          ' target:contestants!episode_votes_target_fkey(first_name, last_name, preferred_name, eliminated_episode_id)',
      )
      .or(`voter_contestant_id.eq.${c.id},target_contestant_id.eq.${c.id}`)

    const byEp = new Map<number, VoteEpisode>()
    for (const row of (data ?? []) as any[]) {
      const num = row.episode?.number
      if (num == null) continue
      if (!byEp.has(num)) byEp.set(num, { episodeNumber: num, votedFor: [], votedBy: [] })
      const group = byEp.get(num)!
      if (row.voter_contestant_id === c.id && row.target) {
        // Successful = the person voted for was eliminated in this same episode.
        const success =
          !!row.target.eliminated_episode_id && row.target.eliminated_episode_id === row.episode?.id
        group.votedFor.push({ name: shortName(row.target), nullified: row.nullified, success })
      }
      if (row.target_contestant_id === c.id && row.voter) {
        group.votedBy.push({ name: shortName(row.voter), nullified: row.nullified })
      }
    }
    votes.value = [...byEp.values()].sort((a, b) => b.episodeNumber - a.episodeNumber)
  } finally {
    votesLoading.value = false
  }
}

// ── Season stats for the Info + Scoring tabs ──
// Only where the Scoring tab is enabled (not the wizard's info-only modal).
//   • Info tab "League Picks" (MVP / Player / Bounty tiles) — loads on open.
//   • Scoring tab "Total Score" / "Castaway Rank" — loads the first time that tab
//     is opened, since it needs every scored action in the season.
// All of it is league-wide, so each dataset is fetched at most once per season
// and reused for every contestant opened while this modal is mounted (i.e. until
// the page is left). Cached as promises, so overlapping requests share one fetch;
// a failed fetch is dropped from the cache so the next open retries.

// Scoring tab: this contestant's total points and where that ranks among every
// contestant in the season (competition ranking, so ties share a place). Uses the
// base action_types.points — the same values as the event list and leaderboard.
type SeasonStats = { total: number; rank: number; tied: boolean }
const seasonStats = ref<SeasonStats | null>(null)
const standingLoading = ref(false)
// Info tab: teams currently rostering this contestant as MVP vs regular player.
// Stays null in preseason (rosters are still being picked) or before any team
// has a roster, which hides the League Picks row.
const rostership = ref<{ mvp: number; player: number } | null>(null)
// Info tab: teams that picked this contestant as their bounty in the last
// resolved episode. Resolved episodes only, so a pending (still editable) pick is
// never revealed; null until the first bounty resolves (the tile shows "—").
const bountyCount = ref<number | null>(null)
// Header status: still in the game, or voted out (with the episode number). From
// the season cast, so it's shown wherever the season data loads; null (hidden)
// otherwise.
const status = ref<{ out: boolean; episode: number | null } | null>(null)

// Supabase caps a response at 1,000 rows by default; a full season of scored
// actions (or bounty picks) can exceed that, so page through it.
const PAGE = 1000

type SeasonEpisode = {
  id: string
  number: number
  status: string
  is_finale: boolean
  bounty_contestant_id: string | null
  locks_at: string | null
}
type SeasonCastaway = { id: string; eliminated_episode_id: string | null }
type SeasonBase = { eps: SeasonEpisode[]; cast: SeasonCastaway[]; teamIds: string[] }
type BountyPick = { contestant_id: string; effective_from_episode: number }

// Memoize an async loader by key; drop a failed result so it can be retried.
function cached<T>(store: Map<string, Promise<T>>, key: string, load: () => Promise<T>) {
  let p = store.get(key)
  if (!p) {
    p = load()
    store.set(key, p)
    p.catch(() => store.delete(key))
  }
  return p
}
const seasonIdCache = new Map<string, Promise<string | null>>()
const baseCache = new Map<string, Promise<SeasonBase>>()
const totalsCache = new Map<string, Promise<Map<string, number>>>()
const rostersCache = new Map<string, Promise<{ contestant_id: string; role: string }[]>>()
const picksCache = new Map<string, Promise<BountyPick[][]>>()

function fetchSeasonId(contestantId: string) {
  return cached(seasonIdCache, contestantId, async () => {
    const { data, error } = await supabase
      .from('contestants')
      .select('season_id')
      .eq('id', contestantId)
      .single()
    if (error) throw error
    return (data?.season_id as string) ?? null
  })
}

// The season's episodes, cast, and (non-test, like the leaderboard) teams.
function fetchBase(seasonId: string) {
  return cached(baseCache, seasonId, async () => {
    const [epsRes, castRes, teamsRes] = await Promise.all([
      supabase
        .from('episodes')
        .select('id, number, status, is_finale, bounty_contestant_id, locks_at')
        .eq('season_id', seasonId),
      supabase.from('contestants').select('id, eliminated_episode_id').eq('season_id', seasonId),
      supabase.from('teams').select('id').eq('season_id', seasonId).eq('is_test', false),
    ])
    if (epsRes.error || castRes.error || teamsRes.error)
      throw epsRes.error ?? castRes.error ?? teamsRes.error
    return {
      eps: (epsRes.data ?? []) as SeasonEpisode[],
      cast: (castRes.data ?? []) as SeasonCastaway[],
      teamIds: (teamsRes.data ?? []).map((t) => t.id as string),
    }
  })
}

// Every contestant's season points (starting at 0, so castaways with none rank).
function fetchTotals(seasonId: string, cast: SeasonCastaway[]) {
  return cached(totalsCache, seasonId, async () => {
    const totals = new Map<string, number>(cast.map((c) => [c.id, 0]))
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabase
        .from('contestant_actions')
        .select('contestant_id, count, action_types(points), contestants!inner(season_id)')
        .eq('contestants.season_id', seasonId)
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) throw error
      for (const a of page ?? []) {
        const pts = (a.action_types as unknown as { points: number } | null)?.points ?? 0
        totals.set(a.contestant_id, (totals.get(a.contestant_id) ?? 0) + pts * a.count)
      }
      if (!page || page.length < PAGE) break
    }
    return totals
  })
}

// Current rosters only (an open-ended record), so it reflects swaps.
function fetchRosters(seasonId: string, teamIds: string[]) {
  return cached(rostersCache, seasonId, async () => {
    const { data, error } = await supabase
      .from('team_players')
      .select('contestant_id, role')
      .in('team_id', teamIds)
      .is('effective_to_episode', null)
    if (error) throw error
    return data ?? []
  })
}

// Every league team's bounty picks, grouped per team.
function fetchPicks(seasonId: string, teamIds: string[]) {
  return cached(picksCache, seasonId, async () => {
    const inLeague = new Set(teamIds)
    const byTeam = new Map<string, BountyPick[]>()
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabase
        .from('bounty_picks')
        .select('team_id, contestant_id, effective_from_episode')
        .eq('season_id', seasonId)
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) throw error
      for (const p of page ?? []) {
        if (!inLeague.has(p.team_id)) continue
        const list = byTeam.get(p.team_id) ?? []
        list.push(p)
        byTeam.set(p.team_id, list)
      }
      if (!page || page.length < PAGE) break
    }
    return [...byTeam.values()]
  })
}

// Competition rank of `mine` among `all` (ties share a place).
function rankOf(mine: number, all: number[]) {
  return {
    rank: 1 + all.filter((t) => t > mine).length,
    tied: all.filter((t) => t === mine).length > 1,
  }
}

// The season has started once any episode is airing, completed, or past its lock
// time — the same moment the leaderboard starts revealing locked picks.
function seasonStarted(eps: SeasonEpisode[]) {
  const now = Date.now()
  return eps.some(
    (e) =>
      e.status === 'active' ||
      e.status === 'completed' ||
      (e.locks_at != null && Date.parse(e.locks_at) <= now),
  )
}

// The last resolved episode: completed, and either voted someone out or (the
// finale) has a winner set — the same rule the leaderboard scores bounties by.
function lastResolvedEpisode({ eps, cast }: SeasonBase) {
  const elimEps = new Set(cast.map((c) => c.eliminated_episode_id).filter(Boolean))
  return (
    eps
      .filter(
        (e) =>
          e.status === 'completed' && (e.is_finale ? !!e.bounty_contestant_id : elimEps.has(e.id)),
      )
      .sort((a, b) => b.number - a.number)[0] ?? null
  )
}

// Info tab: League Picks (MVP / Player / Bounty). Runs on open.
async function loadLeaguePicks() {
  const forId = props.contestant?.id
  if (!forId) return
  rostership.value = null
  bountyCount.value = null
  status.value = null
  try {
    const seasonId = await fetchSeasonId(forId)
    if (!seasonId) return
    const base = await fetchBase(seasonId)
    if (props.contestant?.id !== forId) return
    const elimEpId = base.cast.find((c) => c.id === forId)?.eliminated_episode_id ?? null
    status.value = {
      out: !!elimEpId,
      episode: elimEpId ? (base.eps.find((e) => e.id === elimEpId)?.number ?? null) : null,
    }
    // Hidden in preseason: how the league is drafting stays secret until then.
    if (!seasonStarted(base.eps) || !base.teamIds.length) return
    const last = lastResolvedEpisode(base)
    const [rosters, picks] = await Promise.all([
      fetchRosters(seasonId, base.teamIds),
      // Only needed once a bounty has resolved.
      last ? fetchPicks(seasonId, base.teamIds) : Promise.resolve(null),
    ])
    // Ignore a stale response if the modal moved on to another contestant.
    if (props.contestant?.id !== forId || !rosters.length) return
    const mine = rosters.filter((r) => r.contestant_id === forId)
    rostership.value = {
      mvp: mine.filter((r) => r.role === 'mvp').length,
      player: mine.filter((r) => r.role !== 'mvp').length,
    }
    if (last && picks) {
      // Append-only picks: a team's pick for episode N is its latest pick
      // effective on or before N.
      let count = 0
      for (const teamPicks of picks) {
        let pick: BountyPick | null = null
        for (const p of teamPicks) {
          if (
            p.effective_from_episode <= last.number &&
            (!pick || p.effective_from_episode > pick.effective_from_episode)
          )
            pick = p
        }
        if (pick?.contestant_id === forId) count += 1
      }
      bountyCount.value = count
    }
  } catch {
    // Leave the tiles hidden / "—"; the next open retries.
  }
}

// Scoring tab: Total Score + Castaway Rank. Runs the first time that tab opens.
async function loadStanding() {
  const forId = props.contestant?.id
  if (!forId) return
  standingLoading.value = true
  seasonStats.value = null
  try {
    const seasonId = await fetchSeasonId(forId)
    if (!seasonId) return
    const { cast } = await fetchBase(seasonId)
    const totals = await fetchTotals(seasonId, cast)
    if (props.contestant?.id !== forId) return
    const mine = totals.get(forId) ?? 0
    seasonStats.value = { total: mine, ...rankOf(mine, [...totals.values()]) }
  } catch {
    // Tiles show "—"; reopening the tab retries.
  } finally {
    if (props.contestant?.id === forId) standingLoading.value = false
  }
}

// Votes tab header tiles. Voting record = the share of votes cast for someone who
// went home that episode (and weren't nullified), out of every vote cast. Votes against =
// votes cast at them that counted, with any nullified ones (e.g. an idol) kept
// separate.
const voteSummary = computed(() => {
  let cast = 0
  let successful = 0
  let against = 0
  let againstNullified = 0
  for (const ep of votes.value) {
    for (const v of ep.votedFor) {
      cast += 1
      if (v.success && !v.nullified) successful += 1
    }
    for (const v of ep.votedBy) {
      if (v.nullified) againstNullified += 1
      else against += 1
    }
  }
  return { cast, successful, against, againstNullified }
})

// Always land on Info when the modal opens or the contestant changes, and (re)load
// the voting record / League Picks when those are enabled. Immediate, so a modal
// that mounts already open (e.g. after a hot reload) still loads them. The
// Scoring tab's standing is cleared here and loaded on first visit (below).
watch(
  () => [props.show, props.contestant?.id],
  () => {
    activeTab.value = 'info'
    seasonStats.value = null
    if (props.show && props.showVotes && props.contestant) loadVotes()
    if (props.show && props.showEventLog && props.contestant) loadLeaguePicks()
  },
  { immediate: true },
)
// Load the Scoring tab's Total Score / Castaway Rank the first time it's opened
// for this contestant (cached per season, so later contestants are instant).
watch(activeTab, (tab) => {
  if (tab === 'events' && props.show && props.contestant && !seasonStats.value) loadStanding()
})

// Events grouped by episode, newest first, with a per-episode point subtotal.
const eventsByEpisode = computed(() => {
  const groups = new Map<number, ContestantEventItem[]>()
  for (const e of props.events) {
    if (!groups.has(e.episodeNumber)) groups.set(e.episodeNumber, [])
    groups.get(e.episodeNumber)!.push(e)
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([episodeNumber, items]) => ({
      episodeNumber,
      items,
      subtotal: items.reduce((s, i) => s + i.points * i.count, 0),
    }))
})

function fmtPts(n: number) {
  const s = n.toFixed(1)
  return n > 0 ? `+${s}` : s
}

// The header shows the alt image when set, falling back to the main photo. It's
// cropped to cover, anchored to the top so the contestant's face stays in frame.
const headerImage = computed(
  () => props.contestant?.alt_image ?? props.contestant?.photo_url ?? null,
)

// Turn any common YouTube link (watch?v=, youtu.be/, /embed/, /shorts/) into a
// privacy-friendly embed URL. Returns null for empty or unrecognized values so
// the video block only renders when we have something playable.
const embedUrl = computed(() => {
  const url = props.contestant?.video_url?.trim()
  if (!url) return null
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m?.[1]) return `https://www.youtube-nocookie.com/embed/${m[1]}`
  }
  return null
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="show && contestant"
        class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
        @click.self="emit('close')"
      >
        <div
          ref="scrollEl"
          class="bg-stone-900 rounded-2xl border border-stone-700 w-full max-w-md overflow-y-auto shadow-2xl max-h-[90vh]"
          @scroll="onScroll"
        >
          <!-- Photo — scrolls away with the rest of the content -->
          <div class="relative h-72 overflow-hidden bg-stone-800">
            <img
              v-if="headerImage"
              :src="headerImage"
              :alt="displayName(contestant)"
              class="absolute inset-0 h-full w-full object-cover object-[center_10%]"
            />
            <div v-else class="absolute inset-0 flex items-center justify-center">
              <i class="fa-solid fa-user text-8xl text-stone-600"></i>
            </div>
            <div
              class="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/10 to-transparent"
            />
            <!-- Tribe accent bar -->
            <div
              class="absolute bottom-0 left-0 right-0 h-1"
              :style="{ backgroundColor: colors?.primary }"
            />
            <!-- Close button over the photo (until the header sticks) -->
            <button
              class="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-opacity hover:bg-black/90"
              :class="stuck ? 'pointer-events-none opacity-0' : 'opacity-100'"
              @click="emit('close')"
            >
              <i class="fa-solid fa-xmark text-base"></i>
            </button>
          </div>

          <!-- Identity + tabs: sticks to the top of the modal once the photo
               scrolls past it. Opaque background so content scrolls underneath. -->
          <div class="sticky top-0 z-20 border-b border-stone-800 bg-stone-900">
            <div class="flex items-start justify-between gap-3 px-5 pt-4">
              <div>
                <h2 class="text-2xl font-bold text-white">
                  {{ displayName(contestant)
                  }}<span v-if="contestant.age">, {{ contestant.age }}</span>
                </h2>
                <div class="flex items-center gap-2 mt-1 flex-wrap">
                  <span class="text-sm font-semibold" :style="{ color: colors?.text }">{{
                    contestant.tribe
                  }}</span>
                  <!-- Status chip: green dot = still in the game, red = voted out -->
                  <span
                    v-if="status"
                    class="inline-flex items-center gap-1.5 rounded-full bg-stone-800 px-2.5 py-0.5 text-xs font-medium text-text-subtle"
                  >
                    <span
                      aria-hidden="true"
                      class="h-2 w-2 rounded-full"
                      :class="status.out ? 'bg-red-400' : 'bg-emerald-400'"
                    ></span>
                    {{
                      status.out
                        ? `Voted Out${status.episode != null ? ` E${status.episode}` : ''}`
                        : 'In the Game'
                    }}
                  </span>
                </div>
              </div>
              <!-- Close button in the header — appears once the bar is stuck -->
              <button
                class="-mr-1.5 shrink-0 rounded-full p-1.5 text-stone-400 transition-opacity hover:bg-stone-800 hover:text-white"
                :class="stuck ? 'opacity-100' : 'pointer-events-none opacity-0'"
                @click="emit('close')"
              >
                <i class="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <!-- Tabs -->
            <div v-if="tabs.length > 1" class="mt-3 flex gap-4 px-5">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                class="-mb-px border-b-2 pb-2 text-sm font-semibold transition-colors"
                :class="
                  activeTab === tab.id
                    ? 'border-white text-white'
                    : 'border-transparent text-stone-500 hover:text-stone-300'
                "
                @click="activeTab = tab.id"
              >
                {{ tab.label }}
              </button>
            </div>
            <div v-else class="h-4"></div>
          </div>

          <!-- Content -->
          <div class="p-5">
            <!-- ── Info tab ── -->
            <template v-if="activeTab === 'info'">
              <!-- League picks at a glance: teams with this contestant as MVP, as a
                   regular player, and as their bounty in the last resolved episode.
                   Hidden in preseason with the roster data (rostership stays null).
                   Each tile is tinted with its series color: MVP gold, player blue,
                   bounty red — the same colors as the dashboard charts — with text in
                   a light shade of it (≥7:1 contrast on the tint, both themes). -->
              <template v-if="rostership">
                <p class="text-xs text-stone-500 mb-2 uppercase tracking-wide">League Picks</p>
                <div class="grid grid-cols-3 gap-2 mb-4">
                  <div class="bg-chart-mvp/20 rounded-lg p-3 text-center">
                    <p class="font-semibold text-[#f3d58f] text-xl leading-snug tabular-nums">
                      {{ rostership.mvp }}
                    </p>
                    <p class="mt-0.5 text-xs text-[#f3d58f] uppercase tracking-wide">MVP</p>
                  </div>
                  <div class="bg-chart-player/20 rounded-lg p-3 text-center">
                    <p class="font-semibold text-[#9cc6f7] text-xl leading-snug tabular-nums">
                      {{ rostership.player }}
                    </p>
                    <p class="mt-0.5 text-xs text-[#9cc6f7] uppercase tracking-wide">Player</p>
                  </div>
                  <div class="bg-survivor-bounty/20 rounded-lg p-3 text-center">
                    <p class="font-semibold text-[#f3a5a5] text-xl leading-snug tabular-nums">
                      {{ bountyCount ?? '—' }}
                    </p>
                    <p class="mt-0.5 text-xs text-[#f3a5a5] uppercase tracking-wide">Bounty</p>
                  </div>
                </div>
              </template>

              <!-- About: hometown + occupation -->
              <p class="text-xs text-stone-500 mb-2 uppercase tracking-wide">About</p>
              <div class="grid grid-cols-2 gap-2 mb-4">
                <div class="bg-stone-800 rounded-lg p-3 text-left">
                  <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Hometown</p>
                  <p class="font-semibold text-white text-sm leading-snug line-clamp-2">
                    {{ contestant.hometown ?? 'TBD' }}
                  </p>
                </div>
                <div class="bg-stone-800 rounded-lg p-3 text-left">
                  <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Occupation</p>
                  <p class="font-semibold text-white text-sm leading-snug line-clamp-2">
                    {{ contestant.occupation ?? 'TBD' }}
                  </p>
                </div>
              </div>

              <!-- Video -->
              <div v-if="embedUrl" class="mb-4">
                <p class="text-xs text-stone-500 mb-2 uppercase tracking-wide">Video</p>
                <div class="relative aspect-video overflow-hidden rounded-xl bg-stone-800">
                  <iframe
                    :src="embedUrl"
                    :title="`${displayName(contestant)} video`"
                    class="absolute inset-0 h-full w-full"
                    frameborder="0"
                    allow="
                      accelerometer;
                      autoplay;
                      clipboard-write;
                      encrypted-media;
                      gyroscope;
                      picture-in-picture;
                      web-share;
                    "
                    allowfullscreen
                  />
                </div>
              </div>

              <!-- Bio -->
              <div class="bg-stone-800 rounded-xl p-4">
                <p class="text-xs text-stone-500 mb-2 uppercase tracking-wide">About</p>
                <p class="text-sm text-stone-200 leading-relaxed">
                  {{
                    contestant.bio ?? 'No bio available yet. Check back after the season premieres.'
                  }}
                </p>
              </div>
            </template>

            <!-- ── Scoring tab (the contestant's event log) ── -->
            <template v-else-if="activeTab === 'events'">
              <!-- Season standing, styled like the Info tab's Hometown/Occupation -->
              <div class="grid grid-cols-2 gap-2 mb-4">
                <div class="bg-stone-800 rounded-lg p-3 text-left">
                  <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Total Score</p>
                  <p class="font-semibold text-white text-sm leading-snug tabular-nums">
                    {{
                      seasonStats
                        ? `${seasonStats.total.toFixed(1)} pts`
                        : standingLoading
                          ? '…'
                          : '—'
                    }}
                  </p>
                </div>
                <div class="bg-stone-800 rounded-lg p-3 text-left">
                  <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Castaway Rank</p>
                  <p class="font-semibold text-white text-sm leading-snug tabular-nums">
                    <template v-if="seasonStats">{{
                      formatPlace(seasonStats.rank, seasonStats.tied)
                    }}</template>
                    <template v-else>{{ standingLoading ? '…' : '—' }}</template>
                  </p>
                </div>
              </div>

              <div v-if="eventsLoading" class="py-8 text-center text-sm text-stone-500">
                Loading events…
              </div>
              <div
                v-else-if="eventsByEpisode.length === 0"
                class="py-8 text-center text-sm text-stone-500"
              >
                No scored events yet.
              </div>
              <div v-else class="space-y-4">
                <div v-for="group in eventsByEpisode" :key="group.episodeNumber">
                  <p class="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Episode {{ group.episodeNumber }}
                  </p>
                  <div class="overflow-hidden">
                    <div
                      v-for="(item, i) in group.items"
                      :key="i"
                      class="flex items-center justify-between border-b border-stone-700/60 py-2 last:border-0"
                    >
                      <p class="text-sm font-medium text-stone-200">
                        {{ item.label }}
                        <span v-if="item.count > 1" class="text-stone-500">×{{ item.count }}</span>
                      </p>
                      <p
                        class="text-sm font-semibold tabular-nums"
                        :class="item.points >= 0 ? 'text-emerald-400' : 'text-red-400'"
                      >
                        {{ fmtPts(item.points * item.count) }}
                      </p>
                    </div>
                  </div>
                  <!-- Episode total, summing the events above it -->
                  <div class="flex items-center justify-between border-t border-stone-600 py-2">
                    <p class="text-sm font-medium text-stone-200">Total</p>
                    <p
                      class="text-sm font-semibold tabular-nums"
                      :class="group.subtotal >= 0 ? 'text-emerald-400' : 'text-red-400'"
                    >
                      {{ fmtPts(group.subtotal) }}
                    </p>
                  </div>
                </div>
              </div>
            </template>

            <!-- ── Votes tab ── -->
            <template v-else-if="activeTab === 'votes'">
              <div v-if="votesLoading" class="py-8 text-center text-sm text-stone-500">
                Loading votes…
              </div>
              <div v-else-if="votes.length === 0" class="py-8 text-center text-sm text-stone-500">
                No votes recorded yet.
              </div>
              <template v-else>
                <!-- Season voting summary, styled like the Scoring tab's tiles -->
                <div class="grid grid-cols-2 gap-2 mb-4">
                  <div class="bg-stone-800 rounded-lg p-3 text-left">
                    <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Voting Record</p>
                    <p
                      class="flex items-center gap-2 font-semibold text-white text-sm leading-snug tabular-nums"
                    >
                      <template v-if="voteSummary.cast">
                        <span
                          >{{
                            Math.round((voteSummary.successful / voteSummary.cast) * 100)
                          }}%</span
                        >
                        <!-- Vertical divider between the percentage and the fraction -->
                        <span aria-hidden="true" class="h-3.5 w-px bg-stone-600"></span>
                        <span class="font-normal text-stone-400"
                          >{{ voteSummary.successful }}/{{ voteSummary.cast }}</span
                        >
                      </template>
                      <template v-else>—</template>
                    </p>
                  </div>
                  <div class="bg-stone-800 rounded-lg p-3 text-left">
                    <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Votes Against</p>
                    <p class="font-semibold text-white text-sm leading-snug tabular-nums">
                      {{ voteSummary.against }}
                      <span v-if="voteSummary.againstNullified" class="font-normal text-stone-400"
                        >+{{ voteSummary.againstNullified }} nullified</span
                      >
                    </p>
                  </div>
                </div>
                <div class="space-y-3">
                  <!-- The episode they were voted out in gets a red border (every block
                       carries a border so the highlighted one doesn't shift). -->
                  <div
                    v-for="group in votes"
                    :key="group.episodeNumber"
                    class="rounded-xl border bg-stone-800 p-5"
                    :class="
                      status?.out && status.episode === group.episodeNumber
                        ? 'border-red-400'
                        : 'border-transparent'
                    "
                  >
                    <!-- Episode label above the vote parchment(s), stacked -->
                    <div class="flex flex-col gap-3">
                      <p class="text-xs font-semibold uppercase tracking-wide text-text-default">
                        Episode {{ group.episodeNumber }}
                      </p>
                      <div v-if="group.votedFor.length" class="flex flex-wrap justify-start gap-2">
                        <div v-for="(v, i) in group.votedFor" :key="i" class="relative w-28">
                          <img
                            :src="parchmentUrl"
                            alt=""
                            aria-hidden="true"
                            class="w-full select-none"
                            :class="v.nullified ? 'opacity-75' : ''"
                          />
                          <span
                            class="absolute inset-0 flex items-center justify-center px-4 text-center font-handwritten text-base leading-tight text-material-parchment-ink"
                            :class="v.nullified ? 'line-through' : ''"
                            >{{ v.name }}</span
                          >
                          <!-- Outcome: did the person they voted for go home this episode? -->
                          <i
                            class="absolute -right-1 -top-1 rounded-full bg-white text-base"
                            :class="
                              v.success
                                ? 'fa-solid fa-circle-check text-emerald-400'
                                : 'fa-solid fa-circle-xmark text-red-400'
                            "
                            :title="v.success ? 'Voted out this episode' : 'Survived the vote'"
                          ></i>
                        </div>
                      </div>
                    </div>

                    <!-- Voted by: who voted for this contestant, or a note that nobody did -->
                    <div v-if="group.votedBy.length" class="mt-2">
                      <p class="mb-1 text-xs text-text-subtle">Voted by</p>
                      <p class="text-sm text-stone-200">
                        <span v-for="(v, i) in group.votedBy" :key="i">
                          <span :class="v.nullified ? 'text-stone-500 line-through' : ''">{{
                            v.name
                          }}</span
                          ><span v-if="i < group.votedBy.length - 1">, </span>
                        </span>
                      </p>
                    </div>
                    <p v-else class="mt-4 text-xs text-text-subtle">No votes against</p>
                  </div>
                </div>
              </template>
            </template>
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
