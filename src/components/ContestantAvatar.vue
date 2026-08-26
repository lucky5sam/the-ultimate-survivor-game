<script setup lang="ts">
// Circular contestant photo with a person-icon fallback. Used in roster rows,
// the bounty display, and anywhere a name needs a face beside it.
withDefaults(
  defineProps<{
    photoUrl?: string | null
    name?: string
    size?: number // pixels
  }>(),
  { size: 36 },
)
</script>

<template>
  <div
    class="shrink-0 overflow-hidden rounded-full bg-surface-strong"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <img
      v-if="photoUrl"
      :src="photoUrl"
      :alt="name"
      class="h-full w-full object-cover object-top"
    />
    <div v-else class="flex h-full w-full items-center justify-center">
      <svg
        class="text-icon-subtle"
        :style="{ width: `${size * 0.55}px`, height: `${size * 0.55}px` }"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
        />
      </svg>
    </div>
  </div>
</template>
