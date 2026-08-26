<script setup lang="ts">
// Player-facing running history of every in-game action, grouped by episode and
// shown newest-first. One row per recipient (each contestant_actions record).
// Point values are the base action_types.points — the same values the
// leaderboard scores from — so the log always reconciles with the standings.
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getTribeColors, loadTribeColors } from '../utils/tribeColors'
import BaseCard from '../components/base/BaseCard.vue'
import BaseModal from '../components/base/BaseModal.vue'

type Season = { id: string; name: string }
type EpisodeInfo = { id: string; number: number; title: string | null; air_date: string | null; status: string }
type EventRow = {
  id: string
  episodeId: string
  category: string
  points: number
  count: number
  recipient: string
  tribe: string
  note: string | null
  createdAt: string
}
type TribeAssignment = { tribe: string; effective_from_episode: number }

const seasons = ref<Season[]>([])
const selectedSeasonId = ref('')
const episodes = ref<EpisodeInfo[]>([])
const events = ref<EventRow[]>([])
const loading = ref(false)
const errorMsg = ref('')

// Full-note modal (notes can be long, so the column is just a link).
const activeNote = ref<{ category: string; recipient: string; episodeNumber: number; note: string } | null>(null)

function openNote(row: EventRow, episode: EpisodeInfo) {
  if (!row.note) return
  activeNote.value = {
    category: row.category,
    recipient: row.recipient,
    episodeNumber: episode.number,
    note: row.note,
  }
}

function pointsLabel(n: number) {
  return n > 0 ? `+${n}` : `${n}`
}

// Episodes newest-first by air date, falling back to episode number when a date
// isn't set (episode number is monotonic with air date anyway).
function epSortDesc(a: EpisodeInfo, b: EpisodeInfo) {
  const da = a.air_date ? new Date(a.air_date).getTime() : null
  const db = b.air_date ? new Date(b.air_date).getTime() : null
  if (da !== null && db !== null && da !== db) return db - da
  return b.number - a.number
}

// Episodes that actually have logged events, newest-first, each with its rows
// sorted newest-first by entry time.
const episodeGroups = computed(() => {
  const byEpisode: Record<string, EventRow[]> = {}
  for (const e of events.value) (byEpisode[e.episodeId] ??= []).push(e)
  return [...episodes.value]
    .filter(ep => byEpisode[ep.id]?.length)
    .sort(epSortDesc)
    .map(ep => ({
      episode: ep,
      rows: byEpisode[ep.id]!.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }))
})

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  // air_date is a plain date (YYYY-MM-DD); build it in local time to avoid a
  // UTC-parse day shift.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

async function loadSeasons() {
  const { data } = await supabase
    .from('seasons')
    .select('id, name')
    .in('status', ['upcoming', 'active'])
    .order('created_at', { ascending: false })
  seasons.value = data ?? []
  if (seasons.value.length > 0) selectedSeasonId.value = seasons.value[0]!.id
}

async function loadEvents() {
  if (!selectedSeasonId.value) return
  loading.value = true
  errorMsg.value = ''
  loadTribeColors(selectedSeasonId.value)
  try {
    const { data: eps, error: epsErr } = await supabase
      .from('episodes')
      .select('id, number, title, air_date, status')
      .eq('season_id', selectedSeasonId.value)
      .order('number')
    if (epsErr) throw new Error(epsErr.message)
    episodes.value = eps ?? []

    const episodeIds = episodes.value.map(e => e.id)
    if (episodeIds.length === 0) {
      events.value = []
      return
    }
    const epNumById: Record<string, number> = {}
    for (const ep of episodes.value) epNumById[ep.id] = ep.number

    // Versioned tribe assignments for this season's contestants, so each event
    // shows the tribe the recipient was on *at that episode* (not just now).
    // Read them nested under contestants (the pattern TeamView uses) so the
    // season filter is a simple top-level column, not a fragile embedded filter.
    const { data: contRows } = await supabase
      .from('contestants')
      .select('id, contestant_tribe_assignments(tribe, effective_from_episode)')
      .eq('season_id', selectedSeasonId.value)
    const assignmentsByContestant: Record<string, TribeAssignment[]> = {}
    for (const c of contRows ?? []) {
      assignmentsByContestant[c.id] = ((c.contestant_tribe_assignments as any[]) ?? []).map(a => ({
        tribe: a.tribe,
        effective_from_episode: a.effective_from_episode,
      }))
    }
    // The tribe in force for a contestant at a given episode number: the latest
    // assignment that took effect on or before it (append-only — a later
    // assignment supersedes, so no "ended" marker is needed).
    function tribeAt(contestantId: string, epNum: number): string {
      const eligible = (assignmentsByContestant[contestantId] ?? []).filter(
        a => a.effective_from_episode <= epNum,
      )
      if (eligible.length === 0) return ''
      return eligible.reduce((a, b) => (b.effective_from_episode > a.effective_from_episode ? b : a)).tribe
    }

    const { data, error } = await supabase
      .from('contestant_actions')
      .select('id, episode_id, count, note, created_at, contestant_id, contestants(name), action_types(category, points)')
      .in('episode_id', episodeIds)
    if (error) throw new Error(error.message)

    events.value = (data ?? []).map((a: any) => ({
      id: a.id,
      episodeId: a.episode_id,
      category: a.action_types?.category ?? '—',
      points: a.action_types?.points ?? 0,
      count: a.count ?? 1,
      recipient: a.contestants?.name ?? '?',
      tribe: tribeAt(a.contestant_id, epNumById[a.episode_id] ?? 0),
      note: a.note ?? null,
      createdAt: a.created_at ?? '',
    }))
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the event log'
  } finally {
    loading.value = false
  }
}

watch(selectedSeasonId, loadEvents)
onMounted(async () => { await loadSeasons(); await loadEvents() })
</script>

<template>
  <div class="mx-auto w-full max-w-3xl px-6 py-8">
    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-2xl font-bold text-text-default">Event Log</h2>
      <div v-if="seasons.length === 1" class="text-sm text-text-subtle">{{ seasons[0]?.name }}</div>
      <select
        v-else-if="seasons.length > 1"
        v-model="selectedSeasonId"
        class="rounded-md border border-interactive-input-border bg-interactive-input px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-border-accent"
      >
        <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <p v-if="errorMsg" class="mb-4 text-sm text-status-error">{{ errorMsg }}</p>
    <div v-if="loading" class="text-sm text-text-muted">Loading…</div>

    <div v-else-if="seasons.length === 0" class="text-sm text-text-muted">
      No active seasons right now.
    </div>

    <div v-else-if="episodeGroups.length === 0" class="text-sm text-text-muted">
      No events logged yet.
    </div>

    <div v-else class="space-y-4">
      <BaseCard
        v-for="group in episodeGroups"
        :key="group.episode.id"
        padding="none"
        class="overflow-hidden"
      >
        <!-- Episode header -->
        <div class="flex items-baseline justify-between gap-3 border-b border-border-subtle bg-surface-subtle px-4 py-3">
          <h3 class="truncate text-sm font-semibold text-text-default">
            Episode {{ group.episode.number }}<template v-if="group.episode.title">: {{ group.episode.title }}</template>
          </h3>
          <span v-if="group.episode.air_date" class="shrink-0 text-xs text-text-muted">
            {{ fmtDate(group.episode.air_date) }}
          </span>
        </div>

        <!-- Events -->
        <div class="overflow-x-auto">
          <table class="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col />
              <col class="w-28" />
              <col />
              <col class="w-28" />
            </colgroup>
            <thead class="text-xs uppercase tracking-wide text-text-muted">
              <tr class="border-b border-border-subtle">
                <th class="px-4 py-2 text-left font-medium">Category</th>
                <th class="px-4 py-2 text-right font-medium">Points</th>
                <th class="px-4 py-2 text-left font-medium">Recipient</th>
                <th class="px-4 py-2 text-left font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in group.rows"
                :key="row.id"
                class="border-b border-border-subtle last:border-0"
              >
                <td class="px-4 py-2.5 align-top text-text-default">
                  <span class="break-words">{{ row.category }}</span><span v-if="row.count > 1" class="ml-1 text-text-muted">×{{ row.count }}</span>
                </td>
                <td
                  class="whitespace-nowrap px-4 py-2.5 text-right align-top font-semibold tabular-nums"
                  :class="row.points >= 0 ? 'text-status-success' : 'text-status-error'"
                >
                  {{ pointsLabel(row.points) }}<span v-if="row.count > 1" class="text-text-muted"> ({{ pointsLabel(row.points * row.count) }})</span>
                </td>
                <td class="px-4 py-2.5 align-top text-text-default">
                  <div class="flex items-center gap-2">
                    <span
                      v-if="row.tribe"
                      class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold text-white"
                      :style="{ backgroundColor: getTribeColors(row.tribe).primary }"
                      :title="row.tribe"
                    >{{ row.tribe.charAt(0).toUpperCase() }}</span>
                    <span class="break-words">{{ row.recipient }}</span>
                  </div>
                </td>
                <td class="px-4 py-2.5 align-top">
                  <button
                    v-if="row.note"
                    @click="openNote(row, group.episode)"
                    class="text-text-accent hover:text-interactive-accent-hover"
                  >View Note</button>
                  <span v-else class="text-text-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </BaseCard>
    </div>

    <!-- Full note -->
    <BaseModal :show="!!activeNote" title="Note" @close="activeNote = null">
      <div v-if="activeNote">
        <p class="text-xs text-text-muted">
          Ep {{ activeNote.episodeNumber }} · {{ activeNote.category }} · {{ activeNote.recipient }}
        </p>
        <p class="mt-2 whitespace-pre-wrap break-words text-sm text-text-default">{{ activeNote.note }}</p>
      </div>
    </BaseModal>
  </div>
</template>
