// Tribe assignments are append-only: a tribe change is a new row effective from
// an episode, superseding the earlier ones. The current tribe is the one with
// the latest effective_from_episode.
type TribeAssignment = { tribe: string; effective_from_episode: number }

export function currentTribe(assignments: TribeAssignment[] | null | undefined): string | null {
  let latest: TribeAssignment | null = null
  for (const a of assignments ?? []) {
    if (!latest || a.effective_from_episode > latest.effective_from_episode) latest = a
  }
  return latest?.tribe ?? null
}
