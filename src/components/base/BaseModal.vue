<script setup lang="ts">
// Reusable modal: teleported to body, backdrop-click + Escape to close, fade
// transition. Provide body content in the default slot and actions in #footer.
import { watch, onUnmounted } from 'vue'

const props = withDefaults(
  defineProps<{
    show: boolean
    title?: string
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { size: 'sm' },
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

watch(
  () => props.show,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
)

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
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
            'w-full rounded-xl border border-border-subtle bg-surface-overlay p-6 shadow-xl',
            maxWidths[size],
          ]"
          role="dialog"
          aria-modal="true"
        >
          <h2 v-if="title" class="mb-3 text-lg font-bold text-text-default">{{ title }}</h2>
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
