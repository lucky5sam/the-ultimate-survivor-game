<script lang="ts">
// Shared across every modal instance so that stacked modals keep the page
// body scroll-locked until the last one closes.
let scrollLockCount = 0
</script>

<script setup lang="ts">
// Reusable modal: teleported to body, backdrop-click + Escape to close, fade
// transition, page-scroll locked while open. Provide body content in the
// default slot and actions in #footer. An optional `subtitle` renders muted
// text under the `title`. A close X shows top-right unless `hideClose` is set.
// Set `fireGlow` for an ambient Survivor glow flush to the modal's bottom edge.
import { watch, onUnmounted } from 'vue'
import FireGlow from '../FireGlow.vue'

const props = withDefaults(
  defineProps<{
    show: boolean
    title?: string
    subtitle?: string
    size?: 'sm' | 'md' | 'lg'
    hideClose?: boolean
    // Override the base z-index (50) to stack one modal above another that's
    // open at the same time (e.g. a confirmation over its select modal).
    zIndex?: number
    // Ambient fire glow anchored flush to the bottom edge of the modal.
    fireGlow?: boolean
  }>(),
  { size: 'sm', hideClose: false, fireGlow: false },
)

const emit = defineEmits<{ close: [] }>()

const maxWidths: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

// Per-instance guard so a single modal only ever holds one lock.
let locked = false
function lockScroll() {
  if (locked) return
  locked = true
  if (scrollLockCount === 0) document.body.style.overflow = 'hidden'
  scrollLockCount++
}
function unlockScroll() {
  if (!locked) return
  locked = false
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) document.body.style.overflow = ''
}

watch(
  () => props.show,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKeydown)
      lockScroll()
    } else {
      window.removeEventListener('keydown', onKeydown)
      unlockScroll()
    }
  },
)

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  unlockScroll()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="show"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        :style="zIndex != null ? { zIndex } : undefined"
        @click.self="emit('close')"
      >
        <div
          :class="[
            'relative w-full rounded-xl border border-border-subtle bg-surface-overlay shadow-xl',
            maxWidths[size],
            fireGlow ? 'overflow-hidden' : '',
          ]"
          role="dialog"
          aria-modal="true"
        >
          <!-- Ambient glow flush to the bottom edge, behind the content (z-10). -->
          <FireGlow v-if="fireGlow" position="absolute" :z-index="0" :height="90" :ember-count="8" />
          <div class="relative z-10 p-6">
            <button
              v-if="!hideClose"
              type="button"
              aria-label="Close"
              class="absolute right-4 top-4 rounded-md p-1 text-icon-subtle transition-colors hover:bg-surface-subtle hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
              @click="emit('close')"
            >
              <i class="fa-solid fa-xmark text-xl"></i>
            </button>
            <div v-if="title || subtitle" class="mb-3 pr-8">
              <h2 v-if="title" class="text-lg font-bold text-text-default">{{ title }}</h2>
              <p v-if="subtitle" class="text-sm text-text-subtle">{{ subtitle }}</p>
            </div>
            <slot />
            <div v-if="$slots.footer" class="mt-5 flex justify-end gap-2">
              <slot name="footer" />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
