<script setup lang="ts">
// A team's identity avatar, rendered consistently everywhere a team appears.
// Precedence: uploaded image → emoji-on-color tile → empty placeholder.
// Always square (per the team-image convention); the caller supplies the corner
// radius / border via the `class` attribute, which falls through to the root.
const props = withDefaults(
  defineProps<{
    imageUrl?: string | null
    emoji?: string | null
    color?: string | null
    name?: string
    size?: number // px
  }>(),
  { size: 40 },
)
</script>

<template>
  <div
    class="shrink-0 overflow-hidden bg-surface-subtle"
    :style="{ width: `${props.size}px`, height: `${props.size}px` }"
  >
    <img
      v-if="imageUrl"
      :src="imageUrl"
      :alt="name || 'Team'"
      class="h-full w-full object-cover object-top"
    />
    <div
      v-else-if="emoji"
      class="flex h-full w-full items-center justify-center leading-none"
      :style="{ backgroundColor: color || 'var(--color-surface-strong)', fontSize: `${Math.round(props.size * 0.55)}px` }"
    >
      <span>{{ emoji }}</span>
    </div>
    <!-- else: bare placeholder square (bg-surface-subtle) -->
  </div>
</template>
