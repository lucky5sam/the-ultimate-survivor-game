import { supabase } from '../lib/supabase'
import { displayName, shortName } from '../utils/contestantName'

// Shared client-side scoring. Used by the leaderboard and the Team page so the
// two never drift. Throws on query error; caller handles messaging.

type SeasonConfig = {
  bounty_points_pre_merge: number
  bounty_points_post_merge: number
  bounty_points_finale: number
}
type TeamPlayerRecord = {
  team_id: string
  contestant_id: string
  role: string
  effective_from_episode: number
  effective_to_episode: number | null
}

export type LeaderboardPlayer = {
  contestantId: string
  name: string
  photoUrl: string | null
  tribe: string
  isMvp: boolean
  points: number
  out: boolean
}
export type LeaderboardRow = {
  teamId: string
  teamName: string | null
  teamImageUrl: string | null
  teamEmoji: string | null
  teamColor: string | null
  ownerId: string
  ownerName: string
  players: LeaderboardPlayer[]
  actionPoints: number
  bountyPoints: number
  swapPenalty: number
  totalPoints: number
  // The team's bounty pick for the currently locked-in (airing / past-lock,
  // not-yet-resolved) episode. null while the next pick is still editable, so
  // an un-committed pick is never revealed.
  currentBountyName: string | null
  // The team's not-yet-locked pick, exposed ONLY for the requesting user's own
  // team (see revealPendingOwnerId). null for everyone else, so no un-committed
  // pick leaks into the payload. Only set when currentBountyName is null.
  pendingBountyName: string | null
  // The team's pick for the most-recent completed+resolved episode in range, and
  // whether it hit. Powers the admin export's "this week's bounty" columns.
  // lastBountyHit is null when no completed episode has resolved yet.
  lastBountyName: string | null
  lastBountyHit: boolean | null
}

export async function computeLeaderboard(
  seasonId: string,
  // When set, scoring ignores any episode numbered beyond this (used by the
  // admin export to get a team's standing "as of episode N" for weekly deltas).
  throughEpisode: number | null = null,
  // The owner id whose own not-yet-locked bounty pick should be revealed
  // (pendingBountyName). Everyone else's un-committed pick stays hidden.
  revealPendingOwnerId: string | null = null,
): Promise<LeaderboardRow[]> {
  // ── Phase 1: everything keyed only on the season id, fetched in parallel ──
  const [seasonRes, epsRes, elimRes, teamsRes, bountyRes] = await Promise.all([
    supabase
      .from('seasons')
      .select('bounty_points_pre_merge, bounty_points_post_merge, bounty_points_finale')
      .eq('id', seasonId)
      .single(),
    supabase
      .from('episodes')
      .select('id, number, is_merge, is_finale, bounty_contestant_id, status, locks_at')
      .eq('season_id', seasonId)
      .order('number'),
    supabase.from('contestants').select('id, eliminated_episode_id').eq('season_id', seasonId),
    supabase
      .from('teams')
      .select('id, team_name, team_image_url, team_emoji, team_color, user_id')
      .eq('season_id', seasonId),
    supabase
      .from('bounty_picks')
      .select('team_id, contestant_id, effective_from_episode')
      .eq('season_id', seasonId),
  ])
  if (seasonRes.error) throw new Error(seasonRes.error.message)
  if (epsRes.error) throw new Error(epsRes.error.message)
  if (teamsRes.error) throw new Error(teamsRes.error.message)

  const config = seasonRes.data as SeasonConfig

  const allEpisodes = epsRes.data ?? []
  const episodes =
    throughEpisode == null ? allEpisodes : allEpisodes.filter((e) => e.number <= throughEpisode)
  const episodeIds = episodes.map((e) => e.id)
  const epNumById: Record<string, number> = {}
  for (const ep of episodes) epNumById[ep.id] = ep.number
  const mergeEpNumber = episodes.find((e) => e.is_merge)?.number ?? Infinity

  // The episode whose bounty is currently locked-in but not yet resolved (airing,
  // or past its lock time). Each team's pick for this episode is the "current
  // bounty". When the next pick is still editable there is no locked episode, so
  // the current bounty stays hidden (an un-committed pick is never revealed).
  const nowMs = Date.now()
  const lockedEpisode =
    episodes.find(
      (e) =>
        e.status !== 'completed' &&
        (e.status === 'active' || (e.locks_at != null && Date.parse(e.locks_at) <= nowMs)),
    ) ?? null
  const lockedEpNumber = lockedEpisode?.number ?? null

  // Eliminations are the source of truth for regular-episode bounties.
  const eliminatedByEpisode: Record<string, Set<string>> = {}
  const eliminatedContestants = new Set<string>()
  for (const c of elimRes.data ?? []) {
    if (c.eliminated_episode_id) {
      ;(eliminatedByEpisode[c.eliminated_episode_id] ??= new Set()).add(c.id)
      eliminatedContestants.add(c.id)
    }
  }

  const teams = teamsRes.data ?? []
  const teamIds = teams.map((t) => t.id)
  if (teamIds.length === 0) return []
  const ownerIds = [...new Set(teams.map((t) => t.user_id).filter(Boolean))]

  // Bounty picks grouped by team
  const picksByTeam: Record<string, { contestant_id: string; effective_from_episode: number }[]> =
    {}
  for (const pick of bountyRes.data ?? []) {
    if (!picksByTeam[pick.team_id]) picksByTeam[pick.team_id] = []
    picksByTeam[pick.team_id]!.push(pick)
  }

  // ── Phase 2: everything keyed on the ids resolved above, fetched in parallel ──
  const [actionsRes, profsRes, tpRes, swapsRes] = await Promise.all([
    episodeIds.length > 0
      ? supabase
          .from('contestant_actions')
          .select('contestant_id, episode_id, count, action_types(points)')
          .in('episode_id', episodeIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    ownerIds.length > 0
      ? supabase.from('profiles').select('id, first_name, last_name').in('id', ownerIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase
      .from('team_players')
      .select('team_id, contestant_id, role, effective_from_episode, effective_to_episode')
      .in('team_id', teamIds),
    supabase.from('team_swaps').select('team_id, penalty_points').in('team_id', teamIds),
  ])
  if (actionsRes.error) throw new Error(actionsRes.error.message)
  if (tpRes.error) throw new Error(tpRes.error.message)

  // Action points: contestant_id → episode_number → raw points
  const epActsByContestant: Record<string, Record<number, number>> = {}
  for (const a of actionsRes.data ?? []) {
    const pts = (a.action_types as unknown as { points: number } | null)?.points ?? 0
    const epNum = epNumById[a.episode_id]
    if (epNum === undefined) continue
    if (!epActsByContestant[a.contestant_id]) epActsByContestant[a.contestant_id] = {}
    epActsByContestant[a.contestant_id]![epNum] =
      (epActsByContestant[a.contestant_id]![epNum] ?? 0) + pts * a.count
  }

  // Owner names for each team (subject to profiles RLS — degrades to '' if a
  // profile isn't readable).
  const ownerNameMap: Record<string, string> = {}
  for (const p of profsRes.data ?? []) {
    ownerNameMap[p.id] = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
  }

  const allTeamPlayers = (tpRes.data ?? []) as TeamPlayerRecord[]

  // Swap penalties per team. penalty_points is stored as a negative value, so it
  // subtracts directly — do NOT negate it.
  const swapPenaltyMap: Record<string, number> = {}
  for (const s of swapsRes.data ?? []) {
    swapPenaltyMap[s.team_id] = (swapPenaltyMap[s.team_id] ?? 0) + s.penalty_points
  }

  // ── Phase 3: contestant names (roster players + bounty-pick targets) ──
  const contestantIds = [
    ...new Set([
      ...allTeamPlayers.map((p) => p.contestant_id),
      ...(bountyRes.data ?? []).map((p) => p.contestant_id),
    ]),
  ]
  // Condensed (preferred/first) names for the tight player + bounty columns.
  const contestantShortNameMap: Record<string, string> = {}
  const contestantPhotoMap: Record<string, string | null> = {}
  const contestantTribeMap: Record<string, string> = {}
  if (contestantIds.length > 0) {
    const { data: nameData } = await supabase
      .from('contestants')
      .select(
        'id, first_name, last_name, preferred_name, photo_url, contestant_tribe_assignments(tribe, effective_from_episode)',
      )
      .in('id', contestantIds)
    for (const c of nameData ?? []) {
      contestantShortNameMap[c.id] = shortName(c)
      contestantPhotoMap[c.id] = c.photo_url ?? null
      // Match the roster view: use the starting (episode 1) tribe assignment.
      contestantTribeMap[c.id] =
        (
          (c.contestant_tribe_assignments as { tribe: string; effective_from_episode: number }[]) ??
          []
        ).find((a) => a.effective_from_episode === 1)?.tribe ?? 'Unknown'
    }
  }

  // Bounty points per team. Regular episodes: hit if the pick was eliminated
  // that episode. Finale: hit if the pick is the winner (bounty_contestant_id).
  const bountyPtsMap: Record<string, number> = {}
  for (const ep of episodes) {
    if (ep.status !== 'completed') continue
    const elimSet = eliminatedByEpisode[ep.id]
    const resolved = ep.is_finale ? !!ep.bounty_contestant_id : !!elimSet && elimSet.size > 0
    if (!resolved) continue
    const ptValue = ep.is_finale
      ? config.bounty_points_finale
      : ep.number >= mergeEpNumber
        ? config.bounty_points_post_merge
        : config.bounty_points_pre_merge
    for (const [teamId, picks] of Object.entries(picksByTeam)) {
      const pick = picks
        .filter((p) => p.effective_from_episode <= ep.number)
        .sort((a, b) => b.effective_from_episode - a.effective_from_episode)[0]
      if (!pick) continue
      const hit = ep.is_finale
        ? pick.contestant_id === ep.bounty_contestant_id
        : elimSet!.has(pick.contestant_id)
      if (hit) bountyPtsMap[teamId] = (bountyPtsMap[teamId] ?? 0) + ptValue
    }
  }

  // "This week's bounty" for the admin export: the most-recent completed episode
  // in range that actually resolved (someone was voted out, or a finale winner is
  // set). For each team, resolve its effective pick for that episode and whether
  // it hit — same rule as the scoring loop above.
  const lastEp =
    [...episodes]
      .filter((e) => e.status === 'completed')
      .sort((a, b) => b.number - a.number)
      .find((e) => (e.is_finale ? !!e.bounty_contestant_id : !!eliminatedByEpisode[e.id]?.size)) ??
    null
  const lastBountyByTeam: Record<string, { name: string | null; hit: boolean }> = {}
  if (lastEp) {
    const elimSet = eliminatedByEpisode[lastEp.id]
    for (const [teamId, picks] of Object.entries(picksByTeam)) {
      const pick = picks
        .filter((p) => p.effective_from_episode <= lastEp.number)
        .sort((a, b) => b.effective_from_episode - a.effective_from_episode)[0]
      if (!pick) continue
      const hit = lastEp.is_finale
        ? pick.contestant_id === lastEp.bounty_contestant_id
        : !!elimSet?.has(pick.contestant_id)
      lastBountyByTeam[teamId] = { name: contestantShortNameMap[pick.contestant_id] ?? null, hit }
    }
  }

  // Group team_player records by team
  const playersByTeam: Record<string, TeamPlayerRecord[]> = {}
  for (const p of allTeamPlayers) {
    if (!playersByTeam[p.team_id]) playersByTeam[p.team_id] = []
    playersByTeam[p.team_id]!.push(p)
  }

  // Build leaderboard rows
  return teams
    .map((team) => {
      const teamPlayerRecords = playersByTeam[team.id] ?? []

      // Accumulate per-contestant contribution across all their time-bounded records
      const contribMap: Record<string, { pts: number; isMvp: boolean; active: boolean }> = {}

      for (const tp of teamPlayerRecords) {
        let rawPts = 0
        for (const ep of episodes) {
          if (ep.number < tp.effective_from_episode) continue
          if (tp.effective_to_episode !== null && ep.number > tp.effective_to_episode) continue
          rawPts += epActsByContestant[tp.contestant_id]?.[ep.number] ?? 0
        }
        const pts = tp.role === 'mvp' ? rawPts * 1.5 : rawPts
        const isActive = tp.effective_to_episode === null

        if (!contribMap[tp.contestant_id]) {
          contribMap[tp.contestant_id] = { pts: 0, isMvp: false, active: false }
        }
        contribMap[tp.contestant_id]!.pts += pts
        if (isActive) {
          contribMap[tp.contestant_id]!.isMvp = tp.role === 'mvp'
          contribMap[tp.contestant_id]!.active = true
        }
      }

      const players: LeaderboardPlayer[] = Object.entries(contribMap)
        .filter(([, v]) => v.active)
        .map(([contestantId, v]) => ({
          contestantId,
          name: contestantShortNameMap[contestantId] ?? '?',
          photoUrl: contestantPhotoMap[contestantId] ?? null,
          tribe: contestantTribeMap[contestantId] ?? 'Unknown',
          isMvp: v.isMvp,
          points: v.pts,
          out: eliminatedContestants.has(contestantId),
        }))
        .sort((a, b) => b.points - a.points)

      const actionPoints = Object.values(contribMap).reduce((s, v) => s + v.pts, 0)
      const bountyPoints = bountyPtsMap[team.id] ?? 0
      const swapPenalty = swapPenaltyMap[team.id] ?? 0

      // Current bounty: the team's pick effective for the locked-in episode
      // (append-only — latest pick on or before it). Hidden when no episode is
      // locked yet, so an editable pick is never revealed.
      let currentBountyName: string | null = null
      if (lockedEpNumber !== null) {
        const eligible = (picksByTeam[team.id] ?? []).filter(
          (p) => p.effective_from_episode <= lockedEpNumber,
        )
        const pick = eligible.length
          ? eligible.reduce((a, b) => (b.effective_from_episode > a.effective_from_episode ? b : a))
          : null
        if (pick) currentBountyName = contestantShortNameMap[pick.contestant_id] ?? null
      }

      // Owner-only: when nothing is locked, still reveal this user's own standing
      // pick (their latest, which carries forward to the next episode).
      let pendingBountyName: string | null = null
      if (currentBountyName === null && revealPendingOwnerId && team.user_id === revealPendingOwnerId) {
        const picks = picksByTeam[team.id] ?? []
        const latest = picks.length
          ? picks.reduce((a, b) => (b.effective_from_episode > a.effective_from_episode ? b : a))
          : null
        if (latest) pendingBountyName = contestantShortNameMap[latest.contestant_id] ?? null
      }

      return {
        teamId: team.id,
        teamName: team.team_name,
        teamImageUrl: team.team_image_url,
        teamEmoji: team.team_emoji,
        teamColor: team.team_color,
        ownerId: team.user_id,
        ownerName: ownerNameMap[team.user_id] ?? '',
        players,
        actionPoints,
        bountyPoints,
        swapPenalty,
        totalPoints: actionPoints + bountyPoints + swapPenalty,
        currentBountyName,
        pendingBountyName,
        lastBountyName: lastBountyByTeam[team.id]?.name ?? null,
        lastBountyHit: lastEp ? (lastBountyByTeam[team.id]?.hit ?? false) : null,
      }
    })
    .sort((a, b) => b.totalPoints - a.totalPoints)
}

// ── Detailed per-team breakdown for the Score Breakdown modal ────────────────
// Uses the SAME scoring math as computeLeaderboard, but keeps per-stint detail
// (a "stint" = one team_players record: a player over an episode range) plus
// per-episode bounty hits, so the total reconciles with the leaderboard score.

export type BreakdownStint = {
  contestantId: string
  name: string
  role: string
  fromEpisode: number
  toEpisode: number | null // null = still on the roster
  points: number
}
export type BreakdownBountyHit = {
  episodeNumber: number
  contestantId: string
  name: string
  points: number
}
export type BreakdownSwap = {
  type: string // 'contestant' | 'role_change'
  removedName: string
  addedName: string
  episode: number // effective_from_episode
  penalty: number // negative
}
export type TeamBreakdown = {
  stints: BreakdownStint[]
  bountyHits: BreakdownBountyHit[]
  swaps: BreakdownSwap[]
  swapPenalty: number
  actionPoints: number
  bountyPoints: number
  totalPoints: number
}

export async function computeTeamBreakdown(
  seasonId: string,
  teamId: string,
): Promise<TeamBreakdown> {
  // ── Phase 1: season/episodes/eliminations + this team's rows, all in parallel ──
  const [seasonRes, epsRes, elimRes, tpRes, picksRes, swapsRes] = await Promise.all([
    supabase
      .from('seasons')
      .select('bounty_points_pre_merge, bounty_points_post_merge, bounty_points_finale')
      .eq('id', seasonId)
      .single(),
    supabase
      .from('episodes')
      .select('id, number, is_merge, is_finale, bounty_contestant_id, status')
      .eq('season_id', seasonId)
      .order('number'),
    supabase.from('contestants').select('id, eliminated_episode_id').eq('season_id', seasonId),
    supabase
      .from('team_players')
      .select('contestant_id, role, effective_from_episode, effective_to_episode')
      .eq('team_id', teamId),
    supabase
      .from('bounty_picks')
      .select('contestant_id, effective_from_episode')
      .eq('team_id', teamId)
      .order('effective_from_episode', { ascending: true }),
    supabase
      .from('team_swaps')
      .select(
        'swap_type, removed_contestant_id, added_contestant_id, effective_from_episode, penalty_points',
      )
      .eq('team_id', teamId)
      .order('effective_from_episode', { ascending: true }),
  ])
  if (seasonRes.error) throw new Error(seasonRes.error.message)
  if (epsRes.error) throw new Error(epsRes.error.message)
  if (tpRes.error) throw new Error(tpRes.error.message)

  const config = seasonRes.data as SeasonConfig

  const episodes = epsRes.data ?? []
  const episodeIds = episodes.map((e) => e.id)
  const epNumById: Record<string, number> = {}
  for (const ep of episodes) epNumById[ep.id] = ep.number
  const mergeEpNumber = episodes.find((e) => e.is_merge)?.number ?? Infinity

  // Eliminations are the source of truth for regular-episode bounties.
  const eliminatedByEpisode: Record<string, Set<string>> = {}
  for (const c of elimRes.data ?? []) {
    if (c.eliminated_episode_id)
      (eliminatedByEpisode[c.eliminated_episode_id] ??= new Set()).add(c.id)
  }

  const teamPlayers = (tpRes.data ?? []) as Omit<TeamPlayerRecord, 'team_id'>[]
  const teamPicks = picksRes.data ?? []
  const teamSwaps = swapsRes.data ?? []

  // ── Phase 2: action points (depends on episodeIds from phase 1) ──
  const epActsByContestant: Record<string, Record<number, number>> = {}
  if (episodeIds.length > 0) {
    const { data: actions, error: actErr } = await supabase
      .from('contestant_actions')
      .select('contestant_id, episode_id, count, action_types(points)')
      .in('episode_id', episodeIds)
    if (actErr) throw new Error(actErr.message)
    for (const a of actions ?? []) {
      const pts = (a.action_types as unknown as { points: number } | null)?.points ?? 0
      const epNum = epNumById[a.episode_id]
      if (epNum === undefined) continue
      if (!epActsByContestant[a.contestant_id]) epActsByContestant[a.contestant_id] = {}
      epActsByContestant[a.contestant_id]![epNum] =
        (epActsByContestant[a.contestant_id]![epNum] ?? 0) + pts * a.count
    }
  }

  // Names for every contestant referenced (roster players, bounty picks, swaps).
  const nameIds = new Set<string>()
  for (const p of teamPlayers) nameIds.add(p.contestant_id)
  for (const p of teamPicks) nameIds.add(p.contestant_id)
  for (const s of teamSwaps) {
    if (s.removed_contestant_id) nameIds.add(s.removed_contestant_id)
    if (s.added_contestant_id) nameIds.add(s.added_contestant_id)
  }
  const nameMap: Record<string, string> = {}
  if (nameIds.size > 0) {
    const { data: nameData } = await supabase
      .from('contestants')
      .select('id, first_name, last_name, preferred_name')
      .in('id', [...nameIds])
    for (const c of nameData ?? []) nameMap[c.id] = displayName(c)
  }

  const stints: BreakdownStint[] = teamPlayers
    .map((tp) => {
      let rawPts = 0
      for (const ep of episodes) {
        if (ep.number < tp.effective_from_episode) continue
        if (tp.effective_to_episode !== null && ep.number > tp.effective_to_episode) continue
        rawPts += epActsByContestant[tp.contestant_id]?.[ep.number] ?? 0
      }
      return {
        contestantId: tp.contestant_id,
        name: nameMap[tp.contestant_id] ?? '?',
        role: tp.role,
        fromEpisode: tp.effective_from_episode,
        toEpisode: tp.effective_to_episode,
        points: tp.role === 'mvp' ? rawPts * 1.5 : rawPts,
      }
    })
    .sort((a, b) => a.fromEpisode - b.fromEpisode || (a.role === 'mvp' ? -1 : 1))

  const bountyHits: BreakdownBountyHit[] = []
  for (const ep of episodes) {
    if (ep.status !== 'completed') continue
    const elimSet = eliminatedByEpisode[ep.id]
    const resolved = ep.is_finale ? !!ep.bounty_contestant_id : !!elimSet && elimSet.size > 0
    if (!resolved) continue
    const eligible = teamPicks.filter((p) => p.effective_from_episode <= ep.number)
    const pick = eligible.length ? eligible[eligible.length - 1] : null
    if (!pick) continue
    const hit = ep.is_finale
      ? pick.contestant_id === ep.bounty_contestant_id
      : elimSet!.has(pick.contestant_id)
    if (!hit) continue
    bountyHits.push({
      episodeNumber: ep.number,
      contestantId: pick.contestant_id,
      name: nameMap[pick.contestant_id] ?? '?',
      points: ep.is_finale
        ? config.bounty_points_finale
        : ep.number >= mergeEpNumber
          ? config.bounty_points_post_merge
          : config.bounty_points_pre_merge,
    })
  }

  const swaps: BreakdownSwap[] = teamSwaps.map((s) => ({
    type: s.swap_type,
    removedName: s.removed_contestant_id ? (nameMap[s.removed_contestant_id] ?? '?') : '?',
    addedName: s.added_contestant_id ? (nameMap[s.added_contestant_id] ?? '?') : '?',
    episode: s.effective_from_episode,
    penalty: s.penalty_points,
  }))
  // penalty_points is stored negative, so it already subtracts — do NOT negate.
  const swapPenalty = teamSwaps.reduce((s, x) => s + x.penalty_points, 0)

  const actionPoints = stints.reduce((s, x) => s + x.points, 0)
  const bountyPoints = bountyHits.reduce((s, x) => s + x.points, 0)
  return {
    stints,
    bountyHits,
    swaps,
    swapPenalty,
    actionPoints,
    bountyPoints,
    totalPoints: actionPoints + bountyPoints + swapPenalty,
  }
}
