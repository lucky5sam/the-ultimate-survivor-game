// Shared shapes for the bounty history list, used by the Team page and the
// public team view so both build rows the BountyHistoryList component understands.

export type BountyState =
  | { kind: 'hit'; points: number }
  | { kind: 'missed' }
  | { kind: 'upcoming' }
  | { kind: 'locked' }

export type BountyHistoryRow = {
  episodeId: string
  number: number
  contestantId: string | null
  state: BountyState
  isUpcoming: boolean
}
