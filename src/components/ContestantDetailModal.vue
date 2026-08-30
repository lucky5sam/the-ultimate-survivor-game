<script setup lang="ts">
import { getTribeColors } from '../utils/tribeColors'
import { displayName } from '../utils/contestantName'
import { computed, ref, watch, onUnmounted } from 'vue'
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
  }>(),
  { showEventLog: false, events: () => [], eventsLoading: false },
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

const activeTab = ref<'info' | 'events'>('info')
// Always land on Info when the modal opens or the contestant changes.
watch(
  () => [props.show, props.contestant?.id],
  () => {
    activeTab.value = 'info'
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
            <div v-if="showEventLog" class="mt-3 flex gap-6 px-5">
              <button
                v-for="tab in [
                  { id: 'info', label: 'Info' },
                  { id: 'events', label: 'Event Log' },
                ]"
                :key="tab.id"
                class="-mb-px border-b-2 pb-2 text-sm font-semibold transition-colors"
                :class="
                  activeTab === tab.id
                    ? 'border-white text-white'
                    : 'border-transparent text-stone-500 hover:text-stone-300'
                "
                @click="activeTab = tab.id as 'info' | 'events'"
              >
                {{ tab.label }}
              </button>
            </div>
            <div v-else class="h-4"></div>
          </div>

          <!-- Content -->
          <div class="p-5">
            <!-- ── Info tab ── -->
            <template v-if="!showEventLog || activeTab === 'info'">
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
            <template v-else>
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
