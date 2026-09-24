<script setup lang="ts">
// League home screen — a summary/dashboard that greets players when they open
// the app. All derived from data the app already computes (no new scoring logic):
//   Row 1: Your team        — place, points, and a place-by-episode line chart
//          Leaders          — top 6 teams, your own row highlighted
//   Row 2: League picks     — how the league spread its MVPs, bounties, players
//   Row 3: Player scores    — every contestant's points by episode (heatmap)
//
// Everything hangs off ONE computeLeaderboardSnapshots() fetch: the full-season
// standings, a snapshot "as of" every completed episode (the place chart), and
// each contestant's points per episode (the player scores table).
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useSeasonStore } from '../stores/season'
import { useAuthStore } from '../stores/auth'
import { computeLeaderboardSnapshots, type LeaderboardRow } from '../composables/useLeaderboard'
import { shortName } from '../utils/contestantName'
import { formatPlace, formatPlaceShort } from '../utils/place'
import BaseCard from '../components/base/BaseCard.vue'
import LoadingState from '../components/LoadingState.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import ContestantAvatar from '../components/ContestantAvatar.vue'
import PlaceHistoryChart, { type PlacePoint } from '../components/PlaceHistoryChart.vue'
import PlayerScoresTable, { type PlayerScoreRow } from '../components/PlayerScoresTable.vue'
import parchmentUrl from '../assets/survivor_decor_parchment.svg'
import { loadTribeColors } from '../utils/tribeColors'

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
type PopularPick = {
  name: string
  count: number
  photoUrl: string | null
  // Tribal council votes cast against them in that episode (nullified ones,
  // e.g. by an idol, counted separately).
  votes: number
  nullifiedVotes: number
}
// One contestant's presence across the league's current rosters: how many teams
// have them as MVP vs as a regular player (a contestant is on a team at most once).
type RosterShare = {
  contestantId: string
  name: string
  photoUrl: string | null
  tribe: string
  out: boolean
  mvp: number
  player: number
  total: number
}
type ContestantRow = {
  id: string
  first_name: string
  last_name: string | null
  preferred_name: string | null
  photo_url: string | null
  eliminated_episode_id: string | null
  contestant_tribe_assignments: { tribe: string; effective_from_episode: number }[] | null
}

const seasonStore = useSeasonStore()
const auth = useAuthStore()
const route = useRoute()

const loading = ref(false)
const errorMsg = ref('')

const rows = ref<LeaderboardRow[]>([])
const myRow = ref<LeaderboardRow | null>(null)

// Last-episode bounty breakdown — from the most-recent resolved episode (an
// elimination, or a finale winner). Drives the "League bounties" card.
const lastBountyEpisodeNumber = ref<number | null>(null)
const lastBountyEpisodeName = ref<string | null>(null)
const bountyPicksCount = ref(0)
const bountyHitsCount = ref(0)
const bountySuccessRate = ref<number | null>(null)
const popularPicks = ref<PopularPick[]>([])
// Who the bounty paid out on in that episode — the voted-out contestant(s), or
// the finale winner. Shown on a parchment scroll on the bounty card.
const bountyTargets = ref<{ id: string; name: string; votes: number }[]>([])
// The viewer's place after each completed episode (the team card's line chart).
const placeHistory = ref<PlacePoint[]>([])
// The lowest place that pays out; the chart draws the in-the-money line below it.
const moneyCutoff = ref<number | null>(null)
// Every contestant's points by episode, for the Player Scores table.
const playerScores = ref<PlayerScoreRow[]>([])
// The completed episodes (ascending) — the Player Scores columns.
const scoreEpisodes = ref<number[]>([])

// Drop stale responses if the season changes mid-fetch.
let loadSeq = 0

// Card-header buttons (Leaders → Leaderboard, Bounty Breakdown → Update). They
// navigate, so they're RouterLinks styled as BaseButton's small secondary
// variant — real links keep cmd-click / open-in-new-tab working.
const headerButtonClass =
  'inline-flex shrink-0 items-center justify-center rounded-md border border-border-default bg-interactive-neutral px-3 py-1.5 text-sm font-semibold text-text-default transition hover:bg-interactive-neutral-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent focus-visible:ring-offset-2'

function fmtPts(n: number) {
  return n.toFixed(1)
}

// The viewer's own name for the team-snapshot subtitle (email as a last resort),
// matching the header's owner-name logic.
const ownerName = computed(() =>
  auth.firstName || auth.lastName
    ? `${auth.firstName} ${auth.lastName}`.trim()
    : (auth.user?.email ?? ''),
)

// The standings preview always shows 6 rows: the top 6 when the viewer's team is
// among them, otherwise the top 5 plus the viewer's own row (appended below).
// Rows are already sorted by rank in computeLeaderboard.
const myRowBelowTop = computed(
  () => !!myRow.value && !rows.value.slice(0, 6).some((r) => r.teamId === myRow.value!.teamId),
)
const topStandings = computed(() => rows.value.slice(0, myRowBelowTop.value ? 5 : 6))

// ── Roster breakdown (MVP + player slots combined) ──
// Tallies every team's current roster, so it reflects swaps. Ranked by how many
// teams have the contestant at all, then by MVP count.
const rosterShares = computed<RosterShare[]>(() => {
  const byId = new Map<string, RosterShare>()
  for (const r of rows.value) {
    for (const p of r.players) {
      const share = byId.get(p.contestantId) ?? {
        contestantId: p.contestantId,
        name: p.name,
        photoUrl: p.photoUrl,
        tribe: p.tribe,
        out: p.out,
        mvp: 0,
        player: 0,
        total: 0,
      }
      if (p.isMvp) share.mvp += 1
      else share.player += 1
      share.total += 1
      byId.set(p.contestantId, share)
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.total - a.total || b.mvp - a.mvp || a.name.localeCompare(b.name))
    .slice(0, 5)
})
// Teams with a roster — the bar scale (a full bar = every team has them).
const rosteredTeams = computed(() => rows.value.filter((r) => r.players.length).length)
function sharePct(n: number) {
  return rosteredTeams.value ? (n / rosteredTeams.value) * 100 : 0
}

function reset() {
  rows.value = []
  myRow.value = null
  lastBountyEpisodeNumber.value = null
  lastBountyEpisodeName.value = null
  bountyPicksCount.value = 0
  bountyHitsCount.value = 0
  bountySuccessRate.value = null
  popularPicks.value = []
  bountyTargets.value = []
  placeHistory.value = []
  moneyCutoff.value = null
  playerScores.value = []
  scoreEpisodes.value = []
}

// DEV-ONLY: fill every section with believable fake data so the layout can be
// eyeballed without real episodes. Tweak the numbers/names here to preview other
// states (a missed bounty, a locked episode, etc.). Deleting this function and
// its caller removes the feature entirely.
function loadMock() {
  const player = (name: string, tribe: string, isMvp: boolean, points: number, out = false) => ({
    contestantId: name,
    name,
    photoUrl: null,
    tribe,
    isMvp,
    points,
    out,
  })

  const myPlayers = [
    player('Jesse', 'Reba', true, 34.5),
    player('Carolyn', 'Belo', false, 22),
    player('Kaleb', 'Reba', false, 15),
    player('Bruce', 'Lulu', false, 0, true),
  ]

  // Other teams' rosters (MVP first) so the league pick-distribution cards have
  // something to tally. Bruce is out, like on the viewer's own team.
  const tribes: Record<string, string> = {
    Jesse: 'Reba',
    Carolyn: 'Belo',
    Kaleb: 'Reba',
    Bruce: 'Lulu',
    Emily: 'Belo',
    Q: 'Lulu',
    Charlie: 'Reba',
    Kenzie: 'Belo',
  }
  const roster = (...names: string[]) =>
    names.map((n, k) => player(n, tribes[n] ?? 'Reba', k === 0, 10, n === 'Bruce'))

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
    ownerName: `Player ${i}`,
    players: [],
    actionPoints: totalPoints,
    bountyPoints: 0,
    swapPenalty: 0,
    totalPoints,
    rank: i,
    tied: false,
    currentBountyName: null,
    currentBountyContestantId: null,
    pendingBountyName: null,
    pendingBountyContestantId: null,
    lastBountyName: null,
    lastBountyHit: null,
    lastBountyContestantId: null,
    ...extra,
  })

  const board = [
    row(1, 'Sole Survivors', 128.5, {
      players: roster('Kenzie', 'Carolyn', 'Q', 'Charlie'),
      lastBountyName: 'Bruce',
      lastBountyHit: true,
    }),
    row(2, 'Torch Snuffers', 112, {
      players: roster('Jesse', 'Kenzie', 'Emily', 'Kaleb'),
      lastBountyName: 'Kaleb',
      lastBountyHit: false,
    }),
    row(3, "Sam's Squad", 98.5, {
      ownerId: 'me',
      players: myPlayers,
      lastBountyName: 'Bruce',
      lastBountyHit: true,
      pendingBountyName: 'Kaleb',
      pendingBountyContestantId: 'Kaleb',
    }),
    row(4, 'Immunity Idols', 95, {
      players: roster('Kenzie', 'Jesse', 'Charlie', 'Carolyn'),
      lastBountyName: 'Emily',
      lastBountyHit: false,
    }),
    row(5, 'Merge Meat', 88, {
      players: roster('Jesse', 'Carolyn', 'Q', 'Bruce'),
      lastBountyName: 'Bruce',
      lastBountyHit: true,
    }),
    row(6, 'Fire Makers', 71, {
      players: roster('Charlie', 'Carolyn', 'Kenzie', 'Emily'),
      lastBountyName: 'Kaleb',
      lastBountyHit: false,
    }),
    row(7, 'Hidden Advantages', 64, {
      players: roster('Kenzie', 'Q', 'Kaleb', 'Jesse'),
      lastBountyName: 'Emily',
      lastBountyHit: false,
    }),
    row(8, 'The Outcasts', 40, {
      players: roster('Emily', 'Carolyn', 'Charlie', 'Bruce'),
      lastBountyName: 'Bruce',
      lastBountyHit: true,
    }),
  ]

  rows.value = board
  myRow.value = board[2]!

  // Last-episode bounty breakdown (Ep 5).
  lastBountyEpisodeNumber.value = 5
  lastBountyEpisodeName.value = 'Blindside'
  bountyPicksCount.value = 28
  bountyHitsCount.value = 9
  bountySuccessRate.value = Math.round((9 / 28) * 100)
  const samplePhoto =
    'https://ahxxekjyadqlowwbocoi.supabase.co/storage/v1/object/public/contestant-photos/S51_Profile_Linnea.png'
  // Bruce was voted out in Ep 5, so he's the bounty hit. Add a second entry to
  // preview a double elimination.
  bountyTargets.value = [{ id: 'Bruce', name: 'Bruce', votes: 6 }]
  popularPicks.value = [
    { name: 'Bruce', count: 12, photoUrl: samplePhoto, votes: 6, nullifiedVotes: 0 },
    { name: 'Kaleb', count: 7, photoUrl: samplePhoto, votes: 1, nullifiedVotes: 3 },
    { name: 'Emily', count: 5, photoUrl: samplePhoto, votes: 0, nullifiedVotes: 0 },
  ]

  // Top 3 get paid, for the chart's in-the-money line.
  moneyCutoff.value = 3
  // Points by episode for the Player Scores table. Bruce went out in Ep 5, so
  // his row stops there. Kaleb lost points in Ep 3 (a negative cell).
  scoreEpisodes.value = [1, 2, 3, 4, 5]
  const scores: [string, number | null, number[]][] = [
    ['Kenzie', null, [4, 7.5, 6, 5, 8.5]],
    ['Q', null, [6, 3, 9, 2, 7.5]],
    ['Jesse', null, [3, 5, 4, 6, 5]],
    ['Carolyn', null, [5, 2, 6, 4, 5]],
    ['Emily', null, [2, 4, 3, 5, 4]],
    ['Kaleb', null, [4, 6, -2, 3, 4]],
    ['Charlie', null, [1, 3, 2, 4, 2]],
    ['Bruce', 5, [2, 1, 0, 1, 0]],
  ]
  playerScores.value = scores.map(([name, out, pts]) => ({
    id: name,
    name,
    photoUrl: samplePhoto,
    tribe: tribes[name] ?? null,
    eliminatedEp: out,
    byEpisode: Object.fromEntries(pts.map((v, k) => [k + 1, v])),
    total: pts.reduce((a, b) => a + b, 0),
  }))

  // Place after each episode, for the team card's chart.
  placeHistory.value = [
    { episode: 1, rank: 6, tied: false, points: 18 },
    { episode: 2, rank: 4, tied: true, points: 39.5 },
    { episode: 3, rank: 5, tied: false, points: 52 },
    { episode: 4, rank: 3, tied: false, points: 77 },
    { episode: 5, rank: 3, tied: false, points: 98.5 },
  ]

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
    // Episodes first — their statuses tell us which have completed (the chart's
    // x-axis) and which was the most recent (the recap subject + delta baseline).
    const { data: eps, error: epErr } = await supabase
      .from('episodes')
      .select(
        'id, number, title, status, is_finale, is_merge, locks_at, air_date, bounty_contestant_id',
      )
      .eq('season_id', seasonId)
      .order('number')
    if (epErr) throw new Error(epErr.message)
    const episodes = (eps ?? []) as Episode[]

    const completed = episodes
      .filter((e) => e.status === 'completed')
      .sort((a, b) => b.number - a.number)

    // Full-season standings (with the viewer's pending bounty revealed) plus a
    // snapshot "as of" every completed episode — all from ONE leaderboard fetch.
    // The snapshots drive the place-history chart. In parallel, every
    // contestant (names, photos, and the elimination episode that tells us which
    // episodes resolved a bounty).
    const completedNums = completed.map((e) => e.number).sort((a, b) => a - b)
    const completedIds = completed.map((e) => e.id)
    const [snapshots, , contestantsRes, seasonRes, votesRes] = await Promise.all([
      computeLeaderboardSnapshots(seasonId, completedNums, myUid),
      // The season's custom tribe colors, for the photo rings.
      loadTribeColors(seasonId),
      supabase
        .from('contestants')
        .select(
          'id, first_name, last_name, preferred_name, photo_url, eliminated_episode_id, contestant_tribe_assignments(tribe, effective_from_episode)',
        )
        .eq('season_id', seasonId),
      // Payouts, for the chart's in-the-money line (same source as the Leaderboard).
      supabase.from('seasons').select('payouts').eq('id', seasonId).single(),
      // Tribal council votes for completed episodes — the Most Picked vote counts.
      completedIds.length
        ? supabase
            .from('episode_votes')
            .select('episode_id, target_contestant_id, nullified')
            .in('episode_id', completedIds)
        : Promise.resolve({
            data: [] as { episode_id: string; target_contestant_id: string; nullified: boolean }[],
          }),
    ])
    if (seq !== loadSeq) return

    // The lowest paid place — the in-the-money cutoff. null when no payouts are set.
    const payouts = (seasonRes.data?.payouts ?? []) as { place: number; amount: number }[]
    const paid = payouts.filter((p) => (p.amount ?? 0) > 0).map((p) => p.place)
    moneyCutoff.value = paid.length ? Math.max(...paid) : null

    const board = snapshots.current
    rows.value = board
    myRow.value = myUid ? (board.find((r) => r.ownerId === myUid) ?? null) : null

    // The viewer's place after each completed episode, for the team card chart.
    const myTeamId = myRow.value?.teamId
    placeHistory.value = myTeamId
      ? completedNums.flatMap((n) => {
          const r = snapshots.byEpisode[n]?.find((row) => row.teamId === myTeamId)
          return r ? [{ episode: n, rank: r.rank, tied: r.tied, points: r.totalPoints }] : []
        })
      : []

    // Episodes that voted someone out — tells us which episodes resolved a bounty.
    const contestants = (contestantsRes.data ?? []) as ContestantRow[]
    const epsWithElim = new Set<string>()
    const photoById = new Map<string, string | null>()
    for (const c of contestants) {
      photoById.set(c.id, c.photo_url ?? null)
      if (c.eliminated_episode_id) epsWithElim.add(c.eliminated_episode_id)
    }

    // ── Player scores ──
    // Every contestant's own points per completed episode, sorted by season
    // total. Their row stops after the episode they were voted out in.
    const epNumById = new Map(episodes.map((e) => [e.id, e.number]))
    scoreEpisodes.value = completedNums
    playerScores.value = contestants
      .map((c) => {
        const pts = snapshots.contestantEpisodePoints[c.id] ?? {}
        const byEpisode: Record<number, number> = {}
        for (const n of completedNums) byEpisode[n] = pts[n] ?? 0
        return {
          id: c.id,
          name: shortName(c),
          photoUrl: c.photo_url ?? null,
          // Starting tribe, matching the roster and leaderboard views.
          tribe:
            (c.contestant_tribe_assignments ?? []).find((a) => a.effective_from_episode === 1)
              ?.tribe ?? null,
          eliminatedEp: c.eliminated_episode_id
            ? (epNumById.get(c.eliminated_episode_id) ?? null)
            : null,
          byEpisode,
          total: Object.values(byEpisode).reduce((a, b) => a + b, 0),
        }
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

    // ── Last-episode bounty breakdown ──
    // The most-recent completed episode that resolved (voted someone out, or a
    // finale with a set winner) — the subject of everyone's "last bounty".
    const lastResolvedEp =
      completed.find((e) => (e.is_finale ? !!e.bounty_contestant_id : epsWithElim.has(e.id))) ??
      null
    lastBountyEpisodeNumber.value = lastResolvedEp?.number ?? null
    lastBountyEpisodeName.value = lastResolvedEp?.title ?? null
    // Votes each contestant received at that episode's tribal council.
    const votesFor = new Map<string, { votes: number; nullified: number }>()
    for (const v of votesRes.data ?? []) {
      if (v.episode_id !== lastResolvedEp?.id) continue
      const t = votesFor.get(v.target_contestant_id) ?? { votes: 0, nullified: 0 }
      if (v.nullified) t.nullified += 1
      else t.votes += 1
      votesFor.set(v.target_contestant_id, t)
    }
    bountyTargets.value = lastResolvedEp
      ? contestants
          .filter((c) =>
            lastResolvedEp.is_finale
              ? c.id === lastResolvedEp.bounty_contestant_id
              : c.eliminated_episode_id === lastResolvedEp.id,
          )
          .map((c) => ({ id: c.id, name: shortName(c), votes: votesFor.get(c.id)?.votes ?? 0 }))
      : []
    // Every team's pick + result for that episode (lastBounty* on each row).
    const picks = board.filter((r) => r.lastBountyName)
    const hits = picks.filter((r) => r.lastBountyHit === true)
    bountyPicksCount.value = picks.length
    bountyHitsCount.value = hits.length
    bountySuccessRate.value = picks.length ? Math.round((hits.length / picks.length) * 100) : null
    // Most-picked contestants, keyed by id.
    const tally = new Map<string, PopularPick>()
    for (const r of picks) {
      const id = r.lastBountyContestantId
      if (!id) continue
      const t: PopularPick = tally.get(id) ?? {
        name: r.lastBountyName as string,
        count: 0,
        photoUrl: photoById.get(id) ?? null,
        votes: votesFor.get(id)?.votes ?? 0,
        nullifiedVotes: votesFor.get(id)?.nullified ?? 0,
      }
      t.count += 1
      tally.set(id, t)
    }
    popularPicks.value = [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 3)
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
})
</script>

<template>
  <div class="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
    <h2 class="mb-6 text-2xl font-bold text-text-default">League Home</h2>

    <p v-if="errorMsg" class="mb-4 text-sm text-status-error">{{ errorMsg }}</p>
    <LoadingState v-if="loading" />

    <div v-else-if="!seasonStore.selectedSeasonId" class="text-sm text-text-muted">
      No active seasons right now.
    </div>

    <div v-else class="flex flex-col gap-6">
      <!-- Row 1: team snapshot + standings, side by side on wide screens -->
      <!-- grid-cols-1 (not the implicit column) lets cards shrink to a phone's
           width, so long names truncate instead of pushing the card offscreen. -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <!-- ── 1. Your team snapshot ─────────────────────────────────────────── -->
        <section v-if="myRow">
          <RouterLink to="/my-team" class="group block h-full">
            <BaseCard
              padding="md"
              class="flex h-full flex-col transition-colors group-hover:border-border-strong"
            >
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
                  <p class="text-lg font-bold text-text-default">
                    {{ formatPlace(myRow.rank, myRow.tied) }}
                  </p>
                  <p class="text-sm text-text-subtle">{{ fmtPts(myRow.totalPoints) }} pts</p>
                </div>
              </div>

              <!-- Place over the season — fills whatever height the card has, so
                   it stretches to match the Leaders card beside it. -->
              <div class="mt-4 flex min-h-48 flex-1 flex-col">
                <p class="mb-1 text-xs font-medium text-text-subtle">Place by episode</p>
                <PlaceHistoryChart
                  v-if="placeHistory.length"
                  :history="placeHistory"
                  :team-count="rows.length"
                  :money-cutoff="moneyCutoff"
                  class="flex-1"
                />
                <div
                  v-else
                  class="flex flex-1 items-center justify-center rounded-md bg-surface-subtle px-4 text-center text-sm text-text-muted"
                >
                  Your place history starts after the first episode.
                </div>
              </div>
            </BaseCard>
          </RouterLink>
        </section>

        <!-- ── 3. Standings preview ──────────────────────────────────────────── -->
        <!-- Spans both columns when there's no team card beside it. -->
        <section v-if="rows.length" :class="myRow ? '' : 'lg:col-span-2'">
          <BaseCard padding="none" class="h-full overflow-hidden">
            <!-- Header lives inside the card so its top lines up with the team card -->
            <div
              class="flex items-center justify-between border-b border-border-subtle bg-surface-subtle px-4 py-3"
            >
              <!-- Same size as the team name on the team card -->
              <div class="min-w-0">
                <h3 class="text-lg font-bold text-text-default">Season Leaders</h3>
                <p class="text-xs text-text-subtle">
                  {{ rows.length }} {{ rows.length === 1 ? 'Team' : 'Teams' }}
                </p>
              </div>
              <RouterLink to="/leaderboard" :class="headerButtonClass">Leaderboard</RouterLink>
            </div>
            <!-- One shared grid for every row, so the place column is as wide as
                 its widest value ("5", or "T4" when there's a tie) and the avatars
                 and names still line up. Each row reuses these columns via subgrid. -->
            <div class="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] gap-x-4">
              <RouterLink
                v-for="(row, i) in topStandings"
                :key="row.teamId"
                :to="`/team/${row.teamId}`"
                class="col-span-4 grid grid-cols-subgrid items-center border-border-subtle px-4 py-3 hover:bg-surface-subtle"
                :class="[
                  i > 0 ? 'border-t' : '',
                  myRow && row.teamId === myRow.teamId ? 'bg-surface-highlight' : '',
                ]"
              >
                <span
                  class="min-w-7 whitespace-nowrap text-center text-base font-bold tabular-nums"
                  :class="i === 0 ? 'text-survivor-sand' : 'text-text-subtle'"
                  >{{ formatPlaceShort(row.rank, row.tied) }}</span
                >
                <TeamAvatar
                  :image-url="row.teamImageUrl"
                  :emoji="row.teamEmoji"
                  :color="row.teamColor"
                  :name="row.teamName ?? 'Team'"
                  :size="32"
                  class="rounded-sm border border-border-subtle"
                />
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold leading-tight text-text-default">
                    {{ row.teamName ?? '(no name)' }}
                  </p>
                  <p v-if="row.ownerName" class="truncate text-xs text-text-subtle">
                    {{ row.ownerName }}
                  </p>
                </div>
                <span
                  class="text-right text-base font-bold tabular-nums"
                  :class="row.totalPoints >= 0 ? 'text-text-default' : 'text-status-error'"
                  >{{ fmtPts(row.totalPoints) }}</span
                >
              </RouterLink>

              <!-- Your own row, appended when it falls outside the top 6 -->
              <RouterLink
                v-if="myRowBelowTop && myRow"
                :to="`/team/${myRow.teamId}`"
                class="col-span-4 grid grid-cols-subgrid items-center border-t-2 border-border-default bg-surface-highlight px-4 py-3 hover:bg-surface-subtle"
              >
                <span
                  class="min-w-7 whitespace-nowrap text-center text-base font-bold tabular-nums text-text-subtle"
                >
                  {{ formatPlaceShort(myRow.rank, myRow.tied) }}
                </span>
                <TeamAvatar
                  :image-url="myRow.teamImageUrl"
                  :emoji="myRow.teamEmoji"
                  :color="myRow.teamColor"
                  :name="myRow.teamName ?? 'Team'"
                  :size="32"
                  class="rounded-sm border border-border-subtle"
                />
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold leading-tight text-text-default">
                    {{ myRow.teamName ?? '(no name)' }}
                  </p>
                  <p v-if="myRow.ownerName" class="truncate text-xs text-text-subtle">
                    {{ myRow.ownerName }}
                  </p>
                </div>
                <span class="text-right text-base font-bold tabular-nums text-text-default">
                  {{ fmtPts(myRow.totalPoints) }}
                </span>
              </RouterLink>
            </div>
          </BaseCard>
        </section>
      </div>

      <!-- ── 2. League picks: Bounty Breakdown + Most Popular Players ───── -->
      <!-- Same gap and breakpoint as row 1, so the two rows space evenly. -->
      <section v-if="rows.length">
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <!-- League breakdown: success rate + most-picked. Header bar matches
               the Leaders card; Update goes to My Team, where picks are made. -->
          <BaseCard padding="none" class="flex flex-col overflow-hidden">
            <div
              class="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-subtle px-4 py-3"
            >
              <div class="min-w-0">
                <h3 class="text-lg font-bold text-text-default">Bounty Breakdown</h3>
                <p v-if="lastBountyEpisodeNumber" class="truncate text-xs text-text-subtle">
                  Episode {{ lastBountyEpisodeNumber
                  }}<template v-if="lastBountyEpisodeName">: {{ lastBountyEpisodeName }}</template>
                </p>
              </div>
              <RouterLink v-if="myRow" to="/my-team" :class="headerButtonClass">Update</RouterLink>
            </div>
            <div class="flex flex-1 flex-col p-6">
              <template v-if="bountySuccessRate !== null">
                <!-- Who the bounty hit, on a parchment scroll (side by side on a
                     double boot), with the votes they received on the right. -->
                <div
                  v-if="bountyTargets.length"
                  class="mb-3 flex items-center justify-between gap-3"
                >
                  <div class="flex flex-wrap gap-2">
                    <div v-for="t in bountyTargets" :key="t.id" class="relative w-28">
                      <img
                        :src="parchmentUrl"
                        alt=""
                        aria-hidden="true"
                        class="w-full select-none [filter:drop-shadow(0_2px_4px_rgba(0,0,0,0.25))]"
                      />
                      <span
                        class="absolute inset-0 flex items-center justify-center px-3 text-center font-handwritten text-lg leading-none text-material-parchment-ink"
                      >
                        {{ t.name }}
                      </span>
                    </div>
                  </div>
                  <p class="shrink-0 text-sm font-semibold tabular-nums text-text-subtle">
                    {{ bountyTargets.map((t) => t.votes).join(' · ') }}
                    {{
                      bountyTargets.length === 1 && bountyTargets[0]!.votes === 1 ? 'vote' : 'votes'
                    }}
                  </p>
                </div>
                <p class="text-2xl font-bold text-text-default">{{ bountySuccessRate }}%</p>
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
                <div v-if="popularPicks.length" class="mt-3 border-t border-border-subtle pt-4">
                  <p class="mb-1 text-xs font-medium text-text-subtle">Most Picked</p>
                  <!-- Top 3, with room to breathe: larger avatars and text -->
                  <div class="flex flex-col divide-y divide-border-subtle">
                    <div
                      v-for="p in popularPicks"
                      :key="p.name"
                      class="flex items-center gap-2 py-2.5 text-base last:pb-0"
                    >
                      <ContestantAvatar :photo-url="p.photoUrl" :name="p.name" :size="32" sepia />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-semibold leading-tight text-text-default">
                          {{ p.name }}
                        </p>
                        <!-- Votes received at that episode's tribal council -->
                        <p class="mt-0.5 truncate text-xs text-text-subtle">
                          {{ p.votes }} {{ p.votes === 1 ? 'vote' : 'votes'
                          }}<template v-if="p.nullifiedVotes">
                            · {{ p.nullifiedVotes }} nullified</template
                          >
                        </p>
                      </div>
                      <span class="shrink-0 font-semibold tabular-nums text-text-default"
                        >×{{ p.count }}</span
                      >
                    </div>
                  </div>
                </div>
              </template>
              <p v-else class="text-sm text-text-muted">No bounties resolved yet.</p>
            </div>
          </BaseCard>

          <!-- Roster breakdown: the most-rostered contestants. Each bar is their
               share of the league (a full bar = every team has them), split into
               MVP and regular-player slots. -->
          <BaseCard padding="none" class="flex flex-col overflow-hidden">
            <div
              class="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-subtle px-4 py-3"
            >
              <div class="min-w-0">
                <h3 class="text-lg font-bold text-text-default">Most Popular Players</h3>
                <p class="text-xs text-text-subtle">
                  {{ rosteredTeams }} {{ rosteredTeams === 1 ? 'Team' : 'Teams' }}
                </p>
              </div>
              <!-- Legend: two series, so identity never rests on color alone -->
              <div class="flex shrink-0 items-center gap-3 text-xs text-text-subtle">
                <span class="inline-flex items-center gap-1.5">
                  <span class="h-2.5 w-2.5 rounded-sm bg-chart-mvp"></span>MVP
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <span class="h-2.5 w-2.5 rounded-sm bg-chart-player"></span>Player
                </span>
              </div>
            </div>
            <div class="flex flex-1 flex-col p-6">
              <div v-if="rosterShares.length" class="flex flex-col divide-y divide-border-subtle">
                <div
                  v-for="p in rosterShares"
                  :key="p.contestantId"
                  class="py-3.5 first:pt-0 last:pb-0"
                  :title="`${p.name} is on ${p.total} of ${rosteredTeams} teams (${p.mvp} as MVP, ${p.player} as player)`"
                >
                  <!-- Photo on the left, spanning both lines; name + total on top,
                       the split bar underneath. -->
                  <div class="flex items-center gap-3">
                    <ContestantAvatar
                      :photo-url="p.photoUrl"
                      :name="p.name"
                      :tribe="p.tribe"
                      :grayscale="p.out"
                      :size="36"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 text-base">
                        <p
                          class="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold leading-tight"
                        >
                          <span
                            class="truncate"
                            :class="p.out ? 'text-text-muted' : 'text-text-default'"
                            >{{ p.name }}</span
                          >
                          <span v-if="p.out" class="shrink-0 text-xs text-status-error">Out</span>
                          <!-- MVP / player split, beside the name -->
                          <span class="shrink-0 text-xs font-normal text-text-subtle">
                            {{ p.mvp }} MVP · {{ p.player }} player
                          </span>
                        </p>
                        <span class="shrink-0 font-semibold tabular-nums text-text-default"
                          >×{{ p.total }}</span
                        >
                      </div>
                      <!-- Split bar on a neutral track. A 2px surface gap separates the
                           two segments; an eliminated contestant's bar is dimmed. -->
                      <div
                        class="mt-2 flex h-2 w-full overflow-hidden rounded bg-surface-strong"
                        :class="p.out ? 'opacity-40' : ''"
                      >
                        <div
                          v-if="p.mvp"
                          class="h-full bg-chart-mvp transition-[width] duration-500"
                          :class="p.player ? 'border-r-2 border-surface-default' : ''"
                          :style="{ width: `${sharePct(p.mvp)}%` }"
                        ></div>
                        <div
                          v-if="p.player"
                          class="h-full bg-chart-player transition-[width] duration-500"
                          :style="{ width: `${sharePct(p.player)}%` }"
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <p v-else class="text-sm text-text-muted">No rosters yet.</p>
            </div>
          </BaseCard>
        </div>
      </section>

      <!-- ── 3. Player scores: every contestant's points by episode ───────── -->
      <section v-if="playerScores.length && scoreEpisodes.length">
        <BaseCard padding="none" class="overflow-hidden">
          <div
            class="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-subtle px-4 py-3"
          >
            <div class="min-w-0">
              <h3 class="text-lg font-bold text-text-default">Player Scores</h3>
              <p class="text-xs text-text-subtle">Points by episode</p>
            </div>
            <!-- Legend: shade = points gained (green) or lost (red) that episode -->
            <div class="flex shrink-0 items-center gap-3 text-xs text-text-subtle">
              <span class="inline-flex items-center gap-1.5">
                Fewer
                <span
                  class="h-2.5 w-12 rounded-sm"
                  style="
                    background: linear-gradient(
                      to right,
                      color-mix(in oklab, var(--color-chart-gain) 12%, transparent),
                      color-mix(in oklab, var(--color-chart-gain) 55%, transparent)
                    );
                  "
                ></span>
                More
              </span>
              <span class="inline-flex items-center gap-1.5">
                <span
                  class="h-2.5 w-2.5 rounded-sm"
                  style="background: color-mix(in oklab, var(--color-chart-loss) 40%, transparent)"
                ></span>
                Lost points
              </span>
            </div>
          </div>
          <div class="py-3">
            <PlayerScoresTable :rows="playerScores" :episodes="scoreEpisodes" />
          </div>
        </BaseCard>
      </section>
    </div>
  </div>
</template>
