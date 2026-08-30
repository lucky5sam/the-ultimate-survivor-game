// One-off cleanup for orphaned Storage images in the `uploads` bucket.
//
// Historically every upload wrote a new UUID file and the old one was never
// deleted, so replaced team photos / avatars piled up and ate the Supabase
// Storage quota. Delete-on-replace now prevents new orphans; this script
// reclaims the existing ones.
//
// It lists every file under uploads/teams and uploads/avatars, compares them
// against the URLs still referenced by `teams.team_image_url` and
// `profiles.avatar_url`, and deletes the unreferenced files.
//
// Requires the SERVICE ROLE key (Supabase dashboard -> Settings -> API ->
// service_role secret) — the anon key can't list/delete other users' files.
//
// Usage (from the repo root):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-orphan-images.mjs
//     -> DRY RUN: prints what it *would* delete, changes nothing.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-orphan-images.mjs --apply
//     -> actually deletes the orphans.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.argv.includes('--apply')

const BUCKET = 'uploads'
const PREFIXES = ['teams', 'avatars']

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, e.g.\n' +
      '  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... \\\n' +
      '    node scripts/cleanup-orphan-images.mjs',
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// Turn a stored public URL into a bucket-relative path (or null if it isn't one
// of our bucket's files — e.g. an external Google avatar).
function urlToPath(url) {
  if (!url) return null
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  const path = url.slice(idx + marker.length)
  return path || null
}

// List every file under a prefix, paging until exhausted.
async function listAll(prefix) {
  const files = []
  const pageSize = 100
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`Listing ${prefix} failed: ${error.message}`)
    if (!data || data.length === 0) break
    for (const f of data) {
      // Skip folder placeholders; keep real files only.
      if (f.id) files.push(`${prefix}/${f.name}`)
    }
    if (data.length < pageSize) break
  }
  return files
}

async function main() {
  // 1. All referenced paths (from the DB rows that still point at an image).
  const referenced = new Set()
  const [teamsRes, profilesRes] = await Promise.all([
    supabase.from('teams').select('team_image_url'),
    supabase.from('profiles').select('avatar_url'),
  ])
  if (teamsRes.error) throw new Error(`Reading teams failed: ${teamsRes.error.message}`)
  if (profilesRes.error) throw new Error(`Reading profiles failed: ${profilesRes.error.message}`)
  for (const row of teamsRes.data ?? []) {
    const p = urlToPath(row.team_image_url)
    if (p) referenced.add(p)
  }
  for (const row of profilesRes.data ?? []) {
    const p = urlToPath(row.avatar_url)
    if (p) referenced.add(p)
  }

  // 2. All files actually in the bucket.
  const allFiles = []
  for (const prefix of PREFIXES) allFiles.push(...(await listAll(prefix)))

  // 3. Orphans = stored files nothing references.
  const orphans = allFiles.filter((p) => !referenced.has(p))

  console.log(`Bucket files:      ${allFiles.length}`)
  console.log(`Referenced in DB:  ${referenced.size}`)
  console.log(`Orphans to delete: ${orphans.length}`)
  if (orphans.length === 0) {
    console.log('Nothing to clean up. 🎉')
    return
  }

  console.log('\n' + orphans.map((p) => `  - ${p}`).join('\n'))

  if (!APPLY) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --apply to delete these.')
    return
  }

  // 4. Delete in batches (the API accepts many paths per call).
  let deleted = 0
  const batchSize = 100
  for (let i = 0; i < orphans.length; i += batchSize) {
    const batch = orphans.slice(i, i + batchSize)
    const { error } = await supabase.storage.from(BUCKET).remove(batch)
    if (error) throw new Error(`Delete batch failed: ${error.message}`)
    deleted += batch.length
    console.log(`Deleted ${deleted}/${orphans.length}…`)
  }
  console.log(`\nDone. Removed ${deleted} orphaned files.`)
}

main().catch((e) => {
  console.error('\nCleanup failed:', e.message)
  process.exit(1)
})
