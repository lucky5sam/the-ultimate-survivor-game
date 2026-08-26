<script setup lang="ts">
// Shared payment-preference inputs (method + conditional handle/note), used by
// the account Profile page and the email signup form. Three v-models:
// v-model:method, v-model:handle, v-model:note.
import { computed } from 'vue'
import BaseInput from './base/BaseInput.vue'

const props = defineProps<{ method: string; handle: string; note: string }>()
const emit = defineEmits<{
  'update:method': [v: string]
  'update:handle': [v: string]
  'update:note': [v: string]
}>()

const handleLabel = computed(() =>
  props.method === 'venmo' ? 'Venmo username' : 'Zelle email or phone',
)
const handlePlaceholder = computed(() =>
  props.method === 'venmo' ? '@username' : 'email or phone',
)
</script>

<template>
  <div class="space-y-4">
    <div>
      <label class="mb-1 block text-sm font-medium text-text-default"
        >Preferred payment method</label
      >
      <select
        :value="method"
        @change="emit('update:method', ($event.target as HTMLSelectElement).value)"
        class="w-full rounded-md border border-interactive-input-border bg-interactive-input px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-border-accent"
      >
        <option value="">Select…</option>
        <option value="venmo">Venmo</option>
        <option value="zelle">Zelle</option>
        <option value="other">Other</option>
      </select>
    </div>

    <BaseInput
      v-if="method === 'venmo' || method === 'zelle'"
      :model-value="handle"
      @update:model-value="emit('update:handle', $event)"
      :label="handleLabel"
      :placeholder="handlePlaceholder"
    />

    <div v-else-if="method === 'other'">
      <label class="mb-1 block text-sm font-medium text-text-default"
        >Expected payment method</label
      >
      <textarea
        :value="note"
        @input="emit('update:note', ($event.target as HTMLTextAreaElement).value)"
        rows="2"
        placeholder="e.g. PayPal to name@example.com, or cash in person"
        class="w-full resize-none rounded-md border border-interactive-input-border bg-interactive-input px-3 py-2 text-sm text-text-default placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-accent"
      />
    </div>
  </div>
</template>
