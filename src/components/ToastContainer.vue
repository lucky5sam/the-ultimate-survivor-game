<script setup lang="ts">
import { useToast } from '../composables/useToast'

const { toasts } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-[9999] pointer-events-none">
      <TransitionGroup
        enter-active-class="transition-all duration-300 ease-out"
        enter-from-class="opacity-0 translate-y-4 scale-95"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        leave-active-class="transition-all duration-200 ease-in"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 translate-y-2 scale-95"
      >
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="[
            'px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 pointer-events-auto',
            toast.type === 'success' ? 'bg-gray-900 text-white' :
            toast.type === 'error'   ? 'bg-red-600 text-white' :
                                       'bg-blue-600 text-white',
          ]"
        >
          <span v-if="toast.type === 'success'">✓</span>
          <span v-else-if="toast.type === 'error'">✕</span>
          <span v-else>ℹ</span>
          {{ toast.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
