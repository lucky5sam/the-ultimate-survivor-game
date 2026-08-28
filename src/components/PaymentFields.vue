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

// Venmo usernames are alphanumeric plus underscore/hyphen — strip anything else
// (including a leading "@", which the field shows as a fixed prefix instead).
function sanitizeVenmo(v: string): string {
  return v.replace(/[^A-Za-z0-9_-]/g, '')
}

// The "@" is a visual prefix, so the input shows the bare username. Cleans any
// legacy "@"/special chars out of previously saved handles on display too.
const venmoValue = computed(() => sanitizeVenmo(props.handle))

function onVenmoInput(e: Event) {
  const el = e.target as HTMLInputElement
  const clean = sanitizeVenmo(el.value)
  // Reject the keystroke in the DOM too: if the emit doesn't change the bound
  // value, Vue won't re-render and the disallowed char would linger.
  if (el.value !== clean) el.value = clean
  emit('update:handle', clean)
}
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

    <div v-if="method === 'venmo'">
      <label class="mb-1 block text-sm font-medium text-text-default">Venmo username</label>
      <div
        class="flex w-full items-center rounded-md border border-interactive-input-border bg-interactive-input transition-colors focus-within:border-interactive-input-border-focus focus-within:ring-2 focus-within:ring-border-accent"
      >
        <span class="select-none pl-3 pr-0.5 text-sm text-text-subtle">@</span>
        <input
          :value="venmoValue"
          @input="onVenmoInput"
          placeholder="username"
          inputmode="text"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          maxlength="30"
          class="w-full rounded-md bg-transparent py-2 pl-0 pr-3 text-sm text-text-default placeholder:text-text-muted focus:outline-none"
        />
      </div>
    </div>

    <BaseInput
      v-else-if="method === 'zelle'"
      :model-value="handle"
      @update:model-value="emit('update:handle', $event)"
      label="Zelle email or phone"
      placeholder="email or phone"
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
