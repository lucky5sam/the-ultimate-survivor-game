<script setup lang="ts">
import { ref, computed, watchEffect, onMounted } from 'vue'
import { supabase } from '../../lib/supabase'

type CatalogAction = {
  tempId: string
  id?: string
  type: string
  category: string
  points: number
  sort_order: number
  selected: boolean
}

const actions = ref<CatalogAction[]>([])
const loading = ref(true)
const saving = ref(false)
const errorMsg = ref('')
const masterCheckboxRef = ref<HTMLInputElement | null>(null)

const allSelected = computed(() => actions.value.length > 0 && actions.value.every(a => a.selected))
const someSelected = computed(() => actions.value.some(a => a.selected))
const selectedCount = computed(() => actions.value.filter(a => a.selected).length)

watchEffect(() => {
  if (masterCheckboxRef.value) {
    masterCheckboxRef.value.indeterminate = someSelected.value && !allSelected.value
  }
})

function makeLocal(raw: Partial<CatalogAction> = {}): CatalogAction {
  return {
    tempId: raw.id ?? crypto.randomUUID(),
    id: raw.id,
    type: raw.type ?? '',
    category: raw.category ?? '',
    points: raw.points ?? 0,
    sort_order: raw.sort_order ?? 0,
    selected: false,
  }
}

function toggleSelectAll() {
  const next = !allSelected.value
  actions.value.forEach(a => (a.selected = next))
}

function addRow() {
  actions.value.push(makeLocal())
}

function removeRow(idx: number) {
  actions.value.splice(idx, 1)
}

function removeSelected() {
  actions.value = actions.value.filter(a => !a.selected)
}

async function load() {
  loading.value = true
  const { data, error } = await supabase
    .from('action_types')
    .select('id, type, category, points, sort_order')
    .order('sort_order')
  if (error) errorMsg.value = error.message
  else actions.value = (data ?? []).map(a => makeLocal(a))
  loading.value = false
}

async function save() {
  saving.value = true
  errorMsg.value = ''

  const { data: originals } = await supabase.from('action_types').select('id')
  const rows = actions.value.filter(a => a.type.trim() && a.category.trim())
  const currentIds = new Set(rows.filter(a => a.id).map(a => a.id))
  const deletedIds = (originals ?? []).map(r => r.id).filter(id => !currentIds.has(id))

  if (deletedIds.length) {
    await supabase.from('action_types').delete().in('id', deletedIds)
  }

  const toUpsert = rows.map((a, i) => ({
    ...(a.id ? { id: a.id } : {}),
    type: a.type.trim(),
    category: a.category.trim(),
    points: a.points,
    sort_order: i,
  }))

  if (toUpsert.length) {
    const { error } = await supabase.from('action_types').upsert(toUpsert, { onConflict: 'id' })
    if (error) { errorMsg.value = error.message; saving.value = false; return }
  }

  await load()
  saving.value = false
}

onMounted(load)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold">Action Types</h1>
        <p class="text-sm text-gray-500 mt-1">Global catalog of scoring actions. Seasons inherit from this list.</p>
      </div>
      <button
        @click="save"
        :disabled="saving"
        class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
      >
        {{ saving ? 'Saving…' : 'Save changes' }}
      </button>
    </div>

    <p v-if="errorMsg" class="text-red-600 text-sm mb-4">{{ errorMsg }}</p>
    <div v-if="loading" class="text-gray-400 text-sm">Loading…</div>

    <div v-else class="bg-white rounded-xl shadow overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <p class="text-sm text-gray-500">
          {{ actions.length }} action{{ actions.length !== 1 ? 's' : '' }}
        </p>
        <div class="flex items-center gap-3">
          <button
            v-if="selectedCount > 0"
            @click="removeSelected"
            class="text-xs text-red-600 hover:text-red-800 font-medium"
          >Remove selected ({{ selectedCount }})</button>
          <button @click="addRow" class="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Add row</button>
        </div>
      </div>

      <table class="w-full text-sm">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="w-10 px-3 py-2 text-center">
              <input
                ref="masterCheckboxRef"
                type="checkbox"
                :checked="allSelected"
                @change="toggleSelectAll"
                class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 w-40">Type</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Category</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 w-28">Points</th>
            <th class="w-8"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="actions.length === 0">
            <td colspan="5" class="px-3 py-8 text-center text-sm text-gray-400">
              No action types yet. Click "+ Add row" to create one.
            </td>
          </tr>
          <tr
            v-for="(action, idx) in actions"
            :key="action.tempId"
            :class="['border-t border-gray-100', action.selected ? 'bg-blue-50' : '']"
          >
            <td class="px-3 py-1.5 text-center">
              <input
                type="checkbox"
                v-model="action.selected"
                class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </td>
            <td class="px-3 py-1.5">
              <input
                v-model="action.type"
                type="text"
                placeholder="e.g. Challenge"
                class="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </td>
            <td class="px-3 py-1.5">
              <input
                v-model="action.category"
                type="text"
                placeholder="e.g. Won Individual Immunity"
                class="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </td>
            <td class="px-3 py-1.5">
              <input
                v-model.number="action.points"
                type="number"
                class="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </td>
            <td class="px-3 py-1.5 text-center">
              <button
                @click="removeRow(idx)"
                class="text-gray-300 hover:text-red-500 text-base leading-none"
              >✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
