// Spoiler protection: a player who hasn't watched the latest episode sees the
// app as it looked before it aired — everything "visible through" an earlier
// episode. null means no cap (they're caught up, or it's a past season).
// The cap itself comes from the spoiler store; these helpers apply it to raw
// rows right after they're fetched, so scoring and display never see more.
export type VisibleThrough = number | null

// An episode's results (actions, votes, eliminations, bounty outcomes, tribe
// changes) are visible once the episode is within the cap.
export function aired(episodeNumber: number | undefined, cap: VisibleThrough): boolean {
  return cap == null || (episodeNumber != null && episodeNumber <= cap)
}

// Roster, bounty-pick and swap rows effective from episode N were committed
// before N aired (they lock at N's lock time), so they're visible one episode
// past the cap. Rows for later episodes could only be made after watching.
export function committed(fromEpisode: number, cap: VisibleThrough): boolean {
  return cap == null || fromEpisode <= cap + 1
}

// A roster row's end as seen from the cap: one that ended after the next
// episode began (a swap made after watching) still counts as on the roster.
export function rosterEnd(toEpisode: number | null, cap: VisibleThrough): number | null {
  return cap == null || toEpisode == null || toEpisode < cap + 1 ? toEpisode : null
}

// An episode row as seen from the cap: past the cap it hasn't finished yet and
// has no finale winner, so nothing about its outcome shows.
export function rewindEpisode<
  T extends { number: number; status: string; bounty_contestant_id?: string | null },
>(ep: T, cap: VisibleThrough): T {
  if (aired(ep.number, cap)) return ep
  return {
    ...ep,
    status: ep.status === 'completed' ? 'active' : ep.status,
    ...('bounty_contestant_id' in ep ? { bounty_contestant_id: null } : {}),
  }
}
