import { ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const isAdmin = ref(false)
  const ready = ref(false)

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single()
    isAdmin.value = data?.is_admin ?? false
  }

  async function init() {
    const { data } = await supabase.auth.getSession()
    user.value = data.session?.user ?? null
    if (user.value) await fetchProfile(user.value.id)
    ready.value = true

    supabase.auth.onAuthStateChange(async (_event, session) => {
      ready.value = false
      user.value = session?.user ?? null
      if (user.value) await fetchProfile(user.value.id)
      else isAdmin.value = false
      ready.value = true
    })
  }

  function isLoggedIn() {
    return user.value !== null
  }

  return { user, isAdmin, ready, init, isLoggedIn }
})
