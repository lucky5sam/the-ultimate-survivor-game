import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const isAdmin = ref(false)
  const firstName = ref('')
  const lastName = ref('')
  // Account-level payment preference (for prize payouts).
  const paymentMethod = ref('') // '' | 'venmo' | 'zelle' | 'other'
  const paymentHandle = ref('') // username/identifier for venmo/zelle
  const paymentNote = ref('') // free text when method is 'other'
  const ready = ref(false)

  // A profile is "complete" once payment info is usable: a method is chosen and
  // the matching detail (handle for venmo/zelle, note for other) is filled.
  const isProfileComplete = computed(() => {
    if (!paymentMethod.value) return false
    if (paymentMethod.value === 'other') return paymentNote.value.trim().length > 0
    return paymentHandle.value.trim().length > 0
  })

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('is_admin, first_name, last_name, payment_method, payment_handle, payment_note')
      .eq('id', userId)
      .single()
    isAdmin.value = data?.is_admin ?? false
    firstName.value = data?.first_name ?? ''
    lastName.value = data?.last_name ?? ''
    paymentMethod.value = data?.payment_method ?? ''
    paymentHandle.value = data?.payment_handle ?? ''
    paymentNote.value = data?.payment_note ?? ''
    return data
  }

  // Populate the profile row from auth metadata on first authenticated load
  // (covers the email-confirmation signup flow where the profile wasn't written).
  async function backfillProfile(uid: string, metadata: Record<string, any> | undefined) {
    try {
      const profile = await fetchProfile(uid)
      const updates: Record<string, any> = {}

      if (!profile?.first_name) {
        const fn =
          metadata?.first_name ?? metadata?.given_name ?? metadata?.full_name?.split(' ')[0] ?? ''
        const ln =
          metadata?.last_name ??
          metadata?.family_name ??
          metadata?.full_name?.split(' ').slice(1).join(' ') ??
          ''
        if (fn) updates.first_name = fn
        if (ln) updates.last_name = ln
      }

      // Email signup stashes payment info in metadata; write it through on first load.
      if (!profile?.payment_method && metadata?.payment_method) {
        updates.payment_method = metadata.payment_method
        updates.payment_handle = metadata.payment_handle ?? null
        updates.payment_note = metadata.payment_note ?? null
      }

      if (Object.keys(updates).length > 0) {
        // The row is created by a signup trigger (NOT NULL display_name), so
        // only UPDATE our own fields here — never insert.
        await supabase.from('profiles').update(updates).eq('id', uid)
        await fetchProfile(uid) // refresh local state from the persisted row
      }
    } catch {
      // Profile hydration is best-effort; never block navigation on it.
    }
  }

  function clearProfile() {
    isAdmin.value = false
    firstName.value = ''
    lastName.value = ''
    paymentMethod.value = ''
    paymentHandle.value = ''
    paymentNote.value = ''
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
        clearProfile()
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

  return {
    user,
    isAdmin,
    firstName,
    lastName,
    paymentMethod,
    paymentHandle,
    paymentNote,
    isProfileComplete,
    ready,
    init,
    isLoggedIn,
  }
})
