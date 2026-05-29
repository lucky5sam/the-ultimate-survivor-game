<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { supabase } from '../../lib/supabase'

type Season = { id: string; name: string }
type Contestant = {
  id: string; season_id: string; name: string; photo_url: string | null
  bio: string | null; age: number | null; hometown: string | null; occupation: string | null
}
type CsvRow = {
  name: string; tribe: string; photo_url: string
  age: string; hometown: string; occupation: string; bio: string
}

const seasons = ref<Season[]>([])
const selectedSeasonId = ref<string>('')
const contestants = ref<Contestant[]>([])
const loading = ref(false)
const errorMsg = ref('')
const showForm = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)

const form = ref({ name: '', photo_url: '', bio: '', age: '', hometown: '', occupation: '' })

// CSV import state
const showCsvModal = ref(false)
const csvRows = ref<CsvRow[]>([])
const csvError = ref('')
const csvImporting = ref(false)
const csvFileInput = ref<HTMLInputElement | null>(null)

const CSV_TEMPLATE = 'name,tribe,photo_url,age,hometown,occupation,bio\n"Jane Smith","Tagi","https://example.com/jane.jpg",28,"Austin, TX","Engineer","Short bio here."'

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
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
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
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) { csvError.value = 'CSV must have a header row and at least one data row.'; return }
    const headers = parseCsvLine(lines[0]!).map(h => h.toLowerCase().replace(/\s+/g, '_'))
    const col = (name: string) => headers.indexOf(name)
    if (col('name') === -1) { csvError.value = 'CSV must have a "name" column.'; return }
    const rows: CsvRow[] = []
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]!)
      const get = (key: string) => (col(key) >= 0 ? (cells[col(key)] ?? '') : '').trim()
      const name = get('name')
      if (!name) continue
      rows.push({ name, tribe: get('tribe'), photo_url: get('photo_url'), age: get('age'), hometown: get('hometown'), occupation: get('occupation'), bio: get('bio') })
    }
    if (rows.length === 0) { csvError.value = 'No valid rows found.'; return }
    csvRows.value = rows
  }
  reader.readAsText(file)
}

async function importCsv() {
  if (!selectedSeasonId.value || csvRows.value.length === 0) return
  csvImporting.value = true
  csvError.value = ''

  const contestantPayloads = csvRows.value.map(r => ({
    name: r.name,
    season_id: selectedSeasonId.value,
    photo_url: r.photo_url || null,
    bio: r.bio || null,
    age: r.age ? parseInt(r.age) : null,
    hometown: r.hometown || null,
    occupation: r.occupation || null,
  }))

  const { data: inserted, error: e1 } = await supabase
    .from('contestants')
    .insert(contestantPayloads)
    .select('id, name')

  if (e1 || !inserted) {
    csvError.value = e1?.message ?? 'Insert failed.'
    csvImporting.value = false
    return
  }

  // Build a name → id map for tribe assignments
  const nameToId = new Map(inserted.map(c => [c.name, c.id]))

  const tribeRows = csvRows.value
    .filter(r => r.tribe)
    .map(r => ({ contestant_id: nameToId.get(r.name), tribe: r.tribe, effective_from_episode: 1 }))
    .filter(r => r.contestant_id)

  if (tribeRows.length > 0) {
    const { error: e2 } = await supabase.from('contestant_tribe_assignments').insert(tribeRows)
    if (e2) { csvError.value = e2.message; csvImporting.value = false; return }
  }

  showCsvModal.value = false
  csvRows.value = []
  if (csvFileInput.value) csvFileInput.value.value = ''
  await loadContestants()
  csvImporting.value = false
}

function closeCsvModal() {
  showCsvModal.value = false
  csvRows.value = []
  csvError.value = ''
  if (csvFileInput.value) csvFileInput.value.value = ''
}

async function loadSeasons() {
  const { data } = await supabase.from('seasons').select('id, name').order('created_at', { ascending: false })
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
    .select('*')
    .eq('season_id', selectedSeasonId.value)
    .order('name')
  if (error) errorMsg.value = error.message
  else contestants.value = data ?? []
  loading.value = false
}

async function saveContestant() {
  saving.value = true
  errorMsg.value = ''
  const payload = {
    name: form.value.name,
    photo_url: form.value.photo_url || null,
    bio: form.value.bio || null,
    age: form.value.age ? parseInt(form.value.age) : null,
    hometown: form.value.hometown || null,
    occupation: form.value.occupation || null,
    season_id: selectedSeasonId.value,
  }

  if (editingId.value) {
    const { error } = await supabase.from('contestants').update(payload).eq('id', editingId.value)
    if (error) { errorMsg.value = error.message; saving.value = false; return }
  } else {
    const { error } = await supabase.from('contestants').insert(payload)
    if (error) { errorMsg.value = error.message; saving.value = false; return }
  }

  showForm.value = false
  resetForm()
  await loadContestants()
  saving.value = false
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
    bio: c.bio ?? '',
    age: c.age !== null ? String(c.age) : '',
    hometown: c.hometown ?? '',
    occupation: c.occupation ?? '',
  }
  showForm.value = true
}

function resetForm() {
  form.value = { name: '', photo_url: '', bio: '', age: '', hometown: '', occupation: '' }
}

watch(selectedSeasonId, loadContestants)
onMounted(async () => { await loadSeasons(); await loadContestants() })
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Contestants</h1>
      <div class="flex gap-2">
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

    <table v-else class="w-full text-sm bg-white rounded-xl shadow overflow-hidden">
      <thead class="bg-gray-100 text-gray-600 text-left">
        <tr>
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Photo URL</th>
          <th class="px-4 py-3"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in contestants" :key="c.id" class="border-t border-gray-100">
          <td class="px-4 py-3 font-medium">{{ c.name }}</td>
          <td class="px-4 py-3 text-gray-400 truncate max-w-xs">{{ c.photo_url ?? '—' }}</td>
          <td class="px-4 py-3 text-right space-x-3">
            <button @click="openEdit(c)" class="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
            <button @click="deleteContestant(c.id, c.name)" class="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- CSV Import Modal -->
    <div
      v-if="showCsvModal"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      @click.self="closeCsvModal"
    >
      <div class="bg-white rounded-xl shadow-lg w-full max-w-2xl p-6 max-h-[90vh] flex flex-col">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold">Import Cast from CSV</h2>
          <button @click="closeCsvModal" class="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div class="mb-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 space-y-1">
          <p>Required column: <span class="font-mono font-semibold">name</span></p>
          <p>Optional columns: <span class="font-mono font-semibold">tribe, photo_url, age, hometown, occupation, bio</span></p>
          <button @click="downloadTemplate" class="text-blue-600 hover:text-blue-800 text-xs font-medium underline mt-1">
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
          <p class="text-sm text-gray-500 mb-2">{{ csvRows.length }} contestant{{ csvRows.length !== 1 ? 's' : '' }} found — preview:</p>
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
                <td class="px-3 py-2 text-gray-400 max-w-[140px] truncate">{{ r.photo_url || '—' }}</td>
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
            {{ csvImporting ? 'Importing…' : `Import ${csvRows.length} Contestant${csvRows.length !== 1 ? 's' : ''}` }}
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
        <h2 class="text-lg font-bold mb-4">{{ editingId ? 'Edit Contestant' : 'Add Contestant' }}</h2>

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
            <label class="block text-sm font-medium text-gray-700 mb-1">Photo URL <span class="text-gray-400 font-normal">(optional)</span></label>
            <input
              v-model="form.photo_url"
              type="url"
              placeholder="https://…"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Age <span class="text-gray-400 font-normal">(optional)</span></label>
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
              <label class="block text-sm font-medium text-gray-700 mb-1">Hometown <span class="text-gray-400 font-normal">(optional)</span></label>
              <input
                v-model="form.hometown"
                type="text"
                placeholder="e.g. Chicago, IL"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Occupation <span class="text-gray-400 font-normal">(optional)</span></label>
            <input
              v-model="form.occupation"
              type="text"
              placeholder="e.g. Firefighter"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Bio <span class="text-gray-400 font-normal">(optional)</span></label>
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
              @click="showForm = false; resetForm()"
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
  </div>
</template>
