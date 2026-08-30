<script setup lang="ts">
import { getTribeColors } from '../utils/tribeColors'
import { displayName, shortName } from '../utils/contestantName'
import { computed, ref, watch, onUnmounted } from 'vue'
import { supabase } from '../lib/supabase'
import parchmentUrl from '../assets/survivor_decor_parchment.svg'
import type { ContestantFull } from '../types/contestant'

// One scored action for the Event Log tab. `points` is the per-action value and
// `count` how many times it happened that episode; the line total is points×count.
export type ContestantEventItem = {
  episodeNumber: number
  label: string
  points: number
  count: number
}

const props = withDefaults(
  defineProps<{
    contestant: ContestantFull | null
    show: boolean
    seasonName?: string
    // When set, the modal shows Info / Event Log tabs. The parent supplies the
    // events (fetched on open) and the loading flag. Off by default so the
    // wizard's info-only usage is unchanged.
    showEventLog?: boolean
    events?: ContestantEventItem[]
    eventsLoading?: boolean
    // When set, adds a Votes tab and self-fetches this contestant's per-episode
    // voting record (who they voted for, and who voted for them).
    showVotes?: boolean
  }>(),
  { showEventLog: false, events: () => [], eventsLoading: false, showVotes: false },
)

const emit = defineEmits<{ close: [] }>()

const colors = computed(() => (props.contestant ? getTribeColors(props.contestant.tribe) : null))

// True once the photo has scrolled far enough that the identity/tabs bar is
// stuck to the top. Drives which close button is shown (over the photo vs. in
// the header). The photo is h-72 (288px); flip a bit before it's fully gone.
const scrollEl = ref<HTMLElement | null>(null)
const stuck = ref(false)
function onScroll() {
  stuck.value = (scrollEl.value?.scrollTop ?? 0) > 240
}

// Lock background scroll while the modal is open, restoring it on close/unmount.
// Also reset the scroll position/stuck state each time it opens.
watch(
  () => props.show,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) stuck.value = false
  },
)
onUnmounted(() => {
  document.body.style.overflow = ''
})

type TabId = 'info' | 'events' | 'votes'
const activeTab = ref<TabId>('info')

// The tab bar: Info always, then Event Log / Votes when their data is enabled.
const tabs = computed(() => {
  const t: { id: TabId; label: string }[] = [{ id: 'info', label: 'Info' }]
  if (props.showEventLog) t.push({ id: 'events', label: 'Event Log' })
  if (props.showVotes) t.push({ id: 'votes', label: 'Votes' })
  return t
})

// Per-episode voting record for this contestant, newest episode first.
// `success` (voted-for only) is whether the target was eliminated that episode.
type VoteRef = { name: string; nullified: boolean; success?: boolean }
type VoteEpisode = { episodeNumber: number; votedFor: VoteRef[]; votedBy: VoteRef[] }
const votes = ref<VoteEpisode[]>([])
const votesLoading = ref(false)

async function loadVotes() {
  const c = props.contestant
  if (!c) return
  votesLoading.value = true
  votes.value = []
  try {
    const { data } = await supabase
      .from('episode_votes')
      .select(
        'nullified, voter_contestant_id, target_contestant_id,' +
          ' episode:episodes!episode_votes_episode_id_fkey(id, number),' +
          ' voter:contestants!episode_votes_voter_fkey(first_name, last_name, preferred_name),' +
          ' target:contestants!episode_votes_target_fkey(first_name, last_name, preferred_name, eliminated_episode_id)',
      )
      .or(`voter_contestant_id.eq.${c.id},target_contestant_id.eq.${c.id}`)

    const byEp = new Map<number, VoteEpisode>()
    for (const row of (data ?? []) as any[]) {
      const num = row.episode?.number
      if (num == null) continue
      if (!byEp.has(num)) byEp.set(num, { episodeNumber: num, votedFor: [], votedBy: [] })
      const group = byEp.get(num)!
      if (row.voter_contestant_id === c.id && row.target) {
        // Successful = the person voted for was eliminated in this same episode.
        const success =
          !!row.target.eliminated_episode_id && row.target.eliminated_episode_id === row.episode?.id
        group.votedFor.push({ name: shortName(row.target), nullified: row.nullified, success })
      }
      if (row.target_contestant_id === c.id && row.voter) {
        group.votedBy.push({ name: shortName(row.voter), nullified: row.nullified })
      }
    }
    votes.value = [...byEp.values()].sort((a, b) => b.episodeNumber - a.episodeNumber)
  } finally {
    votesLoading.value = false
  }
}

// Always land on Info when the modal opens or the contestant changes, and (re)load
// the voting record when the Votes tab is enabled.
watch(
  () => [props.show, props.contestant?.id],
  () => {
    activeTab.value = 'info'
    if (props.show && props.showVotes && props.contestant) loadVotes()
  },
)

// Events grouped by episode, newest first, with a per-episode point subtotal.
const eventsByEpisode = computed(() => {
  const groups = new Map<number, ContestantEventItem[]>()
  for (const e of props.events) {
    if (!groups.has(e.episodeNumber)) groups.set(e.episodeNumber, [])
    groups.get(e.episodeNumber)!.push(e)
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([episodeNumber, items]) => ({
      episodeNumber,
      items,
      subtotal: items.reduce((s, i) => s + i.points * i.count, 0),
    }))
})

function fmtPts(n: number) {
  const s = n.toFixed(1)
  return n > 0 ? `+${s}` : s
}

// The header shows the alt image when set, falling back to the main photo. It's
// cropped to cover, anchored to the top so the contestant's face stays in frame.
const headerImage = computed(
  () => props.contestant?.alt_image ?? props.contestant?.photo_url ?? null,
)

// Turn any common YouTube link (watch?v=, youtu.be/, /embed/, /shorts/) into a
// privacy-friendly embed URL. Returns null for empty or unrecognized values so
// the video block only renders when we have something playable.
const embedUrl = computed(() => {
  const url = props.contestant?.video_url?.trim()
  if (!url) return null
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m?.[1]) return `https://www.youtube-nocookie.com/embed/${m[1]}`
  }
  return null
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="show && contestant"
        class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
        @click.self="emit('close')"
      >
        <div
          ref="scrollEl"
          class="bg-stone-900 rounded-2xl border border-stone-700 w-full max-w-md overflow-y-auto shadow-2xl max-h-[90vh]"
          @scroll="onScroll"
        >
          <!-- Photo — scrolls away with the rest of the content -->
          <div class="relative h-72 overflow-hidden bg-stone-800">
            <img
              v-if="headerImage"
              :src="headerImage"
              :alt="displayName(contestant)"
              class="absolute inset-0 h-full w-full object-cover object-[center_10%]"
            />
            <div v-else class="absolute inset-0 flex items-center justify-center">
              <i class="fa-solid fa-user text-8xl text-stone-600"></i>
            </div>
            <div
              class="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/10 to-transparent"
            />
            <!-- Tribe accent bar -->
            <div
              class="absolute bottom-0 left-0 right-0 h-1"
              :style="{ backgroundColor: colors?.primary }"
            />
            <!-- Close button over the photo (until the header sticks) -->
            <button
              class="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-opacity hover:bg-black/90"
              :class="stuck ? 'pointer-events-none opacity-0' : 'opacity-100'"
              @click="emit('close')"
            >
              <i class="fa-solid fa-xmark text-base"></i>
            </button>
          </div>

          <!-- Identity + tabs: sticks to the top of the modal once the photo
               scrolls past it. Opaque background so content scrolls underneath. -->
          <div class="sticky top-0 z-20 border-b border-stone-800 bg-stone-900">
            <div class="flex items-start justify-between gap-3 px-5 pt-4">
              <div>
                <h2 class="text-2xl font-bold text-white">
                  {{ displayName(contestant)
                  }}<span v-if="contestant.age">, {{ contestant.age }}</span>
                </h2>
                <div class="flex items-center gap-2 mt-1 flex-wrap">
                  <span class="text-sm font-semibold" :style="{ color: colors?.text }">{{
                    contestant.tribe
                  }}</span>
                  <span v-if="seasonName" class="text-text-subtle text-sm">{{ seasonName }}</span>
                </div>
              </div>
              <!-- Close button in the header — appears once the bar is stuck -->
              <button
                class="-mr-1.5 shrink-0 rounded-full p-1.5 text-stone-400 transition-opacity hover:bg-stone-800 hover:text-white"
                :class="stuck ? 'opacity-100' : 'pointer-events-none opacity-0'"
                @click="emit('close')"
              >
                <i class="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <!-- Tabs -->
            <div v-if="tabs.length > 1" class="mt-3 flex gap-4 px-5">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                class="-mb-px border-b-2 pb-2 text-sm font-semibold transition-colors"
                :class="
                  activeTab === tab.id
                    ? 'border-white text-white'
                    : 'border-transparent text-stone-500 hover:text-stone-300'
                "
                @click="activeTab = tab.id"
              >
                {{ tab.label }}
              </button>
            </div>
            <div v-else class="h-4"></div>
          </div>

          <!-- Content -->
          <div class="p-5">
            <!-- ── Info tab ── -->
            <template v-if="activeTab === 'info'">
              <!-- Stats grid -->
              <div class="grid grid-cols-2 gap-2 mb-4">
                <div class="bg-stone-800 rounded-lg p-3 text-left">
                  <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Hometown</p>
                  <p class="font-semibold text-white text-sm leading-snug line-clamp-2">
                    {{ contestant.hometown ?? 'TBD' }}
                  </p>
                </div>
                <div class="bg-stone-800 rounded-lg p-3 text-left">
                  <p class="text-xs text-stone-500 mb-1 uppercase tracking-wide">Occupation</p>
                  <p class="font-semibold text-white text-sm leading-snug line-clamp-2">
                    {{ contestant.occupation ?? 'TBD' }}
                  </p>
                </div>
              </div>

              <!-- Video -->
              <div v-if="embedUrl" class="mb-4">
                <p class="text-xs text-stone-500 mb-2 uppercase tracking-wide">Video</p>
                <div class="relative aspect-video overflow-hidden rounded-xl bg-stone-800">
                  <iframe
                    :src="embedUrl"
                    :title="`${displayName(contestant)} video`"
                    class="absolute inset-0 h-full w-full"
                    frameborder="0"
                    allow="
                      accelerometer;
                      autoplay;
                      clipboard-write;
                      encrypted-media;
                      gyroscope;
                      picture-in-picture;
                      web-share;
                    "
                    allowfullscreen
                  />
                </div>
              </div>

              <!-- Bio -->
              <div class="bg-stone-800 rounded-xl p-4">
                <p class="text-xs text-stone-500 mb-2 uppercase tracking-wide">About</p>
                <p class="text-sm text-stone-200 leading-relaxed">
                  {{
                    contestant.bio ?? 'No bio available yet. Check back after the season premieres.'
                  }}
                </p>
              </div>
            </template>

            <!-- ── Event Log tab ── -->
            <template v-else-if="activeTab === 'events'">
              <div v-if="eventsLoading" class="py-8 text-center text-sm text-stone-500">
                Loading events…
              </div>
              <div
                v-else-if="eventsByEpisode.length === 0"
                class="py-8 text-center text-sm text-stone-500"
              >
                No scored events yet.
              </div>
              <div v-else class="space-y-4">
                <div v-for="group in eventsByEpisode" :key="group.episodeNumber">
                  <p class="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Episode {{ group.episodeNumber }}
                  </p>
                  <div class="overflow-hidden">
                    <div
                      v-for="(item, i) in group.items"
                      :key="i"
                      class="flex items-center justify-between border-b border-stone-700/60 py-2 last:border-0"
                    >
                      <p class="text-sm font-medium text-stone-200">
                        {{ item.label }}
                        <span v-if="item.count > 1" class="text-stone-500">×{{ item.count }}</span>
                      </p>
                      <p
                        class="text-sm font-semibold tabular-nums"
                        :class="item.points >= 0 ? 'text-emerald-400' : 'text-red-400'"
                      >
                        {{ fmtPts(item.points * item.count) }}
                      </p>
                    </div>
                  </div>
                  <!-- Episode total, summing the events above it -->
                  <div class="flex items-center justify-between border-t border-stone-600 py-2">
                    <p class="text-sm font-medium text-stone-200">Total</p>
                    <p
                      class="text-sm font-semibold tabular-nums"
                      :class="group.subtotal >= 0 ? 'text-emerald-400' : 'text-red-400'"
                    >
                      {{ fmtPts(group.subtotal) }}
                    </p>
                  </div>
                </div>
              </div>
            </template>

            <!-- ── Votes tab ── -->
            <template v-else-if="activeTab === 'votes'">
              <div v-if="votesLoading" class="py-8 text-center text-sm text-stone-500">
                Loading votes…
              </div>
              <div v-else-if="votes.length === 0" class="py-8 text-center text-sm text-stone-500">
                No votes recorded yet.
              </div>
              <div v-else class="space-y-3">
                <div
                  v-for="group in votes"
                  :key="group.episodeNumber"
                  class="rounded-xl bg-stone-800 px-4 py-3"
                >
                  <!-- Episode label above the vote parchment(s), stacked -->
                  <div class="flex flex-col gap-2">
                    <p class="text-xs font-semibold uppercase tracking-wide text-text-default">
                      Episode {{ group.episodeNumber }}
                    </p>
                    <div v-if="group.votedFor.length" class="flex flex-wrap justify-start gap-2">
                      <div v-for="(v, i) in group.votedFor" :key="i" class="relative w-28">
                        <img
                          :src="parchmentUrl"
                          alt=""
                          aria-hidden="true"
                          class="w-full select-none"
                          :class="v.nullified ? 'opacity-75' : ''"
                        />
                        <span
                          class="absolute inset-0 flex items-center justify-center px-4 text-center font-handwritten text-base leading-tight text-material-parchment-ink"
                          :class="v.nullified ? 'line-through' : ''"
                          >{{ v.name }}</span
                        >
                        <!-- Outcome: did the person they voted for go home this episode? -->
                        <i
                          class="absolute -right-1 -top-1 rounded-full bg-stone-900 text-base"
                          :class="
                            v.success
                              ? 'fa-solid fa-circle-check text-emerald-400'
                              : 'fa-solid fa-circle-xmark text-red-400'
                          "
                          :title="v.success ? 'Voted out this episode' : 'Survived the vote'"
                        ></i>
                      </div>
                    </div>
                  </div>

                  <!-- Voted by: only when someone voted for this contestant -->
                  <div v-if="group.votedBy.length" class="mt-2">
                    <p class="mb-1 text-xs text-text-subtle">Voted by</p>
                    <p class="text-sm text-stone-200">
                      <span v-for="(v, i) in group.votedBy" :key="i">
                        <span :class="v.nullified ? 'text-stone-500 line-through' : ''">{{
                          v.name
                        }}</span
                        ><span v-if="i < group.votedBy.length - 1">, </span>
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
