<script setup lang="ts">
// Read-only league rules in a modal, launched from the team page for quick
// clarification. Wraps the shared LeagueRules body; the nested scoring modal is
// bumped above this one (z-60) so it stacks correctly when opened from here.
import BaseModal from './base/BaseModal.vue'
import BaseButton from './base/BaseButton.vue'
import LeagueRules from './LeagueRules.vue'

defineProps<{ show: boolean; seasonId: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <BaseModal :show="show" title="League Rules" size="lg" @close="emit('close')">
    <div class="max-h-[70vh] overflow-y-auto pr-1">
      <LeagueRules :season-id="seasonId" :scoring-z-index="60" />
    </div>
    <template #footer>
      <BaseButton variant="secondary" @click="emit('close')">Close</BaseButton>
    </template>
  </BaseModal>
</template>
