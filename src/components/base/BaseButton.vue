<script setup lang="ts">
// Reusable button. All color/shape comes from tokens in style.css —
// never hardcode a color here. Change the tokens and every button updates.

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    block?: boolean // full-width
    loading?: boolean // shows spinner + disables
    disabled?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'primary', size: 'md', block: false, loading: false, disabled: false, type: 'button' },
)

// Survivor-forward: fire-orange primary drives the eye; everything else recedes.
const variants: Record<string, string> = {
  primary:
    'bg-gradient-to-b from-interactive-accent-from to-interactive-accent-to text-text-on-accent hover:brightness-95 active:brightness-90 disabled:from-interactive-accent-disabled disabled:to-interactive-accent-disabled disabled:brightness-100',
  secondary:
    'bg-interactive-neutral text-text-default border border-border-default hover:bg-interactive-neutral-hover',
  outline:
    'bg-transparent text-text-default border border-border-default hover:bg-surface-subtle',
  ghost: 'bg-transparent text-text-accent hover:bg-surface-accent',
  danger: 'bg-status-error text-text-on-accent hover:opacity-90',
}

const sizes: Record<string, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :class="[
      'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-accent focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed',
      variants[variant],
      sizes[size],
      block && 'w-full',
    ]"
  >
    <i v-if="loading" class="fa-solid fa-circle-notch animate-spin text-sm"></i>
    <slot />
  </button>
</template>
