// Tribe assignments are append-only: a tribe change is a new row effective from
// an episode, superseding the earlier ones. The current tribe is the one with
// the latest effective_from_episode.
type TribeAssignment = { tribe: string; effective_from_episode: number }

// `throughEpisode` (spoiler protection) ignores changes made in later episodes;
// the earliest assignment always counts as the starting tribe.
export function currentTribe(
  assignments: TribeAssignment[] | null | undefined,
  throughEpisode: number | null = null,
): string | null {
  const sorted = [...(assignments ?? [])].sort(
    (a, b) => a.effective_from_episode - b.effective_from_episode,
  )
  let tribe = sorted[0]?.tribe ?? null
  for (const a of sorted) {
    if (throughEpisode != null && a.effective_from_episode > throughEpisode) break
    tribe = a.tribe
  }
  return tribe
}
