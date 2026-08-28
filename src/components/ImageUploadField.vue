<script setup lang="ts">
// Reusable image picker used by the team wizard, Profile page, and the My Team
// edit modal. It is presentational only: it emits the chosen File and shows an
// instant local preview, but the PARENT decides when to upload (via
// uploadImage) — so it works both deferred (wizard, where the team id doesn't
// exist yet) and immediate-on-save (Profile, My Team).
import { ref, computed, watch, onUnmounted } from 'vue'
import BaseButton from './base/BaseButton.vue'
import ImageCropModal from './ImageCropModal.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string | null // currently-persisted image URL
    label?: string
    shape?: 'circle' | 'square'
    size?: number // preview size in px
  }>(),
  { shape: 'circle', size: 96 },
)

const emit = defineEmits<{ select: [file: File]; remove: [] }>()

const inputEl = ref<HTMLInputElement | null>(null)
// Local object URL for the freshly-cropped (not-yet-uploaded) file, if any.
const localPreview = ref<string | null>(null)
// The raw file awaiting crop; drives the crop modal.
const pendingFile = ref<File | null>(null)

// Show the local pick first, then the persisted URL, then the placeholder.
const previewUrl = computed(() => localPreview.value ?? props.modelValue)
const hasImage = computed(() => !!previewUrl.value)

function revokeLocal() {
  if (localPreview.value) {
    URL.revokeObjectURL(localPreview.value)
    localPreview.value = null
  }
}

function pick() {
  inputEl.value?.click()
}

function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  // Reset the input so re-picking the same file still fires change.
  ;(e.target as HTMLInputElement).value = ''
  if (!file) return
  // Route through the crop modal; the cropped result is what we preview/emit.
  pendingFile.value = file
}

function onCropped(file: File) {
  pendingFile.value = null
  revokeLocal()
  localPreview.value = URL.createObjectURL(file)
  emit('select', file)
}

function remove() {
  revokeLocal()
  emit('remove')
}

// If the parent clears/replaces the persisted URL (e.g. after a successful
// save), drop our stale local preview so we show the canonical value.
watch(
  () => props.modelValue,
  () => revokeLocal(),
)

onUnmounted(revokeLocal)
</script>

<template>
  <div>
    <p v-if="label" class="mb-1.5 text-sm font-medium text-text-default">{{ label }}</p>
    <div class="flex items-center gap-4">
      <!-- Preview / placeholder -->
      <div
        class="shrink-0 overflow-hidden border border-border-default bg-surface-subtle"
        :class="shape === 'circle' ? 'rounded-full' : 'rounded-2xl'"
        :style="{ width: `${size}px`, height: `${size}px` }"
      >
        <img
          v-if="hasImage"
          :src="previewUrl!"
          alt=""
          class="h-full w-full object-cover object-top"
        />
        <div v-else class="flex h-full w-full items-center justify-center">
          <svg
            class="text-icon-subtle"
            :style="{ width: `${size * 0.5}px`, height: `${size * 0.5}px` }"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
            />
          </svg>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex flex-col items-start gap-2">
        <BaseButton variant="secondary" size="sm" @click="pick">
          {{ hasImage ? 'Change' : 'Choose image' }}
        </BaseButton>
        <button
          v-if="hasImage"
          type="button"
          @click="remove"
          class="text-xs font-medium text-status-error hover:opacity-80"
        >
          Remove
        </button>
      </div>

      <input ref="inputEl" type="file" accept="image/*" class="hidden" @change="onFile" />
    </div>

    <ImageCropModal
      :show="!!pendingFile"
      :file="pendingFile"
      :shape="shape"
      @crop="onCropped"
      @cancel="pendingFile = null"
    />
  </div>
</template>
