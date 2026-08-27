// Contestant names are stored as first_name / last_name (+ optional
// preferred_name) rather than one string, so splitting on spaces is never
// needed. These helpers are the single source of truth for composing names.

type NameParts = {
  first_name: string
  last_name: string | null
  preferred_name?: string | null
}

// Legal full name: "First Last" (just the first name when there's no last).
// Used for admin/reference and as the base for displayName.
export function fullName(c: NameParts): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
}

// Player-facing name with the preferred name woven in alongside:
//   Christian "CJ" Jones   (falls back to the legal full name when unset)
export function displayName(c: NameParts): string {
  const preferred = c.preferred_name?.trim()
  if (!preferred) return fullName(c)
  return [c.first_name, `"${preferred}"`, c.last_name].filter(Boolean).join(' ').trim()
}

// Short label for compact views (roster rows, wizard pick strip): lead with the
// preferred name when set, else the first name.
export function shortName(c: NameParts): string {
  return (c.preferred_name?.trim() || c.first_name).trim()
}
