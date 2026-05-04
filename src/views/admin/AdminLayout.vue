<script setup lang="ts">
import { useAuthStore } from '../../stores/auth'
import { useRouter } from 'vue-router'
import { supabase } from '../../lib/supabase'

const auth = useAuthStore()
const router = useRouter()

async function handleSignOut() {
  await supabase.auth.signOut()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen flex">
    <aside class="w-56 bg-gray-900 text-white flex flex-col">
      <div class="px-6 py-5 text-lg font-bold border-b border-gray-700">
        Survivor Admin
      </div>
      <nav class="flex-1 px-4 py-4 space-y-1">
        <RouterLink
          to="/admin/seasons"
          class="block px-3 py-2 rounded-lg text-sm hover:bg-gray-700"
          active-class="bg-gray-700"
        >
          Seasons
        </RouterLink>
      </nav>
      <div class="px-4 py-4 border-t border-gray-700 text-xs text-gray-400">
        <p class="truncate mb-2">{{ auth.user?.email }}</p>
        <button @click="handleSignOut" class="text-red-400 hover:text-red-300">Sign out</button>
      </div>
    </aside>

    <main class="flex-1 bg-gray-50 p-8">
      <RouterView />
    </main>
  </div>
</template>
