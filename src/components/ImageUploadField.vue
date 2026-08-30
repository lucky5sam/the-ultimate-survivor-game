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
    // Reject source files larger than this (MB) before the crop step. Defaults
    // to 8 to match uploadImage's own upload-time cap.
    maxSizeMb?: number
  }>(),
  { shape: 'circle', size: 96, maxSizeMb: 8 },
)

const emit = defineEmits<{ select: [file: File]; remove: [] }>()

const inputEl = ref<HTMLInputElement | null>(null)
// Local object URL for the freshly-cropped (not-yet-uploaded) file, if any.
const localPreview = ref<string | null>(null)
// The raw file awaiting crop; drives the crop modal.
const pendingFile = ref<File | null>(null)
// Inline validation message for a rejected pick (too large / not an image).
const fileError = ref('')

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
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // Reset the input so re-picking the same file still fires change.
  input.value = ''
  if (!file) return
  fileError.value = ''
  if (!file.type.startsWith('image/')) {
    fileError.value = 'Please choose an image file.'
    return
  }
  if (file.size > props.maxSizeMb * 1024 * 1024) {
    fileError.value = `That image is too large (max ${props.maxSizeMb}MB).`
    return
  }
  // Route through the crop modal; the cropped result is what we preview/emit.
  pendingFile.value = file
}

function onCropped(file: File) {
  pendingFile.value = null
  fileError.value = ''
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
          <i
            class="fa-solid fa-user text-icon-subtle"
            :style="{ fontSize: `${size * 0.5}px` }"
          ></i>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex flex-col items-start gap-2">
        <BaseButton variant="secondary" size="sm" @click="pick">
          {{ hasImage ? 'Change' : 'Choose image' }}
        </BaseButton>
        <BaseButton
          v-if="hasImage"
          variant="secondary"
          size="sm"
          aria-label="Remove image"
          @click="remove"
          class="h-9"
        >
          <i class="fa-solid fa-trash-can text-status-error"></i><span class="text-status-error">Remove</span>
        </BaseButton>
      </div>

      <input ref="inputEl" type="file" accept="image/*" class="hidden" @change="onFile" />
    </div>

    <p v-if="fileError" class="mt-2 text-xs text-status-error">{{ fileError }}</p>

    <ImageCropModal
      :show="!!pendingFile"
      :file="pendingFile"
      :shape="shape"
      @crop="onCropped"
      @cancel="pendingFile = null"
    />
  </div>
</template>
