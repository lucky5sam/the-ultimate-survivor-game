<script setup lang="ts">
// Reusable labeled input with built-in error state. Two-way bind with v-model.
withDefaults(
  defineProps<{
    label?: string
    modelValue?: string
    type?: string
    error?: string
    placeholder?: string
    required?: boolean
    autocomplete?: string
    size?: 'sm' | 'md' | 'lg'
  }>(),
  { size: 'md' },
)

defineEmits<{ 'update:modelValue': [value: string] }>()

const sizes: Record<string, string> = {
  sm: 'px-2.5 py-1.5 text-sm',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-3 text-sm',
}
</script>

<template>
  <div>
    <label v-if="label" class="mb-1 block text-sm font-medium text-text-default">
      {{ label }}
    </label>
    <input
      :type="type ?? 'text'"
      :value="modelValue"
      :placeholder="placeholder"
      :required="required"
      :autocomplete="autocomplete"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      :class="[
        'w-full rounded-md transition-colors',
        sizes[size],
        'bg-interactive-input text-text-default placeholder:text-text-muted',
        'border focus:outline-none focus:ring-2',
        error
          ? 'border-status-error focus:ring-status-error'
          : 'border-interactive-input-border focus:border-interactive-input-border-focus focus:ring-border-accent',
      ]"
    />
    <p v-if="error" class="mt-1 text-sm text-status-error">{{ error }}</p>
  </div>
</template>
