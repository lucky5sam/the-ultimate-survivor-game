<script setup lang="ts">
// Admin control of League Chat: create custom threads (optionally tied to an
// episode for Spoiler Protection), rename/close any thread, give it a square
// image, mark it the Highlight (featured on League Home — one per season; a new
// highlight replaces the old), and mute players.
// Episode threads are created automatically by a DB trigger (db/chat.sql).
// Deleting individual messages happens inline on the player Chat page.
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import LoadingState from '../../components/LoadingState.vue'
import ImageUploadField from '../../components/ImageUploadField.vue'
import { uploadImage, deleteImageByUrl } from '../../lib/uploadImage'
import { threadLabel, type ChatThread } from '../../stores/chat'

type Season = { id: string; name: string }
type Episode = {
  id: string
  number: number
  title: string | null
  status: string
  locks_at: string | null
}
type Player = { id: string; name: string }

const seasons = ref<Season[]>([])
const selectedSeasonId = ref('')
const episodes = ref<Episode[]>([])
const threads = ref<ChatThread[]>([])
const players = ref<Player[]>([])
const mutedIds = ref<string[]>([])
const loading = ref(false)
const errorMsg = ref('')

const episodesById = computed(() => Object.fromEntries(episodes.value.map((e) => [e.id, e])))
const playersById = computed(() => Object.fromEntries(players.value.map((p) => [p.id, p])))
const sortedThreads = computed(() =>
  [...threads.value].sort((a, b) => {
    const na = a.episode_id ? (episodesById.value[a.episode_id]?.number ?? 0) : Infinity
    const nb = b.episode_id ? (episodesById.value[b.episode_id]?.number ?? 0) : Infinity
    return nb - na || a.kind.localeCompare(b.kind) || b.created_at.localeCompare(a.created_at)
  }),
)
const unmutedPlayers = computed(() => players.value.filter((p) => !mutedIds.value.includes(p.id)))

function label(t: ChatThread) {
  return threadLabel(t, t.episode_id ? (episodesById.value[t.episode_id] ?? null) : null)
}

async function loadSeasons() {
  const { data } = await supabase
    .from('seasons')
    .select('id, name')
    .order('created_at', { ascending: false })
  seasons.value = data ?? []
  if (seasons.value.length && !selectedSeasonId.value) selectedSeasonId.value = seasons.value[0]!.id
}

async function loadSeason() {
  const sid = selectedSeasonId.value
  if (!sid) return
  loading.value = true
  errorMsg.value = ''
  const [epRes, thRes, profRes, muteRes] = await Promise.all([
    supabase
      .from('episodes')
      .select('id, number, title, status, locks_at')
      .eq('season_id', sid)
      .order('number'),
    supabase.from('chat_threads').select('*').eq('season_id', sid),
    supabase.from('profiles').select('id, first_name, last_name').order('first_name'),
    supabase.from('chat_mutes').select('user_id'),
  ])
  loading.value = false
  const err = epRes.error ?? thRes.error ?? profRes.error ?? muteRes.error
  if (err) {
    errorMsg.value = err.message
    return
  }
  episodes.value = epRes.data ?? []
  threads.value = (thRes.data ?? []) as ChatThread[]
  players.value = (profRes.data ?? []).map((p) => ({
    id: p.id,
    name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed player',
  }))
  mutedIds.value = (muteRes.data ?? []).map((m) => m.user_id)
}

onMounted(async () => {
  await loadSeasons()
  await loadSeason()
})
watch(selectedSeasonId, loadSeason)

// ---- New custom thread ----
// New custom threads start highlighted (replacing the current highlight); untick
// to keep the existing one.
const form = ref({ title: '', description: '', episode_id: '', is_highlight: true })
const formImage = ref<File | null>(null)
// Bumped after a create to remount the picker, clearing its local preview.
const formImageKey = ref(0)
const creating = ref(false)
async function createThread() {
  if (!form.value.title.trim()) return
  creating.value = true
  errorMsg.value = ''
  try {
    const image_url = formImage.value ? await uploadImage(formImage.value, 'chat') : null
    const { data, error } = await supabase
      .from('chat_threads')
      .insert({
        season_id: selectedSeasonId.value,
        kind: 'custom',
        title: form.value.title.trim(),
        description: form.value.description.trim() || null,
        episode_id: form.value.episode_id || null,
        image_url,
        is_highlight: form.value.is_highlight,
      })
      .select('id')
      .single()
    if (error) throw error
    if (form.value.is_highlight) await clearOtherHighlights(data.id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to create thread'
    return
  } finally {
    creating.value = false
  }
  form.value = { title: '', description: '', episode_id: '', is_highlight: true }
  formImage.value = null
  formImageKey.value++
  await loadSeason()
}

// ---- Edit existing threads ----
const editingId = ref<string | null>(null)
const editForm = ref({ title: '', description: '', episode_id: '' })
// A newly picked image, or a request to remove the current one.
const editImage = ref<File | null>(null)
const editImageRemoved = ref(false)
const savingEdit = ref(false)
function startEdit(t: ChatThread) {
  editingId.value = t.id
  editImage.value = null
  editImageRemoved.value = false
  editForm.value = {
    title: t.title ?? '',
    description: t.description ?? '',
    episode_id: t.episode_id ?? '',
  }
}
async function saveEdit(t: ChatThread) {
  // Custom threads need a title; a blank title on an episode thread falls back
  // to "Episode N: <title>".
  if (t.kind === 'custom' && !editForm.value.title.trim()) return
  const update: Partial<ChatThread> = {
    title: editForm.value.title.trim() || null,
    description: editForm.value.description.trim() || null,
  }
  if (t.kind === 'custom') update.episode_id = editForm.value.episode_id || null
  savingEdit.value = true
  errorMsg.value = ''
  try {
    if (editImage.value) update.image_url = await uploadImage(editImage.value, 'chat')
    else if (editImageRemoved.value) update.image_url = null
    const { error } = await supabase.from('chat_threads').update(update).eq('id', t.id)
    if (error) throw error
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to save thread'
    return
  } finally {
    savingEdit.value = false
  }
  // The old file is no longer referenced once the row points elsewhere.
  if ('image_url' in update && t.image_url !== update.image_url) deleteImageByUrl(t.image_url)
  editingId.value = null
  await loadSeason()
}

// Only one highlight per season. Callers set the new one first, then clear the
// rest, so a failure part-way never leaves the season without a highlight.
async function clearOtherHighlights(keepId: string) {
  const { error } = await supabase
    .from('chat_threads')
    .update({ is_highlight: false })
    .eq('season_id', selectedSeasonId.value)
    .eq('is_highlight', true)
    .neq('id', keepId)
  if (error) throw error
}

async function toggleHighlight(t: ChatThread) {
  errorMsg.value = ''
  try {
    const { error } = await supabase
      .from('chat_threads')
      .update({ is_highlight: !t.is_highlight })
      .eq('id', t.id)
    if (error) throw error
    if (!t.is_highlight) await clearOtherHighlights(t.id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to update highlight'
  }
  await loadSeason()
}

async function toggleLock(t: ChatThread) {
  const { error } = await supabase
    .from('chat_threads')
    .update({ is_locked: !t.is_locked })
    .eq('id', t.id)
  if (error) errorMsg.value = error.message
  else await loadSeason()
}

async function deleteThread(t: ChatThread) {
  if (!confirm(`Delete "${label(t)}" and all its messages? This cannot be undone.`)) return
  const { error } = await supabase.from('chat_threads').delete().eq('id', t.id)
  if (error) errorMsg.value = error.message
  else {
    deleteImageByUrl(t.image_url)
    await loadSeason()
  }
}

// ---- Mutes ----
const muteId = ref('')
async function mute() {
  if (!muteId.value) return
  const { error } = await supabase.from('chat_mutes').insert({ user_id: muteId.value })
  if (error) errorMsg.value = error.message
  else {
    muteId.value = ''
    await loadSeason()
  }
}
async function unmute(id: string) {
  const { error } = await supabase.from('chat_mutes').delete().eq('user_id', id)
  if (error) errorMsg.value = error.message
  else await loadSeason()
}

function episodeOption(e: Episode) {
  return `Episode ${e.number}${e.title ? `: ${e.title}` : ''}`
}
</script>

<template>
  <div class="max-w-4xl">
    <h1 class="mb-6 text-2xl font-bold">Chat</h1>

    <div class="mb-6">
      <label class="mb-1 block text-sm font-medium text-gray-700">Season</label>
      <select
        v-model="selectedSeasonId"
        class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <p v-if="errorMsg" class="mb-4 text-sm text-red-600">{{ errorMsg }}</p>
    <LoadingState v-if="loading && !threads.length" />

    <template v-else>
      <!-- New custom thread -->
      <section class="mb-8 rounded-xl border border-gray-200 bg-white p-5">
        <h2 class="mb-1 text-sm font-semibold text-gray-800">New thread</h2>
        <p class="mb-4 text-xs text-gray-500">
          Episode threads are created automatically and open when rosters lock. Tie a custom thread
          to an episode to hide it from players who haven't watched that episode yet.
        </p>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="createThread">
          <input
            v-model="form.title"
            placeholder="Title (e.g. Merge predictions)"
            maxlength="120"
            class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            v-model="form.episode_id"
            class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">None (general, no spoiler gate)</option>
            <option v-for="e in episodes" :key="e.id" :value="e.id">
              Spoiler-gated to {{ episodeOption(e) }}
            </option>
          </select>
          <input
            v-model="form.description"
            placeholder="Description (optional)"
            maxlength="300"
            class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:col-span-2"
          />
          <div class="sm:col-span-2">
            <ImageUploadField
              :key="formImageKey"
              :model-value="null"
              label="Cover image (optional)"
              shape="cover"
              :size="72"
              @select="formImage = $event"
              @remove="formImage = null"
            />
          </div>
          <label class="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
            <input v-model="form.is_highlight" type="checkbox" class="h-4 w-4 rounded" />
            Highlight on League Home (replaces the current highlight)
          </label>
          <div class="sm:col-span-2">
            <button
              type="submit"
              :disabled="creating || !form.title.trim()"
              class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {{ creating ? 'Creating…' : '+ Create Thread' }}
            </button>
          </div>
        </form>
      </section>

      <!-- Threads -->
      <section class="mb-8 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <h2 class="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-800">
          Threads
        </h2>
        <p v-if="!sortedThreads.length" class="px-5 py-4 text-sm text-gray-500">No threads yet.</p>
        <div
          v-for="t in sortedThreads"
          :key="t.id"
          class="border-b border-gray-100 px-5 py-3 last:border-b-0"
        >
          <form
            v-if="editingId === t.id"
            class="grid gap-2 sm:grid-cols-2"
            @submit.prevent="saveEdit(t)"
          >
            <input
              v-model="editForm.title"
              :placeholder="t.kind === 'episode' ? label({ ...t, title: null }) : 'Title'"
              maxlength="120"
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
            <select
              v-if="t.kind === 'custom'"
              v-model="editForm.episode_id"
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="">None (general, no spoiler gate)</option>
              <option v-for="e in episodes" :key="e.id" :value="e.id">
                Spoiler-gated to {{ episodeOption(e) }}
              </option>
            </select>
            <input
              v-model="editForm.description"
              placeholder="Description (optional)"
              maxlength="300"
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm sm:col-span-2"
            />
            <div class="sm:col-span-2">
              <ImageUploadField
                :model-value="editImageRemoved ? null : t.image_url"
                label="Cover image (optional)"
                shape="cover"
                :size="72"
                @select="
                  (f: File) => {
                    editImage = f
                    editImageRemoved = false
                  }
                "
                @remove="
                  () => {
                    editImage = null
                    editImageRemoved = true
                  }
                "
              />
            </div>
            <div class="space-x-3 sm:col-span-2">
              <button
                type="submit"
                :disabled="savingEdit"
                class="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-40"
              >
                {{ savingEdit ? 'Saving…' : 'Save' }}
              </button>
              <button
                type="button"
                class="text-xs text-gray-500 hover:text-gray-700"
                @click="editingId = null"
              >
                Cancel
              </button>
            </div>
          </form>

          <div v-else class="flex items-start justify-between gap-4">
            <img
              v-if="t.image_url"
              :src="t.image_url"
              alt=""
              class="h-8 w-16 shrink-0 rounded-sm object-cover"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-900">
                {{ label(t) }}
                <span
                  v-if="t.is_highlight"
                  class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                  >Highlight</span
                >
                <span
                  v-if="t.is_locked"
                  class="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                  >Closed</span
                >
              </p>
              <p class="text-xs text-gray-500">
                {{ t.kind === 'episode' ? 'Episode thread' : 'Custom thread' }}
                <template v-if="t.kind === 'custom' && t.episode_id">
                  · gated to Episode {{ episodesById[t.episode_id]?.number }}
                </template>
                <template v-else-if="t.kind === 'custom'"> · general</template>
                <template v-if="t.description"> · {{ t.description }}</template>
              </p>
            </div>
            <div class="shrink-0 space-x-3 whitespace-nowrap">
              <button
                class="text-xs font-medium text-blue-600 hover:text-blue-800"
                @click="startEdit(t)"
              >
                Edit
              </button>
              <button
                class="text-xs font-medium text-amber-700 hover:text-amber-900"
                @click="toggleHighlight(t)"
              >
                {{ t.is_highlight ? 'Unhighlight' : 'Highlight' }}
              </button>
              <button
                class="text-xs font-medium text-gray-600 hover:text-gray-900"
                @click="toggleLock(t)"
              >
                {{ t.is_locked ? 'Reopen' : 'Close' }}
              </button>
              <button
                v-if="t.kind === 'custom'"
                class="text-xs font-medium text-red-600 hover:text-red-800"
                @click="deleteThread(t)"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Mutes -->
      <section class="rounded-xl border border-gray-200 bg-white p-5">
        <h2 class="mb-1 text-sm font-semibold text-gray-800">Muted players</h2>
        <p class="mb-4 text-xs text-gray-500">
          Muted players can still read chat but can't post. Applies across all seasons.
        </p>
        <div class="mb-4 flex gap-2">
          <select
            v-model="muteId"
            class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Choose a player…</option>
            <option v-for="p in unmutedPlayers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <button
            :disabled="!muteId"
            class="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-40"
            @click="mute"
          >
            Mute
          </button>
        </div>
        <p v-if="!mutedIds.length" class="text-sm text-gray-500">No one is muted.</p>
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="id in mutedIds" :key="id" class="flex items-center justify-between py-2">
            <span class="text-sm text-gray-800">{{
              playersById[id]?.name ?? 'Unknown player'
            }}</span>
            <button
              class="text-xs font-medium text-blue-600 hover:text-blue-800"
              @click="unmute(id)"
            >
              Unmute
            </button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
