<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'

const router = useRouter()

const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const errorMsg = ref('')
const success = ref(false)

let authSub: { unsubscribe: () => void } | null = null

onMounted(() => {
  const { data } = supabase.auth.onAuthStateChange((_event, _session) => {})
  authSub = data.subscription
})

onUnmounted(() => {
  authSub?.unsubscribe()
})

async function handleReset() {
  if (password.value !== confirmPassword.value) {
    errorMsg.value = 'Passwords do not match'
    return
  }
  if (password.value.length < 6) {
    errorMsg.value = 'Password must be at least 6 characters'
    return
  }
  loading.value = true
  errorMsg.value = ''
  const { error } = await supabase.auth.updateUser({ password: password.value })
  if (error) {
    errorMsg.value = error.message
  } else {
    success.value = true
    setTimeout(() => router.push('/'), 2000)
  }
  loading.value = false
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="w-full max-w-sm bg-white rounded-xl shadow p-8">
      <h1 class="text-2xl font-bold text-center mb-2">Survivor Fantasy</h1>
      <h2 class="text-base font-semibold text-gray-600 text-center mb-6">Set new password</h2>

      <div v-if="success" class="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">
        Password updated! Redirecting…
      </div>

      <form v-else @submit.prevent="handleReset" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">New password</label>
          <input v-model="password" type="password" required minlength="6"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
          <input v-model="confirmPassword" type="password" required
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>

        <button type="submit" :disabled="loading"
          class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2 text-sm">
          {{ loading ? 'Saving…' : 'Set password' }}
        </button>
      </form>
    </div>
  </div>
</template>
