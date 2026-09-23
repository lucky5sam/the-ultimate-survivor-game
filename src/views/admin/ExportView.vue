<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../../lib/supabase'
import { useSeasonStore } from '../../stores/season'
import { computeLeaderboard, type LeaderboardRow } from '../../composables/useLeaderboard'
import { shortName } from '../../utils/contestantName'

const seasonStore = useSeasonStore()

const loading = ref(true)
const errorMsg = ref('')
// Set when the email column can't be filled (the admin_team_emails RPC is
// missing). The rest of the export still works.
const emailWarning = ref('')
// The episode number this snapshot is "as of" (latest completed), and whether a
// prior completed episode exists to compute weekly deltas against.
const asOfEpisode = ref<number | null>(null)
const hasPriorEpisode = ref(false)

// One assembled record per team, already in leaderboard (Place) order. The
// `_teamId` isn't a CSV column — it's carried so the Paid checkbox knows which
// team row to write, and stays out of `columns` so it never renders/exports.
type ExportRow = Record<string, string> & { _teamId: string }
const columns = [
  'Email',
  'First Name',
  'Last Name',
  'Team Name',
  'Total Points',
  'Place',
  'MVP',
  'P1',
  'P2',
  'P3',
  'Bounty',
  'Bounty Success',
  'Upcoming Bounty',
  'MVP Status',
  'P1 Status',
  'P2 Status',
  'P3 Status',
  'Net Score (this week)',
  'Place Change (this week)',
  'Preferred Payment Method',
  'Venmo Username',
  'Zelle ID',
  'Paid',
] as const

// The email delivery system imports by exact header name, so the CSV uses these
// (mostly "Manual N") names instead of the readable ones shown in the table.
// Keyed by the internal column name above; the on-screen table still shows the
// readable names for the admin's benefit.
const csvHeaders: Record<(typeof columns)[number], string> = {
  Email: 'Email',
  'First Name': 'First Name',
  'Last Name': 'Last Name',
  'Team Name': 'Manual 1',
  'Total Points': 'Manual 2',
  Place: 'Manual 3',
  MVP: 'Manual 5',
  P1: 'Manual 6',
  P2: 'Manual 7',
  P3: 'Manual 8',
  Bounty: 'Manual 4',
  'Bounty Success': 'Manual 11',
  'Upcoming Bounty': 'Manual 23',
  'MVP Status': 'Manual 12',
  'P1 Status': 'Manual 13',
  'P2 Status': 'Manual 14',
  'P3 Status': 'Manual 15',
  'Net Score (this week)': 'Manual 20',
  'Place Change (this week)': 'Manual 21',
  'Preferred Payment Method': 'Preferred Payment Method',
  'Venmo Username': 'Manual 9',
  'Zelle ID': 'Zelle ID',
  Paid: 'Manual 18',
}
const rows = ref<ExportRow[]>([])

// Entry-fee paid status, keyed by team id. Kept separate from the text `rows`
// so the on-screen checkbox and the CSV both read the live value (a toggle
// updates this after the rows are built).
const paidByTeam = ref<Record<string, boolean>>({})
// Shown as an inline banner when a toggle fails to save — deliberately NOT
// `errorMsg`, which would hide the whole table.
const paidError = ref('')

const round1 = (n: number) => Math.round(n * 10) / 10
const statusLabel = (out: boolean) => (out ? 'Voted Out' : 'In the Game')
const prettyMethod = (m: string) => ({ venmo: 'Venmo', zelle: 'Zelle', other: 'Other' })[m] ?? ''

async function build() {
  loading.value = true
  errorMsg.value = ''
  emailWarning.value = ''
  paidError.value = ''
  rows.value = []
  paidByTeam.value = {}
  try {
    await seasonStore.load()
    const seasonId = seasonStore.currentSeasonId
    if (!seasonId) {
      errorMsg.value = 'No active season found.'
      return
    }
    // Latest + previous COMPLETED episode numbers drive the snapshot and the
    // weekly deltas.
    const { data: eps, error: epErr } = await supabase
      .from('episodes')
      .select('number, status')
      .eq('season_id', seasonId)
    if (epErr) throw new Error(epErr.message)
    const completed = (eps ?? [])
      .filter((e) => e.status === 'completed')
      .map((e) => e.number)
      .sort((a, b) => b - a)
    const latestEp = completed[0] ?? null
    const prevEp = completed[1] ?? null
    asOfEpisode.value = latestEp
    hasPriorEpisode.value = prevEp != null

    // Current standings (as of the latest completed episode) + the prior-week
    // baseline for deltas. Same scoring math, capped at each episode.
    const [current, prior] = await Promise.all([
      computeLeaderboard(seasonId, latestEp),
      prevEp != null ? computeLeaderboard(seasonId, prevEp) : Promise.resolve(null),
    ])

    // Prior-week totals + place, keyed by team, for the delta columns.
    const priorTotal: Record<string, number> = {}
    const priorPlace: Record<string, number> = {}
    if (prior) {
      prior.forEach((r) => {
        priorTotal[r.teamId] = r.totalPoints
        priorPlace[r.teamId] = r.rank
      })
    }

    // Owner profile fields (name + payment) — one query, keyed by user id.
    const ownerIds = [...new Set(current.map((r) => r.ownerId).filter(Boolean))]
    const profileById: Record<
      string,
      {
        first_name: string | null
        last_name: string | null
        payment_method: string | null
        payment_handle: string | null
      }
    > = {}
    if (ownerIds.length) {
      const { data: profs, error: profErr } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, payment_method, payment_handle')
        .in('id', ownerIds)
      if (profErr) throw new Error(profErr.message)
      for (const p of profs ?? []) profileById[p.id] = p
    }

    // Entry-fee status for every team in the season (one query, keyed by id).
    const { data: paidRows, error: paidErr } = await supabase
      .from('teams')
      .select('id, paid')
      .eq('season_id', seasonId)
    if (paidErr) throw new Error(paidErr.message)
    const paidMap: Record<string, boolean> = {}
    for (const t of (paidRows ?? []) as { id: string; paid: boolean }[]) {
      paidMap[t.id] = t.paid
    }
    paidByTeam.value = paidMap

    // Upcoming bounty pick per team — each team's latest standing pick (highest
    // effective_from_episode), regardless of whether the next episode has locked.
    // The shared leaderboard deliberately hides this from non-owners; here in the
    // admin-only export we surface everyone's so picks can be seen before lock.
    const upcomingBountyMap: Record<string, string> = {}
    const { data: picks, error: picksErr } = await supabase
      .from('bounty_picks')
      .select('team_id, contestant_id, effective_from_episode')
      .eq('season_id', seasonId)
    if (picksErr) throw new Error(picksErr.message)
    const latestPickByTeam: Record<string, { contestant_id: string; ep: number }> = {}
    for (const p of (picks ?? []) as {
      team_id: string
      contestant_id: string
      effective_from_episode: number
    }[]) {
      const cur = latestPickByTeam[p.team_id]
      if (!cur || p.effective_from_episode > cur.ep) {
        latestPickByTeam[p.team_id] = {
          contestant_id: p.contestant_id,
          ep: p.effective_from_episode,
        }
      }
    }
    const pickContestantIds = [
      ...new Set(Object.values(latestPickByTeam).map((p) => p.contestant_id)),
    ]
    if (pickContestantIds.length) {
      const { data: picked, error: pickedErr } = await supabase
        .from('contestants')
        .select('id, first_name, last_name, preferred_name')
        .in('id', pickContestantIds)
      if (pickedErr) throw new Error(pickedErr.message)
      const nameById: Record<string, string> = {}
      for (const c of picked ?? []) nameById[c.id] = shortName(c)
      for (const [teamId, p] of Object.entries(latestPickByTeam)) {
        upcomingBountyMap[teamId] = nameById[p.contestant_id] ?? ''
      }
    }

    // Emails live in auth.users — only reachable through the admin-gated RPC.
    // If it isn't installed yet, warn and leave the column blank.
    const emailById: Record<string, string> = {}
    const { data: emails, error: emailErr } = await supabase.rpc('admin_team_emails', {
      p_season_id: seasonId,
    })
    if (emailErr) {
      emailWarning.value =
        'Email column is blank — the admin_team_emails database function is not installed yet.'
    } else {
      for (const e of (emails ?? []) as { user_id: string; email: string }[]) {
        emailById[e.user_id] = e.email
      }
    }

    rows.value = current.map((row) => {
      // Shared competition rank (ties share a place) — matches the leaderboard.
      const place = row.rank
      const prof = profileById[row.ownerId] ?? null
      const method = prof?.payment_method ?? ''
      const handle = prof?.payment_handle ?? ''

      // Roster: MVP first, then the three players in a stable order (by
      // contestant id) so each stays in the same column week to week.
      const mvp = row.players.find((p) => p.isMvp) ?? null
      const others = row.players
        .filter((p) => !p.isMvp)
        .sort((a, b) => a.contestantId.localeCompare(b.contestantId))
      const slot = (n: number) => others[n] ?? null

      const net = round1(row.totalPoints - (priorTotal[row.teamId] ?? 0))
      const placeChange = hasPriorEpisode.value ? (priorPlace[row.teamId] ?? place) - place : null

      return {
        _teamId: row.teamId,
        Email: emailById[row.ownerId] ?? '',
        'First Name': prof?.first_name ?? '',
        'Last Name': prof?.last_name ?? '',
        'Team Name': row.teamName ?? '',
        'Total Points': String(round1(row.totalPoints)),
        Place: String(place),
        MVP: mvp?.name ?? '',
        P1: slot(0)?.name ?? '',
        P2: slot(1)?.name ?? '',
        P3: slot(2)?.name ?? '',
        Bounty: row.lastBountyName ?? '',
        'Bounty Success': row.lastBountyHit == null ? '' : row.lastBountyHit ? 'Yes' : 'No',
        'Upcoming Bounty': upcomingBountyMap[row.teamId] ?? '',
        'MVP Status': mvp ? statusLabel(mvp.out) : '',
        'P1 Status': slot(0) ? statusLabel(slot(0)!.out) : '',
        'P2 Status': slot(1) ? statusLabel(slot(1)!.out) : '',
        'P3 Status': slot(2) ? statusLabel(slot(2)!.out) : '',
        'Net Score (this week)': String(net),
        'Place Change (this week)': placeChange == null ? '' : String(placeChange),
        'Preferred Payment Method': prettyMethod(method),
        'Venmo Username': method === 'venmo' ? handle : '',
        'Zelle ID': method === 'zelle' ? handle : '',
      }
    })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to build the export.'
  } finally {
    loading.value = false
  }
}

// Flip a team's entry-fee status and persist it immediately. Optimistic: update
// the local map first so the checkbox responds instantly, then roll back if the
// write fails (admins are allowed to write teams by the teams_admin RLS policy).
async function togglePaid(teamId: string, next: boolean) {
  paidError.value = ''
  const prev = paidByTeam.value[teamId] ?? false
  paidByTeam.value[teamId] = next
  const { error } = await supabase.from('teams').update({ paid: next }).eq('id', teamId)
  if (error) {
    paidByTeam.value[teamId] = prev
    paidError.value = `Couldn't save Paid status: ${error.message}`
  }
}

function csvCell(v: string) {
  // Quote if the value contains a comma, quote, or newline; double any quotes.
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function downloadCsv() {
  const header = columns.map((c) => csvCell(csvHeaders[c])).join(',')
  const body = rows.value.map((r) =>
    columns
      .map((c) =>
        csvCell(c === 'Paid' ? (paidByTeam.value[r._teamId] ? 'Yes' : 'No') : (r[c] ?? '')),
      )
      .join(','),
  )
  const csv = [header, ...body].join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `survivor-export-episode-${asOfEpisode.value ?? 'preseason'}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

onMounted(build)
</script>

<template>
  <div>
    <div class="flex items-start justify-between mb-6">
      <div>
        <h2 class="text-xl font-semibold text-gray-900">Weekly Export</h2>
      </div>
      <div class="flex gap-2 shrink-0">
        <button
          @click="build"
          :disabled="loading"
          class="text-sm text-gray-600 hover:text-gray-800 px-3 py-2 border border-gray-200 rounded-lg disabled:opacity-50"
        >
          Refresh
        </button>
        <button
          @click="downloadCsv"
          :disabled="loading || !rows.length"
          class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
        >
          Download CSV
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-sm text-gray-500">Building export…</div>
    <p v-else-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>

    <template v-else>
      <p v-if="emailWarning" class="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-4">
        ⚠️ {{ emailWarning }}
      </p>
      <p v-if="paidError" class="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">
        {{ paidError }}
      </p>
      <p v-if="!hasPriorEpisode && asOfEpisode != null" class="text-xs text-gray-400 mb-4">
        Only one completed episode — “Place Change” is blank and “Net Score” equals the full total.
      </p>

      <p class="text-xs text-gray-400 mb-2">{{ rows.length }} teams</p>
      <div class="overflow-x-auto border border-gray-200 rounded-lg bg-white">
        <!-- border-separate (not the Tailwind-default collapse) is required for
             the sticky Email column to work; spacing-0 keeps it looking collapsed -->
        <table class="text-xs whitespace-nowrap border-separate border-spacing-0">
          <thead class="bg-gray-50 text-gray-500">
            <tr>
              <th
                v-for="c in columns"
                :key="c"
                class="text-left font-medium px-3 py-2 border-b border-gray-200"
                :class="
                  c === 'Email' ? 'sticky left-0 z-10 bg-gray-50 border-r border-gray-200' : ''
                "
              >
                {{ c }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i" class="bg-white even:bg-gray-50">
              <td
                v-for="c in columns"
                :key="c"
                class="px-3 py-1.5 text-gray-700 border-b border-gray-100"
                :class="
                  c === 'Email'
                    ? [
                        'sticky left-0 z-10 border-r border-gray-200',
                        i % 2 === 1 ? 'bg-gray-50' : 'bg-white',
                      ]
                    : ''
                "
              >
                <input
                  v-if="c === 'Paid'"
                  type="checkbox"
                  :checked="paidByTeam[r._teamId]"
                  @change="togglePaid(r._teamId, ($event.target as HTMLInputElement).checked)"
                  class="h-4 w-4 cursor-pointer accent-blue-600"
                />
                <template v-else>{{ r[c] }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
