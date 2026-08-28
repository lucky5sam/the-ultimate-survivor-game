// Shared team-avatar option lists + a random pairing helper, used by the emoji
// picker and by team creation (where an identity is required, so a team with no
// chosen photo/emoji is given a random emoji-on-color tile).

// Soft pastel backgrounds (one per hue); first is the picker's default.
export const TEAM_AVATAR_COLORS = [
  '#fde68a', // amber
  '#fed7aa', // orange
  '#fecdd3', // rose
  '#fbcfe8', // pink
  '#ddd6fe', // violet
  '#bfdbfe', // blue
  '#bae6fd', // sky
  '#99f6e4', // teal
  '#bbf7d0', // green
  '#64748b', // slate (darker neutral)
]

// Curated, Survivor-flavored base set to pick from without an emoji keyboard.
export const TEAM_AVATAR_EMOJIS = [
  '🔥',
  '🏝️',
  '🗿',
  '🏆',
  '👑',
  '🐍',
  '🦈',
  '🦁',
  '🐐',
  '🦅',
  '🐢',
  '🌊',
  '⛺',
  '🪵',
  '🥥',
  '🍗',
  '💪',
  '🧠',
  '🎯',
  '⚡',
  '🌴',
  '☠️',
  '🏹',
  '🛶',
  '🧭',
  '🥇',
  '😈',
  '💰',
]

// A random emoji + pastel color pairing, for teams that skip picking one.
export function randomTeamAvatar(): { emoji: string; color: string } {
  const emoji = TEAM_AVATAR_EMOJIS[Math.floor(Math.random() * TEAM_AVATAR_EMOJIS.length)]!
  const color = TEAM_AVATAR_COLORS[Math.floor(Math.random() * TEAM_AVATAR_COLORS.length)]!
  return { emoji, color }
}
