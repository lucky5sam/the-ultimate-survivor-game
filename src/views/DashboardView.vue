<script setup lang="ts">
// League home screen — a summary/dashboard that greets players when they open
// the app. Four stacked sections, all derived from data the app already
// computes (no new scoring logic):
//   1. Your team snapshot   — your place, score, and current roster
//   2. Bounties (row of 3)   — your last result, league breakdown, next pick + countdown
//   3. Standings preview     — top teams, your own row highlighted
//   4. Latest episode recap  — eliminations, biggest movers, bounty hits
//
// Everything hangs off computeLeaderboard(): one full-season call powers the
// snapshot + standings, and two episode-capped calls diff last episode against
// the one before it to find the biggest movers (the same weekly-delta trick the
// admin Weekly Export uses).
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useSeasonStore } from '../stores/season'
import { useAuthStore } from '../stores/auth'
import { computeLeaderboard, type LeaderboardRow } from '../composables/useLeaderboard'
import { displayName } from '../utils/contestantName'
import { formatPlace, ordinal } from '../utils/place'
import BaseCard from '../components/base/BaseCard.vue'
import BaseButton from '../components/base/BaseButton.vue'
import LoadingState from '../components/LoadingState.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import ContestantAvatar from '../components/ContestantAvatar.vue'
import parchmentUrl from '../assets/survivor_decor_parchment.svg'

type Episode = {
  id: string
  number: number
  title: string | null
  status: string
  is_finale: boolean
  is_merge: boolean
  locks_at: string | null
  air_date: string | null
  bounty_contestant_id: string | null
}
type Mover = { teamId: string; teamName: string | null; delta: number }
type BountyHit = { teamName: string | null; name: string | null }
type PopularPick = { name: string; count: number; hit: boolean; photoUrl: string | null }
type ContestantRow = {
  id: string
  first_name: string
  last_name: string | null
  preferred_name: string | null
  photo_url: string | null
  eliminated_episode_id: string | null
}

const seasonStore = useSeasonStore()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const loading = ref(false)
const errorMsg = ref('')

const rows = ref<LeaderboardRow[]>([])
const myRow = ref<LeaderboardRow | null>(null)
const nextEpisode = ref<Episode | null>(null)
const recapEpisode = ref<Episode | null>(null)
const eliminated = ref<string[]>([])
const movers = ref<Mover[]>([])
const bountyHits = ref<BountyHit[]>([])

// Last-episode bounty breakdown — from the most-recent resolved episode (an
// elimination, or a finale winner). Drives the "League bounties" card.
const lastBountyEpisodeNumber = ref<number | null>(null)
const lastBountyEpisodeName = ref<string | null>(null)
const bountyPicksCount = ref(0)
const bountyHitsCount = ref(0)
const bountySuccessRate = ref<number | null>(null)
const popularPicks = ref<PopularPick[]>([])
// Photo of the viewer's last-bounty pick (the wanted-poster mugshot).
const myLastBountyPhoto = ref<string | null>(null)

// Ticking clock so the next-episode countdown updates live without a reload.
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | undefined

// Drop stale responses if the season changes mid-fetch.
let loadSeq = 0

function fmtPts(n: number) {
  return n.toFixed(1)
}
function fmtDelta(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`
}

// The viewer's own name for the team-snapshot subtitle (email as a last resort),
// matching the header's owner-name logic.
const ownerName = computed(() =>
  auth.firstName || auth.lastName
    ? `${auth.firstName} ${auth.lastName}`.trim()
    : (auth.user?.email ?? ''),
)

// Roster for the snapshot: MVP always first, then by points descending. A copy,
// so we never reorder the shared players array other views read.
const myRoster = computed(() =>
  myRow.value
    ? [...myRow.value.players].sort(
        (a, b) => Number(b.isMvp) - Number(a.isMvp) || b.points - a.points,
      )
    : [],
)

// The top 5 standings rows (already sorted by rank in computeLeaderboard).
const topStandings = computed(() => rows.value.slice(0, 5))
// True when the viewer's own team sits outside the top 5, so we can append it.
const myRowBelowTop = computed(
  () => !!myRow.value && !topStandings.value.some((r) => r.teamId === myRow.value!.teamId),
)

// The viewer's own pick + result for the last resolved episode.
const myLastBounty = computed(() =>
  myRow.value?.lastBountyName
    ? { name: myRow.value.lastBountyName, hit: myRow.value.lastBountyHit === true }
    : null,
)

// The viewer's standing pick for the upcoming episode: the locked pick once the
// episode locks, otherwise their carried-forward (still editable) pick.
const bountyPickName = computed(
  () => myRow.value?.currentBountyName ?? myRow.value?.pendingBountyName ?? null,
)

// Human-readable countdown to the next episode's lock time. null when there's
// no lock time set or it has already passed (rendered as "Locked").
const lockCountdown = computed<string | null>(() => {
  const iso = nextEpisode.value?.locks_at
  if (!iso) return null
  const ms = new Date(iso).getTime() - now.value
  if (ms <= 0) return null
  const totalMin = Math.floor(ms / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  const secs = Math.floor((ms % 60000) / 1000)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
})
const nextEpisodeLocked = computed(
  () => !!nextEpisode.value?.locks_at && new Date(nextEpisode.value.locks_at).getTime() <= now.value,
)

function reset() {
  rows.value = []
  myRow.value = null
  nextEpisode.value = null
  recapEpisode.value = null
  eliminated.value = []
  movers.value = []
  bountyHits.value = []
  lastBountyEpisodeNumber.value = null
  lastBountyEpisodeName.value = null
  bountyPicksCount.value = 0
  bountyHitsCount.value = 0
  bountySuccessRate.value = null
  popularPicks.value = []
  myLastBountyPhoto.value = null
}

// DEV-ONLY: fill every section with believable fake data so the layout can be
// eyeballed without real episodes. Tweak the numbers/names here to preview other
// states (a missed bounty, a locked episode, etc.). Deleting this function and
// its caller removes the feature entirely.
function loadMock() {
  const player = (
    name: string,
    tribe: string,
    isMvp: boolean,
    points: number,
    out = false,
  ) => ({ contestantId: name, name, photoUrl: null, tribe, isMvp, points, out })

  const myPlayers = [
    player('Jesse', 'Reba', true, 34.5),
    player('Carolyn', 'Belo', false, 22),
    player('Kaleb', 'Reba', false, 15),
    player('Bruce', 'Lulu', false, 0, true),
  ]

  const row = (
    i: number,
    teamName: string,
    totalPoints: number,
    extra: Partial<LeaderboardRow> = {},
  ): LeaderboardRow => ({
    teamId: `mock-${i}`,
    teamName,
    teamImageUrl: null,
    teamEmoji: '🔥',
    teamColor: '#e07b39',
    ownerId: `owner-${i}`,
    ownerName: teamName,
    players: [],
    actionPoints: totalPoints,
    bountyPoints: 0,
    swapPenalty: 0,
    totalPoints,
    rank: i,
    tied: false,
    currentBountyName: null,
    pendingBountyName: null,
    lastBountyName: null,
    lastBountyHit: null,
    lastBountyContestantId: null,
    ...extra,
  })

  const board = [
    row(1, 'Sole Survivors', 128.5, { lastBountyName: 'Bruce', lastBountyHit: true }),
    row(2, 'Torch Snuffers', 112, { lastBountyName: 'Kaleb', lastBountyHit: false }),
    row(3, "Sam's Squad", 98.5, {
      ownerId: 'me',
      players: myPlayers,
      lastBountyName: 'Bruce',
      lastBountyHit: true,
      pendingBountyName: 'Kaleb',
    }),
    row(4, 'Immunity Idols', 95, { lastBountyName: 'Emily', lastBountyHit: false }),
    row(5, 'Merge Meat', 88, { lastBountyName: 'Bruce', lastBountyHit: true }),
    row(6, 'Fire Makers', 71, { lastBountyName: 'Kaleb', lastBountyHit: false }),
    row(7, 'Hidden Advantages', 64, { lastBountyName: 'Emily', lastBountyHit: false }),
    row(8, 'The Outcasts', 40, { lastBountyName: 'Bruce', lastBountyHit: true }),
  ]

  rows.value = board
  myRow.value = board[2]!

  const soon = new Date(Date.now() + 26 * 3600_000).toISOString() // ~1d 2h out
  const nextEp: Episode = {
    id: 'mock-ep-6',
    number: 6,
    title: 'The Merge',
    status: 'upcoming',
    is_finale: false,
    is_merge: true,
    locks_at: soon,
    air_date: null,
    bounty_contestant_id: null,
  }
  nextEpisode.value = nextEp

  // Last-episode bounty breakdown (Ep 5).
  lastBountyEpisodeNumber.value = 5
  lastBountyEpisodeName.value = 'Blindside'
  bountyPicksCount.value = 28
  bountyHitsCount.value = 9
  bountySuccessRate.value = Math.round((9 / 28) * 100)
  const samplePhoto =
    'https://ahxxekjyadqlowwbocoi.supabase.co/storage/v1/object/public/contestant-photos/S51_Profile_Linnea.png'
  popularPicks.value = [
    { name: 'Bruce', count: 12, hit: true, photoUrl: samplePhoto },
    { name: 'Kaleb', count: 7, hit: false, photoUrl: samplePhoto },
    { name: 'Emily', count: 5, hit: false, photoUrl: samplePhoto },
    { name: 'Q', count: 3, hit: false, photoUrl: samplePhoto },
    { name: 'Charlie', count: 1, hit: false, photoUrl: samplePhoto },
  ]

  // Recap (Ep 5).
  recapEpisode.value = { ...nextEp, id: 'mock-ep-5', number: 5, title: 'Blindside' }
  eliminated.value = ['Bruce Perreault', 'Brandon Donlon']
  movers.value = [
    { teamId: 'mock-2', teamName: 'Torch Snuffers', delta: 28 },
    { teamId: 'mock-1', teamName: 'Sole Survivors', delta: 19.5 },
    { teamId: 'mock-3', teamName: "Sam's Squad", delta: 12 },
  ]
  bountyHits.value = [
    { teamName: 'Sole Survivors', name: 'Bruce' },
    { teamName: 'Merge Meat', name: 'Bruce' },
    { teamName: 'The Outcasts', name: 'Bruce' },
  ]

  // No real contestant here, so we hardcode a sample photo URL to preview the
  // sepia poster. Set back to null to see the person-icon fallback.
  myLastBountyPhoto.value =
    'https://ahxxekjyadqlowwbocoi.supabase.co/storage/v1/object/public/contestant-photos/S51_Profile_Linnea.png'

  loading.value = false
  errorMsg.value = ''
}

async function load() {
  // DEV-ONLY preview: visit /dashboard?mock=1 with `npm run dev` to render every
  // card from fake data, without touching real episode data. `import.meta.env.DEV`
  // is hard-coded false in a production build, so this whole branch is stripped
  // out and the ?mock flag does nothing on the live site.
  if (import.meta.env.DEV && route.query.mock) {
    loadMock()
    return
  }

  const seasonId = seasonStore.selectedSeasonId
  if (!seasonId) {
    reset()
    return
  }
  const seq = ++loadSeq
  loading.value = true
  errorMsg.value = ''
  const myUid = auth.user?.id ?? null
  try {
    // Episodes first — their statuses tell us which episode is "next" and which
    // was the most recent to complete (the recap subject + delta baseline).
    const { data: eps, error: epErr } = await supabase
      .from('episodes')
      .select('id, number, title, status, is_finale, is_merge, locks_at, air_date, bounty_contestant_id')
      .eq('season_id', seasonId)
      .order('number')
    if (epErr) throw new Error(epErr.message)
    const episodes = (eps ?? []) as Episode[]

    const next = episodes.filter((e) => e.status !== 'completed').sort((a, b) => a.number - b.number)
    const completed = episodes.filter((e) => e.status === 'completed').sort((a, b) => b.number - a.number)
    const latestEp = completed[0] ?? null
    const prevEpNum = completed[1]?.number ?? null

    // Full-season standings (with the viewer's pending bounty revealed), plus the
    // two capped snapshots for the movers diff, and every contestant's
    // elimination episode (for recap names + resolving which episodes counted) —
    // all in parallel. Everything past `board` is best-effort for the recap.
    const [board, cur, prior, contestantsRes] = await Promise.all([
      computeLeaderboard(seasonId, null, myUid),
      latestEp ? computeLeaderboard(seasonId, latestEp.number) : Promise.resolve(null),
      prevEpNum != null ? computeLeaderboard(seasonId, prevEpNum) : Promise.resolve(null),
      supabase
        .from('contestants')
        .select('id, first_name, last_name, preferred_name, photo_url, eliminated_episode_id')
        .eq('season_id', seasonId),
    ])
    if (seq !== loadSeq) return

    rows.value = board
    myRow.value = myUid ? (board.find((r) => r.ownerId === myUid) ?? null) : null
    nextEpisode.value = next[0] ?? null

    // Eliminations keyed by episode — powers recap names and tells us which
    // episodes actually resolved a bounty.
    const contestants = (contestantsRes.data ?? []) as ContestantRow[]
    const elimNamesByEp = new Map<string, string[]>()
    const epsWithElim = new Set<string>()
    const photoById = new Map<string, string | null>()
    for (const c of contestants) {
      photoById.set(c.id, c.photo_url ?? null)
      if (!c.eliminated_episode_id) continue
      epsWithElim.add(c.eliminated_episode_id)
      const arr = elimNamesByEp.get(c.eliminated_episode_id) ?? []
      arr.push(displayName(c))
      elimNamesByEp.set(c.eliminated_episode_id, arr)
    }
    // The viewer's last-bounty pick photo, for the wanted-poster card.
    myLastBountyPhoto.value = myRow.value?.lastBountyContestantId
      ? (photoById.get(myRow.value.lastBountyContestantId) ?? null)
      : null

    // ── Last-episode bounty breakdown ──
    // The most-recent completed episode that resolved (voted someone out, or a
    // finale with a set winner) — the subject of everyone's "last bounty".
    const lastResolvedEp =
      completed.find((e) => (e.is_finale ? !!e.bounty_contestant_id : epsWithElim.has(e.id))) ?? null
    lastBountyEpisodeNumber.value = lastResolvedEp?.number ?? null
    lastBountyEpisodeName.value = lastResolvedEp?.title ?? null
    // Every team's pick + result for that episode (lastBounty* on each row).
    const picks = board.filter((r) => r.lastBountyName)
    const hits = picks.filter((r) => r.lastBountyHit === true)
    bountyPicksCount.value = picks.length
    bountyHitsCount.value = hits.length
    bountySuccessRate.value = picks.length ? Math.round((hits.length / picks.length) * 100) : null
    // Most-picked contestants, keyed by id (a shared pick shares its result).
    const tally = new Map<string, PopularPick>()
    for (const r of picks) {
      const id = r.lastBountyContestantId
      if (!id) continue
      const t: PopularPick = tally.get(id) ?? {
        name: r.lastBountyName as string,
        count: 0,
        hit: r.lastBountyHit === true,
        photoUrl: photoById.get(id) ?? null,
      }
      t.count += 1
      tally.set(id, t)
    }
    popularPicks.value = [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 5)

    // ── Latest episode recap ──
    recapEpisode.value = latestEp
    if (latestEp) {
      eliminated.value = elimNamesByEp.get(latestEp.id) ?? []
      // Teams whose bounty pick hit in the most-recent resolved episode.
      bountyHits.value = board
        .filter((r) => r.lastBountyHit === true)
        .map((r) => ({ teamName: r.teamName, name: r.lastBountyName }))
      // Biggest movers = last-episode total minus prior-episode total. With no
      // prior completed episode, the delta is simply the points earned so far.
      if (cur) {
        const priorTotal: Record<string, number> = {}
        if (prior) for (const r of prior) priorTotal[r.teamId] = r.totalPoints
        movers.value = cur
          .map((r) => ({
            teamId: r.teamId,
            teamName: r.teamName,
            delta: r.totalPoints - (priorTotal[r.teamId] ?? 0),
          }))
          .filter((m) => m.delta !== 0)
          .sort((a, b) => b.delta - a.delta)
          .slice(0, 3)
      }
    }
  } catch (e) {
    if (seq !== loadSeq) return
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the dashboard'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

watch(() => seasonStore.selectedSeasonId, load, { immediate: true })
onMounted(() => {
  seasonStore.load()
  nowTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
})
</script>

<template>
  <div class="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
    <h2 class="mb-6 text-2xl font-bold text-text-default">League Home</h2>

    <p v-if="errorMsg" class="mb-4 text-sm text-status-error">{{ errorMsg }}</p>
    <LoadingState v-if="loading" />

    <div v-else-if="!seasonStore.selectedSeasonId" class="text-sm text-text-muted">
      No active seasons right now.
    </div>

    <div v-else class="flex flex-col gap-6">
      <!-- ── 1. Your team snapshot ─────────────────────────────────────────── -->
      <section v-if="myRow">
        <RouterLink to="/my-team" class="group block">
          <BaseCard padding="md" class="transition-colors group-hover:border-border-strong">
            <div class="flex items-center gap-4">
              <TeamAvatar
                v-if="myRow.teamImageUrl || myRow.teamEmoji"
                :image-url="myRow.teamImageUrl"
                :emoji="myRow.teamEmoji"
                :color="myRow.teamColor"
                :name="myRow.teamName || 'Team'"
                :size="56"
                class="shrink-0 rounded-2xl border border-border-default"
              />
              <div class="min-w-0 flex-1">
                <h3 class="truncate text-lg font-bold text-text-default">
                  {{ myRow.teamName || '(no name)' }}
                </h3>
                <p v-if="ownerName" class="truncate text-sm text-text-subtle">{{ ownerName }}</p>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-2xl font-bold text-text-default">
                  {{ formatPlace(myRow.rank, myRow.tied) }}
                </p>
                <p class="text-sm text-text-subtle">{{ fmtPts(myRow.totalPoints) }} pts</p>
              </div>
            </div>

            <!-- Compact roster: MVP first, eliminated players struck through -->
            <div class="mt-4 flex flex-wrap gap-2">
              <span
                v-for="p in myRoster"
                :key="p.contestantId"
                class="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-subtle py-1 pl-1 pr-2.5 text-sm"
                :class="p.out ? 'text-text-muted' : 'text-text-default'"
              >
                <ContestantAvatar
                  :photo-url="p.photoUrl"
                  :name="p.name"
                  :tribe="p.tribe"
                  :grayscale="p.out"
                  :size="22"
                />
                <i v-if="p.isMvp" class="fa-solid fa-crown text-xs text-survivor-sand"></i>
                <span :class="p.out ? 'line-through' : ''">{{ p.name }}</span>
                <span class="text-xs text-text-subtle">{{ fmtPts(p.points) }}</span>
              </span>
            </div>
          </BaseCard>
        </RouterLink>
      </section>

      <!-- ── 2. Bounties (last result · league breakdown · next pick) ──────── -->
      <section v-if="nextEpisode || bountySuccessRate !== null || myLastBounty">
        <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-text-subtle">Bounties</h3>
        <div class="grid gap-3 sm:grid-cols-3">
          <!-- Your last bounty — wanted-poster mugshot -->
          <BaseCard padding="md" class="flex flex-col">
            <div class="flex items-center justify-between gap-2">
              <p class="text-xs font-medium uppercase tracking-wide text-text-muted">
                Your last bounty<span v-if="lastBountyEpisodeNumber"> · Ep {{ lastBountyEpisodeNumber }}</span>
              </p>
              <span
                v-if="myLastBounty"
                class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="
                  myLastBounty.hit
                    ? 'bg-status-success-surface text-status-success'
                    : 'bg-status-error-surface text-status-error'
                "
              >
                {{ myLastBounty.hit ? 'Hit' : 'Miss' }}
              </span>
            </div>

            <div
              v-if="myLastBounty"
              class="relative mt-3 h-72 w-full overflow-hidden rounded-md border border-border-default bg-surface-strong"
            >
              <!-- Sepia mugshot; the person-icon fallback keeps the tone when a
                   contestant has no photo. -->
              <img
                v-if="myLastBountyPhoto"
                :src="myLastBountyPhoto"
                :alt="myLastBounty.name"
                class="sepia-photo h-full w-full object-cover object-top"
              />
              <div
                v-else
                class="flex h-full w-full items-center justify-center"
                style="filter: sepia(0.6)"
              >
                <i class="fa-solid fa-user text-6xl text-icon-subtle"></i>
              </div>

              <!-- Bounty name on a parchment scroll, pinned to the bottom -->
              <div class="absolute inset-x-0 bottom-0 flex justify-center px-2 pb-2">
                <div class="relative w-full max-w-[12rem]">
                  <img
                    :src="parchmentUrl"
                    alt=""
                    aria-hidden="true"
                    class="w-full select-none [filter:drop-shadow(0_2px_4px_rgba(0,0,0,0.4))]"
                  />
                  <span
                    class="absolute inset-0 flex items-center justify-center px-4 text-center font-handwritten text-lg leading-none text-material-parchment-ink"
                  >
                    {{ myLastBounty.name }}
                  </span>
                </div>
              </div>
            </div>
            <p v-else class="mt-2 text-sm text-text-muted">No bounty resolved yet.</p>
          </BaseCard>

          <!-- League breakdown: success rate + most-picked -->
          <BaseCard padding="md" class="flex flex-col">
            <div>
              <p class="text-sm font-bold text-text-default">League Bounties</p>
              <p v-if="lastBountyEpisodeNumber" class="text-xs text-text-subtle">
                Ep {{ lastBountyEpisodeNumber
                }}<span v-if="lastBountyEpisodeName"> · {{ lastBountyEpisodeName }}</span>
              </p>
            </div>
            <template v-if="bountySuccessRate !== null">
              <p class="mt-1 text-2xl font-bold text-text-default">{{ bountySuccessRate }}%</p>
              <!-- Success-rate bar: green fill on a neutral track -->
              <div class="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-strong">
                <div
                  class="h-full rounded-full bg-status-success transition-[width] duration-500"
                  :style="{ width: `${bountySuccessRate}%` }"
                ></div>
              </div>
              <p class="mt-1.5 text-xs text-text-subtle">
                {{ bountyHitsCount }} of {{ bountyPicksCount }} teams hit
              </p>
              <div v-if="popularPicks.length" class="mt-3 border-t border-border-subtle pt-2">
                <p class="mb-1 text-xs font-medium text-text-subtle">Most Picked</p>
                <div class="flex flex-col gap-1">
                  <div
                    v-for="p in popularPicks"
                    :key="p.name"
                    class="flex items-center gap-1.5 text-sm"
                  >
                    <ContestantAvatar :photo-url="p.photoUrl" :name="p.name" :size="24" sepia />
                    <span class="min-w-0 flex-1 truncate text-text-default">{{ p.name }}</span>
                    <span
                      class="shrink-0 tabular-nums"
                      :class="p.hit ? 'text-status-success' : 'text-text-subtle'"
                      >×{{ p.count }}</span
                    >
                  </div>
                </div>
              </div>
            </template>
            <p v-else class="mt-2 text-sm text-text-muted">No bounties resolved yet.</p>
          </BaseCard>

          <!-- Next episode countdown + update pick -->
          <BaseCard padding="md" class="flex flex-col">
            <p class="text-xs font-medium uppercase tracking-wide text-text-muted">
              {{ nextEpisode?.is_finale ? 'Finale bounty' : 'Next bounty' }}
            </p>
            <template v-if="nextEpisode">
              <p class="mt-1 text-sm font-semibold text-text-default">
                Episode {{ nextEpisode.number }}
              </p>
              <p class="text-xs text-text-muted">
                {{ nextEpisodeLocked ? 'Picks are locked' : 'Locks in' }}
              </p>
              <p
                v-if="!nextEpisodeLocked"
                class="text-lg font-bold text-text-default"
              >
                {{ lockCountdown ?? 'TBD' }}
              </p>
              <div v-if="myRow" class="mt-auto pt-3">
                <BaseButton
                  v-if="!nextEpisodeLocked"
                  size="sm"
                  block
                  @click="router.push('/my-team')"
                >
                  {{ bountyPickName ? 'Update bounty pick' : 'Make bounty pick' }}
                </BaseButton>
                <p v-if="bountyPickName" class="mt-1.5 text-center text-xs text-text-muted">
                  Current: {{ bountyPickName }}
                </p>
                <p v-else-if="nextEpisodeLocked" class="text-center text-xs text-status-warning">
                  No pick locked in
                </p>
              </div>
            </template>
            <p v-else class="mt-2 text-sm text-text-muted">Season complete.</p>
          </BaseCard>
        </div>
      </section>

      <!-- ── 3. Standings preview ──────────────────────────────────────────── -->
      <section v-if="rows.length">
        <div class="mb-2 flex items-baseline justify-between">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-text-subtle">Standings</h3>
          <RouterLink to="/leaderboard" class="text-sm text-text-accent hover:underline">
            Full leaderboard →
          </RouterLink>
        </div>
        <BaseCard padding="none" class="overflow-hidden">
          <RouterLink
            v-for="(row, i) in topStandings"
            :key="row.teamId"
            :to="`/team/${row.teamId}`"
            class="flex items-center gap-4 border-t border-border-subtle px-4 py-3 first:border-t-0 hover:bg-surface-subtle"
            :class="myRow && row.teamId === myRow.teamId ? 'bg-surface-subtle' : ''"
          >
            <span
              class="w-6 shrink-0 text-center text-base font-bold tabular-nums"
              :class="i === 0 ? 'text-survivor-sand' : 'text-text-subtle'"
              >{{ formatPlace(row.rank, row.tied) }}</span
            >
            <span class="flex-1 truncate font-semibold text-text-default">
              {{ row.teamName ?? '(no name)' }}
            </span>
            <span
              class="shrink-0 text-base font-bold tabular-nums"
              :class="row.totalPoints >= 0 ? 'text-text-default' : 'text-status-error'"
              >{{ fmtPts(row.totalPoints) }}</span
            >
          </RouterLink>

          <!-- Your own row, appended when it falls outside the top 5 -->
          <RouterLink
            v-if="myRowBelowTop && myRow"
            :to="`/team/${myRow.teamId}`"
            class="flex items-center gap-4 border-t-2 border-border-default bg-surface-subtle px-4 py-3 hover:opacity-90"
          >
            <span class="w-6 shrink-0 text-center text-base font-bold tabular-nums text-text-subtle">
              {{ formatPlace(myRow.rank, myRow.tied) }}
            </span>
            <span class="flex-1 truncate font-semibold text-text-default">
              {{ myRow.teamName ?? '(no name)' }}
            </span>
            <span class="shrink-0 text-base font-bold tabular-nums text-text-default">
              {{ fmtPts(myRow.totalPoints) }}
            </span>
          </RouterLink>
        </BaseCard>
      </section>

      <!-- ── 4. Latest episode recap ───────────────────────────────────────── -->
      <section v-if="recapEpisode">
        <div class="mb-2">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-text-subtle">
            Episode {{ recapEpisode.number }} recap
          </h3>
        </div>
        <BaseCard padding="md" class="flex flex-col gap-4">
          <!-- Eliminated -->
          <div>
            <p class="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Voted out</p>
            <p v-if="eliminated.length" class="text-sm font-medium text-text-default">
              {{ eliminated.join(', ') }}
            </p>
            <p v-else class="text-sm text-text-muted">No eliminations recorded.</p>
          </div>

          <!-- Biggest movers -->
          <div v-if="movers.length" class="border-t border-border-subtle pt-3">
            <p class="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
              Biggest movers
            </p>
            <div class="flex flex-col gap-1">
              <div
                v-for="(m, i) in movers"
                :key="m.teamId"
                class="flex items-center gap-3 text-sm"
              >
                <span class="w-4 shrink-0 text-center text-text-muted">{{ ordinal(i + 1) }}</span>
                <span class="flex-1 truncate text-text-default">{{ m.teamName ?? '(no name)' }}</span>
                <span
                  class="shrink-0 font-semibold tabular-nums"
                  :class="m.delta >= 0 ? 'text-status-success' : 'text-status-error'"
                  >{{ fmtDelta(m.delta) }}</span
                >
              </div>
            </div>
          </div>

          <!-- Bounty hits -->
          <div v-if="bountyHits.length" class="border-t border-border-subtle pt-3">
            <p class="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
              Bounty hits
            </p>
            <div class="flex flex-col gap-1">
              <div
                v-for="(b, i) in bountyHits"
                :key="i"
                class="flex items-center gap-2 text-sm"
              >
                <i class="fa-solid fa-crosshairs text-xs text-status-success"></i>
                <span class="flex-1 truncate text-text-default">{{ b.teamName ?? '(no name)' }}</span>
                <span class="shrink-0 text-text-subtle">{{ b.name }}</span>
              </div>
            </div>
          </div>
        </BaseCard>
      </section>
    </div>
  </div>
</template>
