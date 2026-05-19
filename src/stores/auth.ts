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

  async function init() {
    const { data } = await supabase.auth.getSession()
    user.value = data.session?.user ?? null
    if (user.value) await fetchProfile(user.value.id)
    ready.value = true

    supabase.auth.onAuthStateChange(async (event, session) => {
      ready.value = false
      user.value = session?.user ?? null
      if (user.value) {
        const profile = await fetchProfile(user.value.id)
        if (!profile?.first_name) {
          const meta = session?.user?.user_metadata
          const fn = meta?.given_name ?? meta?.full_name?.split(' ')[0] ?? ''
          const ln = meta?.family_name ?? meta?.full_name?.split(' ').slice(1).join(' ') ?? ''
          if (fn || ln) {
            await supabase.from('profiles').upsert(
              { id: user.value.id, first_name: fn, last_name: ln },
              { onConflict: 'id' }
            )
            firstName.value = fn
            lastName.value = ln
          }
        }
      } else {
        isAdmin.value = false
        firstName.value = ''
        lastName.value = ''
      }
      ready.value = true
    })
  }

  function isLoggedIn() {
    return user.value !== null
  }

  return { user, isAdmin, firstName, lastName, ready, init, isLoggedIn }
})
