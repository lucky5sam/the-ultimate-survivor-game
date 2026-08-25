import { supabase } from '../lib/supabase'

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

export type LeaderboardPlayer = { contestantId: string; name: string; isMvp: boolean; points: number }
export type LeaderboardRow = {
  teamId: string
  teamName: string | null
  players: LeaderboardPlayer[]
  actionPoints: number
  bountyPoints: number
  swapPenalty: number
  totalPoints: number
}

export async function computeLeaderboard(seasonId: string): Promise<LeaderboardRow[]> {
  // Season config for bounty point values
  const { data: seasonData, error: seasonErr } = await supabase
    .from('seasons')
    .select('bounty_points_pre_merge, bounty_points_post_merge, bounty_points_finale')
    .eq('id', seasonId)
    .single()
  if (seasonErr) throw new Error(seasonErr.message)
  const config = seasonData as SeasonConfig

  // All episodes for the season
  const { data: allEps, error: epsErr } = await supabase
    .from('episodes')
    .select('id, number, is_merge, is_finale, bounty_contestant_id, status')
    .eq('season_id', seasonId)
    .order('number')
  if (epsErr) throw new Error(epsErr.message)

  const episodes = allEps ?? []
  const episodeIds = episodes.map(e => e.id)
  const epNumById: Record<string, number> = {}
  for (const ep of episodes) epNumById[ep.id] = ep.number
  const mergeEpNumber = episodes.find(e => e.is_merge)?.number ?? Infinity
  const completedWithResult = episodes.filter(e => e.status === 'completed' && e.bounty_contestant_id)

  // Action points: contestant_id → episode_number → raw points
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

  // Teams for the season
  const { data: teamsData, error: teamsErr } = await supabase
    .from('teams')
    .select('id, team_name')
    .eq('season_id', seasonId)
  if (teamsErr) throw new Error(teamsErr.message)
  const teams = teamsData ?? []
  const teamIds = teams.map(t => t.id)

  if (teamIds.length === 0) return []

  // All team_player records (including historical) with effective date range
  const { data: tpData, error: tpErr } = await supabase
    .from('team_players')
    .select('team_id, contestant_id, role, effective_from_episode, effective_to_episode')
    .in('team_id', teamIds)
  if (tpErr) throw new Error(tpErr.message)
  const allTeamPlayers = (tpData ?? []) as TeamPlayerRecord[]

  // Contestant names
  const contestantIds = [...new Set(allTeamPlayers.map(p => p.contestant_id))]
  const contestantNameMap: Record<string, string> = {}
  if (contestantIds.length > 0) {
    const { data: nameData } = await supabase
      .from('contestants')
      .select('id, name')
      .in('id', contestantIds)
    for (const c of nameData ?? []) contestantNameMap[c.id] = c.name
  }

  // Bounty picks grouped by team
  const { data: allBountyPicks } = await supabase
    .from('bounty_picks')
    .select('team_id, contestant_id, effective_from_episode')
    .eq('season_id', seasonId)

  const picksByTeam: Record<string, { contestant_id: string; effective_from_episode: number }[]> = {}
  for (const pick of allBountyPicks ?? []) {
    if (!picksByTeam[pick.team_id]) picksByTeam[pick.team_id] = []
    picksByTeam[pick.team_id]!.push(pick)
  }

  // Bounty points per team using season config values
  const bountyPtsMap: Record<string, number> = {}
  for (const ep of completedWithResult) {
    const ptValue = ep.is_finale
      ? config.bounty_points_finale
      : ep.number >= mergeEpNumber
        ? config.bounty_points_post_merge
        : config.bounty_points_pre_merge
    for (const [teamId, picks] of Object.entries(picksByTeam)) {
      const pick = picks
        .filter(p => p.effective_from_episode <= ep.number)
        .sort((a, b) => b.effective_from_episode - a.effective_from_episode)[0]
      if (pick?.contestant_id === ep.bounty_contestant_id) {
        bountyPtsMap[teamId] = (bountyPtsMap[teamId] ?? 0) + ptValue
      }
    }
  }

  // Swap penalties per team (penalty_points stored as positive magnitude)
  const swapPenaltyMap: Record<string, number> = {}
  const { data: swaps } = await supabase
    .from('team_swaps')
    .select('team_id, penalty_points')
    .in('team_id', teamIds)
  for (const s of swaps ?? []) {
    swapPenaltyMap[s.team_id] = (swapPenaltyMap[s.team_id] ?? 0) + s.penalty_points
  }

  // Group team_player records by team
  const playersByTeam: Record<string, TeamPlayerRecord[]> = {}
  for (const p of allTeamPlayers) {
    if (!playersByTeam[p.team_id]) playersByTeam[p.team_id] = []
    playersByTeam[p.team_id]!.push(p)
  }

  // Build leaderboard rows
  return teams
    .map(team => {
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
          name: contestantNameMap[contestantId] ?? '?',
          isMvp: v.isMvp,
          points: v.pts,
        }))
        .sort((a, b) => b.points - a.points)

      const actionPoints = Object.values(contribMap).reduce((s, v) => s + v.pts, 0)
      const bountyPoints = bountyPtsMap[team.id] ?? 0
      const swapPenalty = -(swapPenaltyMap[team.id] ?? 0)
      return {
        teamId: team.id,
        teamName: team.team_name,
        players,
        actionPoints,
        bountyPoints,
        swapPenalty,
        totalPoints: actionPoints + bountyPoints + swapPenalty,
      }
    })
    .sort((a, b) => b.totalPoints - a.totalPoints)
}
