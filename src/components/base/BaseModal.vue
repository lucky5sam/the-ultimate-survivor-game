<script lang="ts">
// Shared across every modal instance so that stacked modals keep the page
// body scroll-locked until the last one closes.
let scrollLockCount = 0
</script>

<script setup lang="ts">
// Reusable modal: teleported to body, backdrop-click + Escape to close, fade
// transition, page-scroll locked while open. Provide body content in the
// default slot and actions in #footer. A close X shows top-right unless
// `hideClose` is set.
import { watch, onUnmounted } from 'vue'

const props = withDefaults(
  defineProps<{
    show: boolean
    title?: string
    size?: 'sm' | 'md' | 'lg'
    hideClose?: boolean
  }>(),
  { size: 'sm', hideClose: false },
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
        @click.self="emit('close')"
      >
        <div
          :class="[
            'relative w-full rounded-xl border border-border-subtle bg-surface-overlay p-6 shadow-xl',
            maxWidths[size],
          ]"
          role="dialog"
          aria-modal="true"
        >
          <button
            v-if="!hideClose"
            type="button"
            aria-label="Close"
            class="absolute right-4 top-4 rounded-md p-1 text-icon-subtle transition-colors hover:bg-surface-subtle hover:text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent"
            @click="emit('close')"
          >
            <svg
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <h2 v-if="title" class="mb-3 pr-8 text-lg font-bold text-text-default">{{ title }}</h2>
          <slot />
          <div v-if="$slots.footer" class="mt-5 flex justify-end gap-3">
            <slot name="footer" />
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
