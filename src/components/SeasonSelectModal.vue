<script setup lang="ts">
// Wraps the league season picker in a modal, launched from the profile menu's
// "View Previous Seasons" action. Closes as soon as a season is chosen.
import BaseModal from './base/BaseModal.vue'
import SeasonSelect from './SeasonSelect.vue'

defineProps<{ show: boolean }>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <BaseModal :show="show" title="View Previous Seasons" size="sm" @close="emit('close')">
    <p class="mb-3 text-sm text-text-muted">
      Pick a season to view its leaderboard, teams, and history.
    </p>
    <SeasonSelect @change="emit('close')" />
  </BaseModal>
</template>
