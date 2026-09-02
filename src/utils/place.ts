// Finishing-place formatting shared by the leaderboard and the team Place cards.
// Ties use standard competition ranking (1, 2, 2, 4, …); a tied place is marked
// with a "T-" / "T" prefix so shared places read clearly.

// 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", 11 → "11th", …
export function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`
}

// Long form for the Place cards: 4 → "4th", tied 4 → "T-4th".
export function formatPlace(rank: number, tied = false): string {
  return `${tied ? 'T-' : ''}${ordinal(rank)}`
}

// Compact form for the leaderboard's number column: 4 → "4", tied 4 → "T4".
export function formatPlaceShort(rank: number, tied = false): string {
  return `${tied ? 'T' : ''}${rank}`
}
