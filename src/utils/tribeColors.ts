export type TribeColors = {
  primary: string
  dimmed: string
  text: string
}

const PALETTES: TribeColors[] = [
  { primary: '#f97316', dimmed: 'rgba(249,115,22,0.15)', text: '#fb923c' },
  { primary: '#3b82f6', dimmed: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
  { primary: '#22c55e', dimmed: 'rgba(34,197,94,0.15)', text: '#4ade80' },
  { primary: '#ef4444', dimmed: 'rgba(239,68,68,0.15)', text: '#f87171' },
  { primary: '#a855f7', dimmed: 'rgba(168,85,247,0.15)', text: '#c084fc' },
  { primary: '#f59e0b', dimmed: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
]

function hashTribe(tribe: string): number {
  let hash = 0
  for (let i = 0; i < tribe.length; i++) {
    hash = (hash + tribe.charCodeAt(i)) % PALETTES.length
  }
  return hash
}

export function getTribeColors(tribe: string): TribeColors {
  return PALETTES[hashTribe(tribe)]!
}
