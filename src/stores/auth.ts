import { ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const isAdmin = ref(false)
  const firstName = ref('')
  const lastName = ref('')
  const ready = ref(false)

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('is_admin, first_name, last_name')
      .eq('id', userId)
      .single()
    isAdmin.value = data?.is_admin ?? false
    firstName.value = data?.first_name ?? ''
    lastName.value = data?.last_name ?? ''
    return data
  }

  // Populate the profile row from auth metadata on first authenticated load
  // (covers the email-confirmation signup flow where the profile wasn't written).
  async function backfillProfile(uid: string, metadata: Record<string, any> | undefined) {
    try {
      const profile = await fetchProfile(uid)
      if (profile?.first_name) return
      const meta = metadata
      const fn = meta?.first_name ?? meta?.given_name ?? meta?.full_name?.split(' ')[0] ?? ''
      const ln =
        meta?.last_name ?? meta?.family_name ?? meta?.full_name?.split(' ').slice(1).join(' ') ?? ''
      if (fn || ln) {
        await supabase
          .from('profiles')
          .upsert({ id: uid, first_name: fn, last_name: ln }, { onConflict: 'id' })
        firstName.value = fn
        lastName.value = ln
      }
    } catch {
      // Profile hydration is best-effort; never block navigation on it.
    }
  }

  async function init() {
    // Always flip `ready` — even if the session/profile lookup fails — so the
    // router's navigation guard can never hang on a blank screen.
    try {
      const { data } = await supabase.auth.getSession()
      user.value = data.session?.user ?? null
      if (user.value) await backfillProfile(user.value.id, user.value.user_metadata)
    } catch {
      // swallow — startup must not depend on a successful network call
    } finally {
      ready.value = true
    }

    supabase.auth.onAuthStateChange((event, session) => {
      // The initial session is already handled by init() above, and token
      // refreshes (auto-fired ~hourly and on tab refocus) don't change who's
      // logged in — reacting to them re-fetches the profile and briefly flips
      // isAdmin/name to stale values. Only react to real auth transitions.
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return

      user.value = session?.user ?? null
      if (!user.value) {
        isAdmin.value = false
        firstName.value = ''
        lastName.value = ''
        return
      }

      // Defer Supabase calls out of the callback: it runs while the auth lock
      // is held, and awaiting client calls inside it can intermittently stall.
      const uid = user.value.id
      const metadata = session?.user?.user_metadata
      setTimeout(() => {
        backfillProfile(uid, metadata)
      }, 0)
    })
  }

  function isLoggedIn() {
    return user.value !== null
  }

  return { user, isAdmin, firstName, lastName, ready, init, isLoggedIn }
})
