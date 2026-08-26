import { reactive } from 'vue'
import { supabase } from '../lib/supabase'

export type TribeColors = {
  primary: string
  dimmed: string
  text: string
}

// Fallback palette — used for any tribe that doesn't have a custom color set.
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

// Admin-chosen colors for the currently-loaded season, keyed by tribe name.
// Reactive so badges recolor as soon as loadTribeColors() resolves. getTribeColors
// reads from it, so any template using tribe colors updates automatically.
const overrides = reactive<Record<string, string>>({})

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return null
  return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) }
}

function colorsFromHex(hex: string): TribeColors {
  const rgb = hexToRgb(hex)
  if (!rgb) return PALETTES[0]!
  return {
    primary: hex,
    dimmed: `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`,
    text: hex,
  }
}

export function getTribeColors(tribe: string): TribeColors {
  const custom = overrides[tribe]
  if (custom) return colorsFromHex(custom)
  return PALETTES[hashTribe(tribe)]!
}

// Replace the active overrides (clears the old ones first so switching seasons
// doesn't leak colors from the previous one).
export function setTribeColorOverrides(map: Record<string, string>) {
  for (const key of Object.keys(overrides)) delete overrides[key]
  Object.assign(overrides, map)
}

// Load a season's custom tribe colors into the active overrides. Safe to call on
// every view load / season switch; falls back silently if the table isn't there.
export async function loadTribeColors(seasonId: string): Promise<void> {
  if (!seasonId) { setTribeColorOverrides({}); return }
  const { data, error } = await supabase
    .from('tribes')
    .select('name, color')
    .eq('season_id', seasonId)
  if (error) return
  const map: Record<string, string> = {}
  for (const t of data ?? []) {
    if (t.name && t.color) map[t.name] = t.color
  }
  setTribeColorOverrides(map)
}
