import { ref } from 'vue'
import { defineStore } from 'pinia'

// Cross-view UI flags. `wizardActive` lets the global chrome (e.g. the invite
// banner in AppLayout) react to the full-page team-creation wizard, which is a
// conditional inside TeamView rather than its own route.
export const useUiStore = defineStore('ui', () => {
  const wizardActive = ref(false)
  // Whether the signed-in user has a team for the currently-selected season.
  // null = not yet determined (avoids hiding chrome / redirecting during load).
  const hasTeam = ref<boolean | null>(null)
  return { wizardActive, hasTeam }
})
