<script setup lang="ts">
// Simple square image cropper. Given a picked File, it shows the image on a
// square stage the user can drag to reposition and a zoom slider to scale.
// Confirm renders the framed square to an output canvas and emits it as a webp
// File — which the caller then uploads. No external dependencies.
import { ref, watch, nextTick } from 'vue'
import BaseModal from './base/BaseModal.vue'
import BaseButton from './base/BaseButton.vue'

const props = withDefaults(
  defineProps<{ show: boolean; file: File | null; shape?: 'circle' | 'square' }>(),
  { shape: 'circle' },
)
const emit = defineEmits<{ crop: [file: File]; cancel: [] }>()

const STAGE = 288 // on-screen crop square, in CSS px
const OUTPUT = 512 // exported square, in px (matches uploadImage's max)
const MAX_ZOOM = 3

const canvasEl = ref<HTMLCanvasElement | null>(null)
const img = ref<HTMLImageElement | null>(null)
const zoom = ref(1) // slider value, 1 = image just covers the stage
const busy = ref(false)

// Derived transform state (image drawn at scale, positioned at offsetX/Y).
let minScale = 1
let scale = 1
let offsetX = 0
let offsetY = 0

// Keep the image covering the stage so there's never an empty gap.
function clampOffsets() {
  const iw = (img.value?.width ?? 0) * scale
  const ih = (img.value?.height ?? 0) * scale
  offsetX = Math.min(0, Math.max(STAGE - iw, offsetX))
  offsetY = Math.min(0, Math.max(STAGE - ih, offsetY))
}

function draw() {
  const canvas = canvasEl.value
  const image = img.value
  if (!canvas || !image) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = STAGE * dpr
  canvas.height = STAGE * dpr
  canvas.style.width = `${STAGE}px`
  canvas.style.height = `${STAGE}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, STAGE, STAGE)
  ctx.drawImage(image, offsetX, offsetY, image.width * scale, image.height * scale)
}

function loadFile(file: File) {
  const reader = new FileReader()
  reader.onload = () => {
    const image = new Image()
    image.onload = () => {
      img.value = image
      minScale = Math.max(STAGE / image.width, STAGE / image.height)
      zoom.value = 1
      scale = minScale
      offsetX = (STAGE - image.width * scale) / 2
      offsetY = (STAGE - image.height * scale) / 2
      nextTick(draw)
    }
    image.src = reader.result as string
  }
  reader.readAsDataURL(file)
}

watch(
  () => [props.show, props.file] as const,
  ([show, file]) => {
    if (show && file) loadFile(file)
  },
  { immediate: true },
)

// Zoom around the stage centre so the framed subject stays put.
function onZoom() {
  const image = img.value
  if (!image) return
  const newScale = minScale * zoom.value
  const cx = (STAGE / 2 - offsetX) / scale
  const cy = (STAGE / 2 - offsetY) / scale
  scale = newScale
  offsetX = STAGE / 2 - cx * newScale
  offsetY = STAGE / 2 - cy * newScale
  clampOffsets()
  draw()
}

// Drag-to-pan via pointer events (mouse + touch).
let dragging = false
let lastX = 0
let lastY = 0
function onPointerDown(e: PointerEvent) {
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  offsetX += e.clientX - lastX
  offsetY += e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  clampOffsets()
  draw()
}
function onPointerUp() {
  dragging = false
}

async function confirm() {
  const image = img.value
  if (!image) return
  busy.value = true
  try {
    const ratio = OUTPUT / STAGE
    const out = document.createElement('canvas')
    out.width = OUTPUT
    out.height = OUTPUT
    const ctx = out.getContext('2d')
    if (!ctx) throw new Error('Could not process the image.')
    ctx.drawImage(
      image,
      offsetX * ratio,
      offsetY * ratio,
      image.width * scale * ratio,
      image.height * scale * ratio,
    )
    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, 'image/webp', 0.9),
    )
    if (!blob) throw new Error('Could not process the image.')
    emit('crop', new File([blob], 'crop.webp', { type: 'image/webp' }))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal :show="show" title="Crop your photo" size="sm" @close="emit('cancel')">
    <p class="mb-3 text-sm text-text-muted">Drag to reposition, and use the slider to zoom.</p>

    <div class="flex flex-col items-center">
      <!-- Crop stage: the canvas is the exact square that gets exported; the
           overlay ring shows how it appears when displayed as a circle. -->
      <div
        class="relative touch-none overflow-hidden bg-surface-strong"
        :class="shape === 'circle' ? 'rounded-lg' : 'rounded-2xl'"
        :style="{ width: '288px', height: '288px' }"
      >
        <canvas
          ref="canvasEl"
          class="block cursor-move"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        />
        <!-- Framing guide: a circle mask for avatars, a rounded-square ring for
             square images (whose corners are only lightly rounded on display). -->
        <div
          v-if="shape === 'circle'"
          class="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/70"
          style="box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45)"
        ></div>
        <div
          v-else
          class="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-white/70"
        ></div>
      </div>

      <label class="mt-4 flex w-full items-center gap-3">
        <span class="text-xs font-medium text-text-muted">Zoom</span>
        <input
          v-model.number="zoom"
          type="range"
          :min="1"
          :max="MAX_ZOOM"
          step="0.01"
          class="flex-1 accent-interactive-accent"
          @input="onZoom"
        />
      </label>
    </div>

    <template #footer>
      <BaseButton variant="secondary" @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton :loading="busy" @click="confirm">Use photo</BaseButton>
    </template>
  </BaseModal>
</template>
