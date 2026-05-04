<script setup lang="ts">
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'

const router = useRouter()

async function handleSignOut() {
  await supabase.auth.signOut()
  router.push('/login')
}
</script>

<template>
  <div class="p-8">
    <h1 class="text-2xl font-bold mb-4">Welcome to Survivor Fantasy</h1>
    <button @click="handleSignOut" class="text-sm text-red-500 hover:text-red-700">Sign out</button>
  </div>
</template>
