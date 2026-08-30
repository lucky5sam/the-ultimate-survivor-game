<script setup lang="ts">
// Circular contestant photo with a person-icon fallback. Used in roster rows,
// the bounty display, and anywhere a name needs a face beside it.
//
// Set `showTribe` to overlay the tribe letter-badge in the bottom-right corner
// (used by the roster, so the tribe no longer needs a separate badge by the
// name). The badge carries its own hover tooltip with the full tribe name.
import { computed } from 'vue'
import TribeBadge from './TribeBadge.vue'
import { getTribeColors } from '../utils/tribeColors'

const props = withDefaults(
  defineProps<{
    photoUrl?: string | null
    name?: string
    size?: number // pixels
    tribe?: string | null
    showTribe?: boolean
    showCrown?: boolean
    // Force a specific border color instead of the tribe color (e.g. bounty red).
    borderColorOverride?: string | null
    // Desaturate the photo (e.g. a voted-out player).
    grayscale?: boolean
  }>(),
  { size: 36, showTribe: false, showCrown: false, grayscale: false },
)

// A ring in the tribe color when a tribe is known — unless overridden.
const borderColor = computed(
  () => props.borderColorOverride ?? (props.tribe ? getTribeColors(props.tribe).primary : null),
)
</script>

<template>
  <div class="relative shrink-0" :style="{ width: `${size}px`, height: `${size}px` }">
    <div
      class="h-full w-full overflow-hidden rounded-full bg-surface-strong"
      :class="borderColor ? 'border-2' : ''"
      :style="borderColor ? { borderColor } : undefined"
    >
      <img
        v-if="photoUrl"
        :src="photoUrl"
        :alt="name"
        class="h-full w-full object-cover object-top"
        :class="{ grayscale }"
      />
      <div v-else class="flex h-full w-full items-center justify-center" :class="{ grayscale }">
        <i
          class="fa-solid fa-user text-icon-subtle"
          :style="{ fontSize: `${size * 0.55}px` }"
        ></i>
      </div>
    </div>

    <!-- Point-in-time tribe badge, anchored to the avatar's bottom-right. The
         ring separates it from the photo behind it. TribeBadge has multiple root
         nodes (badge + teleported tooltip) so its own class won't fall through —
         position and ring go on this wrapper instead. -->
    <span
      v-if="showTribe && tribe"
      class="absolute -bottom-1 -right-1 inline-flex rounded-sm ring-2 ring-surface-default"
    >
      <TribeBadge :tribe="tribe" :size="16" />
    </span>

    <!-- Crown badge for the MVP, anchored bottom-right (same spot as the tribe badge). -->
    <span
      v-if="showCrown"
      class="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-survivor-sand ring-2 ring-surface-default"
    >
      <i class="fa-solid fa-crown text-[9px] text-white"></i>
    </span>
  </div>
</template>
