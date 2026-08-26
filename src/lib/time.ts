// Episode lock times are anchored to US Eastern (America/New_York), which is when
// Survivor first airs (8pm ET). We store an absolute instant (timestamptz) so the
// lock comparison is globally correct, but the admin enters and everyone reads the
// time in ET. Using the IANA zone auto-handles the EST/EDT (daylight time) switch,
// so "8pm ET" resolves to the right instant whether it's September (EDT) or November (EST).

const ET_ZONE = 'America/New_York'

// Offset of America/New_York from UTC, in minutes, at a given instant.
// Negative (e.g. -240 for EDT, -300 for EST).
function etOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value
  const asUTC = Date.UTC(
    +map.year!,
    +map.month! - 1,
    +map.day!,
    +map.hour!,
    +map.minute!,
    +map.second!,
  )
  return (asUTC - date.getTime()) / 60000
}

// datetime-local value ("2026-09-24T20:00", read as ET wall-clock) -> UTC ISO string.
export function etInputToIso(local: string): string | null {
  if (!local) return null
  const [datePart, timePart] = local.split('T')
  const [y, mo, d] = datePart!.split('-').map(Number)
  const [h, mi] = timePart!.split(':').map(Number)
  // Treat the wall-clock as if it were UTC to get a first guess, then correct by
  // the ET offset at that instant. (Off only in the 1h DST fold, never at 8pm.)
  const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!)
  const offset = etOffsetMinutes(new Date(guess))
  return new Date(guess - offset * 60000).toISOString()
}

// UTC ISO string -> datetime-local value showing the ET wall-clock ("2026-09-24T20:00").
export function isoToEtInput(iso: string | null): string {
  if (!iso) return ''
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(iso))) map[p.type] = p.value
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`
}

// UTC ISO string -> human display in ET, e.g. "Wed, Sep 24 · 8:00 PM ET".
export function fmtEt(iso: string): string {
  const s = new Date(iso).toLocaleString('en-US', {
    timeZone: ET_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  // Intl gives "Wed, Sep 24, 8:00 PM" — swap the last comma for a middot.
  return s.replace(/,([^,]*)$/, ' ·$1') + ' ET'
}
