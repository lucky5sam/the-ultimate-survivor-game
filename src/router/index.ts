import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import LoginView from '../views/LoginView.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', component: LoginView },
    { path: '/reset-password', component: () => import('../views/ResetPasswordView.vue') },
    {
      path: '/',
      component: () => import('../views/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/my-team' },
        { path: 'dashboard', component: () => import('../views/DashboardView.vue') },
        { path: 'leaderboard', component: () => import('../views/LeaderboardView.vue') },
        { path: 'event-log', component: () => import('../views/EventLogView.vue') },
        { path: 'my-team', component: () => import('../views/TeamView.vue') },
        {
          path: 'team/:teamId',
          component: () => import('../views/PublicTeamView.vue'),
          // Public team view has its own Back button; hide the mobile tab
          // selector so Back is the only navigation on small screens.
          meta: { hideMobileTabs: true },
        },
        {
          path: 'profile',
          component: () => import('../views/ProfileView.vue'),
          // Profile has its own "My Team" back bar; drop the redundant mobile
          // tab selector, matching the public team view.
          meta: { hideMobileTabs: true },
        },
        {
          // Admin-only read-only preview of the player team-creation wizard.
          path: 'preview-wizard',
          component: () => import('../views/WizardPreviewView.vue'),
          meta: { requiresAdmin: true, hideMobileTabs: true },
        },
      ],
    },
    {
      path: '/admin',
      component: () => import('../views/admin/AdminLayout.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
      children: [
        { path: '', redirect: '/admin/seasons' },
        { path: 'seasons', component: () => import('../views/admin/SeasonsView.vue') },
        { path: 'contestants', component: () => import('../views/admin/ContestantsView.vue') },
        { path: 'episodes', component: () => import('../views/admin/EpisodesView.vue') },
        {
          path: 'episodes/:episodeId/actions',
          component: () => import('../views/admin/ActionEntryView.vue'),
        },
        { path: 'action-types', component: () => import('../views/admin/ActionTypesView.vue') },
        { path: 'settings', component: () => import('../views/admin/SettingsView.vue') },
        { path: 'export', component: () => import('../views/admin/ExportView.vue') },
      ],
    },
  ],
})

function waitForReady(auth: ReturnType<typeof useAuthStore>) {
  if (auth.ready) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      stop()
      clearTimeout(timer)
      resolve()
    }
    const stop = watch(
      () => auth.ready,
      (val) => {
        if (val) finish()
      },
    )
    // Failsafe: never block navigation forever if `ready` somehow never flips.
    const timer = setTimeout(finish, 5000)
  })
}

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await waitForReady(auth)
  if (to.meta.requiresAuth && !auth.isLoggedIn()) return { path: '/login' }
  if (to.meta.requiresAdmin && !auth.isAdmin) return { path: '/' }
})

export default router
