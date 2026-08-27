import { ref } from 'vue'
import { defineStore } from 'pinia'

// Cross-view UI flags. `wizardActive` lets the global chrome (e.g. the invite
// banner in AppLayout) react to the full-page team-creation wizard, which is a
// conditional inside TeamView rather than its own route.
export const useUiStore = defineStore('ui', () => {
  const wizardActive = ref(false)
  return { wizardActive }
})
