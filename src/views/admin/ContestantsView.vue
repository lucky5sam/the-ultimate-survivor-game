<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../../lib/supabase'

type Season = { id: string; name: string }
type TribeAssignment = { id: string; tribe: string; effective_from_episode: number }
type Episode = { id: string; number: number; title: string | null }
type Contestant = {
  id: string
  season_id: string
  name: string
  photo_url: string | null
  alt_image: string | null
  video_url: string | null
  bio: string | null
  age: number | null
  hometown: string | null
  occupation: string | null
  assignments: TribeAssignment[]
}
type CsvRow = {
  name: string
  tribe: string
  photo_url: string
  age: string
  hometown: string
  occupation: string
  bio: string
}

const seasons = ref<Season[]>([])
const selectedSeasonId = ref<string>('')
const contestants = ref<Contestant[]>([])
const episodes = ref<Episode[]>([])
const loading = ref(false)
const errorMsg = ref('')
const showForm = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)

const form = ref({
  name: '',
  photo_url: '',
  alt_image: '',
  video_url: '',
  bio: '',
  age: '',
  hometown: '',
  occupation: '',
  tribe: '',
})

// Tribe-swap modal (records an append-only assignment effective from a chosen episode)
const swapContestant = ref<Contestant | null>(null)
const swapForm = ref({ tribe: '', fromEpisode: 1 })
const savingSwap = ref(false)

// Bulk tribe editor: edit every contestant's tribe at once, effective from a
// single chosen episode (Ep 1 for pre-season setup, or a later episode for a
// mid-season swap that shuffles many contestants).
const bulkMode = ref(false)
const bulkEpisode = ref(1)
const bulkTribes = ref<Record<string, string>>({}) // contestant id -> tribe
const bulkSetAll = ref('')
const savingBulk = ref(false)

// The tribe in force at the latest episode — the newest assignment by episode.
function currentTribeOf(c: Contestant): string {
  if (c.assignments.length === 0) return ''
  return c.assignments.reduce((a, b) =>
    b.effective_from_episode > a.effective_from_episode ? b : a,
  ).tribe
}

// Tribes defined for this season (the tribe picker pulls from these).
type SeasonTribe = { name: string; color: string }
const tribes = ref<SeasonTribe[]>([])
const tribeNames = computed(() => tribes.value.map((t) => t.name))

// Options for a tribe <select>, including the current value even if it's a
// legacy name no longer in the season's tribe list (so it isn't silently lost).
function tribeOptions(current: string): string[] {
  const names = tribeNames.value
  return current && !names.includes(current) ? [current, ...names] : names
}
function tribeColorOf(name: string): string {
  return tribes.value.find((t) => t.name === name)?.color ?? ''
}

async function loadTribesList() {
  if (!selectedSeasonId.value) {
    tribes.value = []
    return
  }
  const { data } = await supabase
    .from('tribes')
    .select('name, color')
    .eq('season_id', selectedSeasonId.value)
    .order('name')
  tribes.value = data ?? []
}

// CSV import state
const showCsvModal = ref(false)
const csvRows = ref<CsvRow[]>([])
const csvError = ref('')
const csvImporting = ref(false)
const csvFileInput = ref<HTMLInputElement | null>(null)

const CSV_TEMPLATE =
  'name,tribe,photo_url,age,hometown,occupation,bio\n"Jane Smith","Tagi","https://example.com/jane.jpg",28,"Austin, TX","Engineer","Short bio here."'

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'contestants_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function onCsvFile(e: Event) {
  csvError.value = ''
  csvRows.value = []
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const text = (ev.target?.result as string) ?? ''
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) {
      csvError.value = 'CSV must have a header row and at least one data row.'
      return
    }
    const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase().replace(/\s+/g, '_'))
    const col = (name: string) => headers.indexOf(name)
    if (col('name') === -1) {
      csvError.value = 'CSV must have a "name" column.'
      return
    }
    const rows: CsvRow[] = []
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]!)
      const get = (key: string) => (col(key) >= 0 ? (cells[col(key)] ?? '') : '').trim()
      const name = get('name')
      if (!name) continue
      rows.push({
        name,
        tribe: get('tribe'),
        photo_url: get('photo_url'),
        age: get('age'),
        hometown: get('hometown'),
        occupation: get('occupation'),
        bio: get('bio'),
      })
    }
    if (rows.length === 0) {
      csvError.value = 'No valid rows found.'
      return
    }
    csvRows.value = rows
  }
  reader.readAsText(file)
}

async function importCsv() {
  if (!selectedSeasonId.value || csvRows.value.length === 0) return
  csvImporting.value = true
  csvError.value = ''

  const contestantPayloads = csvRows.value.map((r) => ({
    name: r.name,
    season_id: selectedSeasonId.value,
    photo_url: r.photo_url || null,
    bio: r.bio || null,
    age: r.age ? parseInt(r.age) : null,
    hometown: r.hometown || null,
    occupation: r.occupation || null,
  }))

  try {
    const { data: inserted, error: e1 } = await supabase
      .from('contestants')
      .insert(contestantPayloads)
      .select('id, name')
    if (e1 || !inserted) throw new Error(e1?.message ?? 'Insert failed.')

    // Build a name → id map for tribe assignments
    const nameToId = new Map(inserted.map((c) => [c.name, c.id]))

    const tribeRows = csvRows.value
      .filter((r) => r.tribe)
      .map((r) => ({
        contestant_id: nameToId.get(r.name),
        tribe: r.tribe,
        effective_from_episode: 1,
      }))
      .filter((r) => r.contestant_id)

    if (tribeRows.length > 0) {
      const { error: e2 } = await supabase.from('contestant_tribe_assignments').insert(tribeRows)
      if (e2) throw new Error(e2.message)
    }

    showCsvModal.value = false
    csvRows.value = []
    if (csvFileInput.value) csvFileInput.value.value = ''
    await loadContestants()
  } catch (e) {
    csvError.value = e instanceof Error ? e.message : 'Import failed'
  } finally {
    csvImporting.value = false
  }
}

function closeCsvModal() {
  showCsvModal.value = false
  csvRows.value = []
  csvError.value = ''
  if (csvFileInput.value) csvFileInput.value.value = ''
}

async function loadSeasons() {
  const { data } = await supabase
    .from('seasons')
    .select('id, name')
    .order('created_at', { ascending: false })
  seasons.value = data ?? []
  if (seasons.value.length > 0 && !selectedSeasonId.value) {
    selectedSeasonId.value = seasons.value[0]!.id
  }
}

async function loadContestants() {
  if (!selectedSeasonId.value) return
  loading.value = true
  const { data, error } = await supabase
    .from('contestants')
    .select('*, contestant_tribe_assignments(id, tribe, effective_from_episode)')
    .eq('season_id', selectedSeasonId.value)
    .order('name')
  if (error) errorMsg.value = error.message
  else
    contestants.value = (data ?? []).map((c: any) => ({
      ...c,
      assignments: ((c.contestant_tribe_assignments as TribeAssignment[]) ?? []).sort(
        (a, b) => a.effective_from_episode - b.effective_from_episode,
      ),
    }))
  loading.value = false
}

async function loadEpisodes() {
  if (!selectedSeasonId.value) {
    episodes.value = []
    return
  }
  const { data } = await supabase
    .from('episodes')
    .select('id, number, title')
    .eq('season_id', selectedSeasonId.value)
    .order('number')
  episodes.value = data ?? []
}

async function saveContestant() {
  saving.value = true
  errorMsg.value = ''
  const payload = {
    name: form.value.name,
    photo_url: form.value.photo_url || null,
    alt_image: form.value.alt_image || null,
    video_url: form.value.video_url || null,
    bio: form.value.bio || null,
    age: form.value.age ? parseInt(form.value.age) : null,
    hometown: form.value.hometown || null,
    occupation: form.value.occupation || null,
    season_id: selectedSeasonId.value,
  }

  const tribe = form.value.tribe.trim()

  try {
    if (editingId.value) {
      const { error } = await supabase.from('contestants').update(payload).eq('id', editingId.value)
      if (error) throw new Error(error.message)

      // The form's Tribe field is the *initial* (Ep 1) tribe. Correct it in place
      // if it changed; mid-season changes are recorded via the Change tribe flow.
      const existing = contestants.value
        .find((c) => c.id === editingId.value)
        ?.assignments.find((a) => a.effective_from_episode === 1)
      if (tribe && existing && existing.tribe !== tribe) {
        const { error: e } = await supabase
          .from('contestant_tribe_assignments')
          .update({ tribe })
          .eq('id', existing.id)
        if (e) throw new Error(e.message)
      } else if (tribe && !existing) {
        const { error: e } = await supabase
          .from('contestant_tribe_assignments')
          .insert({ contestant_id: editingId.value, tribe, effective_from_episode: 1 })
        if (e) throw new Error(e.message)
      }
    } else {
      const { data: inserted, error } = await supabase
        .from('contestants')
        .insert(payload)
        .select('id')
        .single()
      if (error || !inserted) throw new Error(error?.message ?? 'Insert failed.')

      if (tribe) {
        const { error: e } = await supabase
          .from('contestant_tribe_assignments')
          .insert({ contestant_id: inserted.id, tribe, effective_from_episode: 1 })
        if (e) throw new Error(e.message)
      }
    }

    showForm.value = false
    resetForm()
    await loadContestants()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to save contestant'
  } finally {
    saving.value = false
  }
}

async function deleteContestant(id: string, name: string) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
  const { error } = await supabase.from('contestants').delete().eq('id', id)
  if (error) errorMsg.value = error.message
  else await loadContestants()
}

function openCreate() {
  editingId.value = null
  resetForm()
  showForm.value = true
}

function openEdit(c: Contestant) {
  editingId.value = c.id
  form.value = {
    name: c.name,
    photo_url: c.photo_url ?? '',
    alt_image: c.alt_image ?? '',
    video_url: c.video_url ?? '',
    bio: c.bio ?? '',
    age: c.age !== null ? String(c.age) : '',
    hometown: c.hometown ?? '',
    occupation: c.occupation ?? '',
    tribe: c.assignments.find((a) => a.effective_from_episode === 1)?.tribe ?? '',
  }
  showForm.value = true
}

function resetForm() {
  form.value = {
    name: '',
    photo_url: '',
    alt_image: '',
    video_url: '',
    bio: '',
    age: '',
    hometown: '',
    occupation: '',
    tribe: '',
  }
}

function closeForm() {
  showForm.value = false
  resetForm()
}

function openSwap(c: Contestant) {
  swapContestant.value = c
  const nextEp = episodes.value.find(
    (e) => !c.assignments.some((a) => a.effective_from_episode === e.number),
  )
  swapForm.value = {
    tribe: '',
    fromEpisode: nextEp?.number ?? episodes.value[episodes.value.length - 1]?.number ?? 2,
  }
}

async function saveSwap() {
  if (!swapContestant.value) return
  const tribe = swapForm.value.tribe.trim()
  if (!tribe) return
  savingSwap.value = true
  errorMsg.value = ''
  try {
    // Append-only: a tribe change is a new assignment row effective from the
    // chosen episode. If a row already exists for that episode, correct it.
    const existing = swapContestant.value.assignments.find(
      (a) => a.effective_from_episode === swapForm.value.fromEpisode,
    )
    const { error } = existing
      ? await supabase.from('contestant_tribe_assignments').update({ tribe }).eq('id', existing.id)
      : await supabase.from('contestant_tribe_assignments').insert({
          contestant_id: swapContestant.value.id,
          tribe,
          effective_from_episode: swapForm.value.fromEpisode,
        })
    if (error) throw new Error(error.message)
    swapContestant.value = null
    await loadContestants()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to record tribe change'
  } finally {
    savingSwap.value = false
  }
}

// The tribe in force for a contestant at a given episode: the latest assignment
// that took effect on or before it (append-only — a later assignment supersedes).
function tribeAtEpisode(c: Contestant, epNum: number): string {
  const eligible = c.assignments.filter((a) => a.effective_from_episode <= epNum)
  if (eligible.length === 0) return ''
  return eligible.reduce((a, b) => (b.effective_from_episode > a.effective_from_episode ? b : a))
    .tribe
}

// Episode numbers to choose from for the bulk "effective from" — falls back to
// [1] before any episodes exist (pre-season initial-tribe setup).
const bulkEpisodeOptions = computed(() => {
  const nums = episodes.value.map((e) => e.number)
  return nums.length ? nums : [1]
})

function openBulk() {
  bulkEpisode.value = bulkEpisodeOptions.value[0] ?? 1
  bulkSetAll.value = ''
  seedBulkTribes()
  bulkMode.value = true
}

// Seed each row's dropdown with the tribe currently in force at the chosen episode.
function seedBulkTribes() {
  const map: Record<string, string> = {}
  for (const c of contestants.value) map[c.id] = tribeAtEpisode(c, bulkEpisode.value)
  bulkTribes.value = map
}

function applyBulkSetAll() {
  if (!bulkSetAll.value) return
  const map: Record<string, string> = {}
  for (const c of contestants.value) map[c.id] = bulkSetAll.value
  bulkTribes.value = map
}

function cancelBulk() {
  bulkMode.value = false
  bulkTribes.value = {}
  bulkSetAll.value = ''
}

async function saveBulk() {
  savingBulk.value = true
  errorMsg.value = ''
  const ep = bulkEpisode.value
  try {
    // Build the minimal set of writes: only touch a contestant when the chosen
    // tribe actually changes what's in force at this episode. Mirrors the
    // single-edit rule — correct the row at this episode in place if one exists,
    // otherwise insert. A choice that matches the prior episode's tribe is a
    // no-op (or removes a now-redundant swap row).
    const ops: PromiseLike<{ error: { message: string } | null }>[] = []
    for (const c of contestants.value) {
      const desired = (bulkTribes.value[c.id] ?? '').trim()
      if (!desired) continue // bulk editor never clears a tribe
      const existingAtEp = c.assignments.find((a) => a.effective_from_episode === ep)
      const priorTribe = ep > 1 ? tribeAtEpisode(c, ep - 1) : ''
      const redundant = ep > 1 && desired === priorTribe

      if (existingAtEp) {
        if (redundant) {
          ops.push(supabase.from('contestant_tribe_assignments').delete().eq('id', existingAtEp.id))
        } else if (existingAtEp.tribe !== desired) {
          ops.push(
            supabase
              .from('contestant_tribe_assignments')
              .update({ tribe: desired })
              .eq('id', existingAtEp.id),
          )
        }
      } else if (!redundant) {
        ops.push(
          supabase.from('contestant_tribe_assignments').insert({
            contestant_id: c.id,
            tribe: desired,
            effective_from_episode: ep,
          }),
        )
      }
    }

    const results = await Promise.all(ops)
    const failed = results.find((r) => r.error)
    if (failed?.error) throw new Error(failed.error.message)

    bulkMode.value = false
    bulkTribes.value = {}
    bulkSetAll.value = ''
    await loadContestants()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to save tribes'
  } finally {
    savingBulk.value = false
  }
}

// Re-seed the dropdowns when the effective episode changes mid-edit, so each
// row reflects the tribe in force at the newly chosen episode.
watch(bulkEpisode, () => {
  if (bulkMode.value) seedBulkTribes()
})

// loadSeasons sets selectedSeasonId, which triggers this watch — so the initial
// data load runs once (no duplicate load in onMounted).
watch(selectedSeasonId, () => {
  cancelBulk()
  loadContestants()
  loadEpisodes()
  loadTribesList()
})
onMounted(loadSeasons)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Contestants</h1>
      <div v-if="bulkMode" class="flex gap-2">
        <button
          @click="cancelBulk"
          class="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg"
        >
          Cancel
        </button>
        <button
          @click="saveBulk"
          :disabled="savingBulk"
          class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          {{ savingBulk ? 'Saving…' : 'Save Tribes' }}
        </button>
      </div>
      <div v-else class="flex gap-2">
        <button
          @click="openBulk"
          :disabled="!selectedSeasonId || contestants.length === 0"
          class="bg-white hover:bg-gray-50 disabled:opacity-40 border border-gray-300 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg"
        >
          Bulk Edit Tribes
        </button>
        <button
          @click="showCsvModal = true"
          :disabled="!selectedSeasonId"
          class="bg-white hover:bg-gray-50 disabled:opacity-40 border border-gray-300 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg"
        >
          Import CSV
        </button>
        <button
          @click="openCreate"
          :disabled="!selectedSeasonId"
          class="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          + Add Contestant
        </button>
      </div>
    </div>

    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-1">Season</label>
      <select
        v-model="selectedSeasonId"
        class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <p v-if="errorMsg" class="text-red-600 text-sm mb-4">{{ errorMsg }}</p>

    <div v-if="!selectedSeasonId" class="text-gray-400 text-sm">
      No seasons found. Create a season first.
    </div>

    <div v-else-if="loading" class="text-gray-400 text-sm">Loading…</div>

    <div v-else-if="contestants.length === 0" class="text-gray-400 text-sm">
      No contestants yet for this season.
    </div>

    <div v-else>
      <!-- Bulk edit toolbar: set the effective episode and optionally fill every row. -->
      <div
        v-if="bulkMode"
        class="mb-4 flex flex-wrap items-end gap-4 rounded-xl border border-blue-200 bg-blue-50 p-4"
      >
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Effective from episode</label>
          <select
            v-model.number="bulkEpisode"
            class="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option v-for="n in bulkEpisodeOptions" :key="n" :value="n">Episode {{ n }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Set all to</label>
          <div class="flex gap-2">
            <select
              v-model="bulkSetAll"
              class="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select tribe…</option>
              <option v-for="t in tribeNames" :key="t" :value="t">{{ t }}</option>
            </select>
            <button
              @click="applyBulkSetAll"
              :disabled="!bulkSetAll"
              class="bg-white hover:bg-gray-50 disabled:opacity-40 border border-gray-300 text-gray-700 text-sm font-semibold px-3 py-2 rounded-lg"
            >
              Apply to all
            </button>
          </div>
        </div>
        <p class="text-xs text-gray-500 pb-2">
          Editing the tribe in force from Episode {{ bulkEpisode }} onward.
        </p>
      </div>

      <table class="w-full text-sm bg-white rounded-xl shadow overflow-hidden">
        <thead class="bg-gray-100 text-gray-600 text-left">
          <tr>
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Tribe</th>
            <th v-if="!bulkMode" class="px-4 py-3">Photo URL</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in contestants" :key="c.id" class="border-t border-gray-100">
            <td class="px-4 py-3 font-medium">{{ c.name }}</td>
            <td class="px-4 py-3">
              <div v-if="bulkMode" class="flex items-center gap-2">
                <span
                  class="inline-block h-3 w-3 shrink-0 rounded-sm border border-gray-200"
                  :style="{
                    backgroundColor: tribeColorOf(bulkTribes[c.id] ?? '') || 'transparent',
                  }"
                ></span>
                <select
                  v-model="bulkTribes[c.id]"
                  class="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">—</option>
                  <option v-for="t in tribeOptions(bulkTribes[c.id] ?? '')" :key="t" :value="t">
                    {{ t }}
                  </option>
                </select>
              </div>
              <template v-else>
                <span v-if="currentTribeOf(c)" class="text-gray-700">{{ currentTribeOf(c) }}</span>
                <span v-else class="text-gray-300">—</span>
                <span v-if="c.assignments.length > 1" class="ml-1 text-xs text-gray-400"
                  >(swapped)</span
                >
              </template>
            </td>
            <td v-if="!bulkMode" class="px-4 py-3 text-gray-400 truncate max-w-xs">
              {{ c.photo_url ?? '—' }}
            </td>
            <td v-if="!bulkMode" class="px-4 py-3 text-right space-x-3">
              <button
                @click="openSwap(c)"
                class="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
              >
                Tribe
              </button>
              <button
                @click="openEdit(c)"
                class="text-blue-600 hover:text-blue-800 text-xs font-medium"
              >
                Edit
              </button>
              <button
                @click="deleteContestant(c.id, c.name)"
                class="text-red-500 hover:text-red-700 text-xs font-medium"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- CSV Import Modal -->
    <div
      v-if="showCsvModal"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      @click.self="closeCsvModal"
    >
      <div class="bg-white rounded-xl shadow-lg w-full max-w-2xl p-6 max-h-[90vh] flex flex-col">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold">Import Cast from CSV</h2>
          <button
            @click="closeCsvModal"
            class="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div class="mb-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 space-y-1">
          <p>Required column: <span class="font-mono font-semibold">name</span></p>
          <p>
            Optional columns:
            <span class="font-mono font-semibold"
              >tribe, photo_url, age, hometown, occupation, bio</span
            >
          </p>
          <button
            @click="downloadTemplate"
            class="text-blue-600 hover:text-blue-800 text-xs font-medium underline mt-1"
          >
            Download template CSV
          </button>
        </div>

        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">Select CSV file</label>
          <input
            ref="csvFileInput"
            type="file"
            accept=".csv,text/csv"
            @change="onCsvFile"
            class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        <p v-if="csvError" class="text-sm text-red-600 mb-3">{{ csvError }}</p>

        <!-- Preview -->
        <div v-if="csvRows.length > 0" class="flex-1 overflow-y-auto min-h-0 mb-4">
          <p class="text-sm text-gray-500 mb-2">
            {{ csvRows.length }} contestant{{ csvRows.length !== 1 ? 's' : '' }} found — preview:
          </p>
          <table class="w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
            <thead class="bg-gray-100 text-gray-600 text-left">
              <tr>
                <th class="px-3 py-2">Name</th>
                <th class="px-3 py-2">Tribe</th>
                <th class="px-3 py-2">Photo URL</th>
                <th class="px-3 py-2">Age</th>
                <th class="px-3 py-2">Hometown</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in csvRows" :key="i" class="border-t border-gray-100">
                <td class="px-3 py-2 font-medium">{{ r.name }}</td>
                <td class="px-3 py-2 text-gray-500">{{ r.tribe || '—' }}</td>
                <td class="px-3 py-2 text-gray-400 max-w-[140px] truncate">
                  {{ r.photo_url || '—' }}
                </td>
                <td class="px-3 py-2 text-gray-500">{{ r.age || '—' }}</td>
                <td class="px-3 py-2 text-gray-500">{{ r.hometown || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex justify-end gap-3 pt-2 border-t border-gray-100 shrink-0">
          <button
            @click="closeCsvModal"
            class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
          >
            Cancel
          </button>
          <button
            @click="importCsv"
            :disabled="csvRows.length === 0 || csvImporting"
            class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg"
          >
            {{
              csvImporting
                ? 'Importing…'
                : `Import ${csvRows.length} Contestant${csvRows.length !== 1 ? 's' : ''}`
            }}
          </button>
        </div>
      </div>
    </div>

    <!-- Create / Edit Modal -->
    <div
      v-if="showForm"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      @click.self="showForm = false"
    >
      <div class="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
        <h2 class="text-lg font-bold mb-4">
          {{ editingId ? 'Edit Contestant' : 'Add Contestant' }}
        </h2>

        <form @submit.prevent="saveContestant" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              v-model="form.name"
              type="text"
              required
              placeholder="e.g. Boston Rob"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Starting tribe <span class="text-gray-400 font-normal">(Ep 1)</span>
            </label>
            <div v-if="tribeNames.length" class="flex items-center gap-2">
              <span
                v-if="tribeColorOf(form.tribe)"
                class="inline-block h-5 w-5 shrink-0 rounded"
                :style="{ backgroundColor: tribeColorOf(form.tribe) }"
              />
              <select
                v-model="form.tribe"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— none —</option>
                <option v-for="name in tribeOptions(form.tribe)" :key="name" :value="name">
                  {{ name }}
                </option>
              </select>
            </div>
            <p v-else class="text-sm text-gray-400">
              No tribes defined for this season yet — add them in
              <span class="font-medium">Admin → Seasons → Tribes</span>.
            </p>
            <p v-if="tribeNames.length" class="mt-1 text-xs text-gray-400">
              Use “Tribe” on the list to record a mid-season swap.
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1"
              >Photo URL <span class="text-gray-400 font-normal">(optional)</span></label
            >
            <input
              v-model="form.photo_url"
              type="url"
              placeholder="https://…"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1"
              >Alternate photo URL <span class="text-gray-400 font-normal">(optional)</span></label
            >
            <input
              v-model="form.alt_image"
              type="url"
              placeholder="https://…"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p class="mt-1 text-xs text-gray-400">
              Shown in place of the main photo in certain views.
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1"
              >YouTube video URL <span class="text-gray-400 font-normal">(optional)</span></label
            >
            <input
              v-model="form.video_url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=…"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p class="mt-1 text-xs text-gray-400">
              Embedded on the contestant's profile. Paste any YouTube link.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1"
                >Age <span class="text-gray-400 font-normal">(optional)</span></label
              >
              <input
                v-model="form.age"
                type="number"
                min="18"
                max="99"
                placeholder="e.g. 32"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1"
                >Hometown <span class="text-gray-400 font-normal">(optional)</span></label
              >
              <input
                v-model="form.hometown"
                type="text"
                placeholder="e.g. Chicago, IL"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1"
              >Occupation <span class="text-gray-400 font-normal">(optional)</span></label
            >
            <input
              v-model="form.occupation"
              type="text"
              placeholder="e.g. Firefighter"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1"
              >Bio <span class="text-gray-400 font-normal">(optional)</span></label
            >
            <textarea
              v-model="form.bio"
              rows="3"
              placeholder="A short description of this castaway…"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>

          <div class="flex justify-end gap-3 pt-2">
            <button
              type="button"
              @click="closeForm"
              class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="saving"
              class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Add contestant' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Tribe swap modal -->
    <div
      v-if="swapContestant"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      @click.self="swapContestant = null"
    >
      <div class="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
        <h2 class="text-lg font-bold mb-1">Change tribe</h2>
        <p class="text-sm text-gray-500 mb-4">{{ swapContestant.name }}</p>

        <!-- Assignment history -->
        <div
          v-if="swapContestant.assignments.length"
          class="mb-4 rounded-lg bg-gray-50 p-3 text-sm"
        >
          <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">History</p>
          <div
            v-for="a in swapContestant.assignments"
            :key="a.id"
            class="flex justify-between py-0.5 text-gray-600"
          >
            <span>{{ a.tribe }}</span>
            <span class="text-gray-400">from Ep {{ a.effective_from_episode }}</span>
          </div>
        </div>

        <form @submit.prevent="saveSwap" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">New tribe</label>
            <div v-if="tribeNames.length" class="flex items-center gap-2">
              <span
                v-if="tribeColorOf(swapForm.tribe)"
                class="inline-block h-5 w-5 shrink-0 rounded"
                :style="{ backgroundColor: tribeColorOf(swapForm.tribe) }"
              />
              <select
                v-model="swapForm.tribe"
                required
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="" disabled>Select…</option>
                <option v-for="name in tribeOptions(swapForm.tribe)" :key="name" :value="name">
                  {{ name }}
                </option>
              </select>
            </div>
            <p v-else class="text-sm text-gray-400">
              No tribes defined for this season — add them in Admin → Seasons → Tribes.
            </p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1"
              >Effective from episode</label
            >
            <select
              v-if="episodes.length"
              v-model.number="swapForm.fromEpisode"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option v-for="e in episodes" :key="e.id" :value="e.number">
                Episode {{ e.number }}{{ e.title ? ': ' + e.title : '' }}
              </option>
            </select>
            <input
              v-else
              v-model.number="swapForm.fromEpisode"
              type="number"
              min="1"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p class="mt-1 text-xs text-gray-400">
              The contestant counts on the new tribe from this episode onward.
            </p>
          </div>

          <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>

          <div class="flex justify-end gap-3 pt-2">
            <button
              type="button"
              @click="swapContestant = null"
              class="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="savingSwap || !swapForm.tribe.trim()"
              class="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              {{ savingSwap ? 'Saving…' : 'Record change' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
