import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import LoginView from '../views/LoginView.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', component: LoginView },
    { path: '/', redirect: '/my-team' },
    { path: '/my-team', component: () => import('../views/TeamView.vue'), meta: { requiresAuth: true } },
    { path: '/leaderboard', component: () => import('../views/LeaderboardView.vue'), meta: { requiresAuth: true } },
    {
      path: '/admin',
      component: () => import('../views/admin/AdminLayout.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
      children: [
        { path: '', redirect: '/admin/seasons' },
        { path: 'seasons', component: () => import('../views/admin/SeasonsView.vue') },
        { path: 'contestants', component: () => import('../views/admin/ContestantsView.vue') },
        { path: 'episodes', component: () => import('../views/admin/EpisodesView.vue') },
        { path: 'episodes/:episodeId/actions', component: () => import('../views/admin/ActionEntryView.vue') },
      ],
    },
  ],
})

function waitForReady(auth: ReturnType<typeof useAuthStore>) {
  if (auth.ready) return Promise.resolve()
  return new Promise<void>(resolve => {
    const stop = watch(() => auth.ready, (val) => { if (val) { stop(); resolve() } })
  })
}

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await waitForReady(auth)
  if (to.meta.requiresAuth && !auth.isLoggedIn()) return { path: '/login' }
  if (to.meta.requiresAdmin && !auth.isAdmin) return { path: '/' }
})

export default router
