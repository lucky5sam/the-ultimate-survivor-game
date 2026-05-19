<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'forgot'

const router = useRouter()
const route = useRoute()

const mode = ref<Mode>('signin')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const firstName = ref('')
const lastName = ref('')
const errorMsg = ref('')
const successMsg = ref('')
const loading = ref(false)

onMounted(() => {
  if (route.query.mode === 'signup') mode.value = 'signup'
  if (route.query.code) sessionStorage.setItem('pending_league_code', String(route.query.code))
})

function switchMode(m: Mode) {
  mode.value = m
  errorMsg.value = ''
  successMsg.value = ''
}

async function handleSignIn() {
  loading.value = true
  errorMsg.value = ''
  const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
  if (error) errorMsg.value = error.message
  else router.push('/')
  loading.value = false
}

async function handleSignUp() {
  if (password.value !== confirmPassword.value) {
    errorMsg.value = 'Passwords do not match'
    return
  }
  loading.value = true
  errorMsg.value = ''
  const { data, error } = await supabase.auth.signUp({ email: email.value, password: password.value })
  if (error) {
    errorMsg.value = error.message
  } else {
    if (data.user) {
      await supabase.from('profiles').upsert(
        { id: data.user.id, first_name: firstName.value, last_name: lastName.value },
        { onConflict: 'id' }
      )
    }
    successMsg.value = 'Check your email to confirm your account.'
  }
  loading.value = false
}

async function handleForgot() {
  loading.value = true
  errorMsg.value = ''
  const { error } = await supabase.auth.resetPasswordForEmail(email.value, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) errorMsg.value = error.message
  else successMsg.value = 'Check your email for a password reset link.'
  loading.value = false
}

async function handleGoogleSignIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
  })
  if (error) errorMsg.value = error.message
}

function handleSubmit() {
  if (mode.value === 'signin') handleSignIn()
  else if (mode.value === 'signup') handleSignUp()
  else handleForgot()
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="w-full max-w-sm bg-white rounded-xl shadow p-8">
      <h1 class="text-2xl font-bold text-center mb-6">Survivor Fantasy</h1>

      <div class="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        <button
          @click="switchMode('signin')"
          :class="['flex-1 text-sm font-medium py-1.5 rounded-md transition-colors', mode === 'signin' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700']"
        >Sign in</button>
        <button
          @click="switchMode('signup')"
          :class="['flex-1 text-sm font-medium py-1.5 rounded-md transition-colors', mode === 'signup' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700']"
        >Sign up</button>
      </div>

      <div v-if="successMsg" class="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">
        {{ successMsg }}
      </div>

      <template v-else>
        <div v-if="mode !== 'forgot'" class="space-y-3 mb-4">
          <button
            type="button"
            @click="handleGoogleSignIn"
            class="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
          <div class="relative">
            <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-gray-200"></div></div>
            <div class="relative flex justify-center"><span class="bg-white px-2 text-xs text-gray-400">or</span></div>
          </div>
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input v-model="email" type="email" required
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <template v-if="mode === 'signup'">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">First name</label>
              <input v-model="firstName" type="text" required
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Last name</label>
              <input v-model="lastName" type="text" required
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </template>

        <template v-if="mode !== 'forgot'">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input v-model="password" type="password" required
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div v-if="mode === 'signup'">
            <label class="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
            <input v-model="confirmPassword" type="password" required
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </template>

        <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>

        <button type="submit" :disabled="loading"
          class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2 text-sm">
          {{ loading ? '…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link' }}
        </button>

        <p v-if="mode === 'signin'" class="text-center">
          <button type="button" @click="switchMode('forgot')" class="text-xs text-gray-400 hover:text-gray-600">
            Forgot password?
          </button>
        </p>
        <p v-if="mode === 'forgot'" class="text-center">
          <button type="button" @click="switchMode('signin')" class="text-xs text-gray-400 hover:text-gray-600">
            Back to sign in
          </button>
        </p>
        </form>
      </template>
    </div>
  </div>
</template>
