<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { supabase } from '../lib/supabase'
import BaseButton from '../components/base/BaseButton.vue'
import BaseInput from '../components/base/BaseInput.vue'
import BaseCard from '../components/base/BaseCard.vue'
import PaymentFields from '../components/PaymentFields.vue'
import ThemeAtmosphere from '../components/decor/ThemeAtmosphere.vue'
import FireGlow from '../components/FireGlow.vue'
import palmFrondsUrl from '../assets/survivor_decor_palm_fronds.svg'
import lucky5LogoUrl from '../assets/lucky_5_logo.svg'
import appIconUrl from '../assets/the_ultimate_survivor_game_icon.png'

type Mode = 'signin' | 'signup' | 'forgot'

const router = useRouter()
const route = useRoute()

const mode = ref<Mode>('signin')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const firstName = ref('')
const lastName = ref('')
const paymentMethod = ref('')
const paymentHandle = ref('')
const paymentNote = ref('')
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
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.value,
      password: password.value,
    })
    if (error) errorMsg.value = error.message
    else router.push('/')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Sign in failed'
  } finally {
    loading.value = false
  }
}

async function handleSignUp() {
  // Basic email shape check — confirmation is off, so a typo'd address won't be
  // caught by a verification email. Requires user@domain.tld with no spaces.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    errorMsg.value = 'Enter a valid email address'
    return
  }
  if (password.value !== confirmPassword.value) {
    errorMsg.value = 'Passwords do not match'
    return
  }
  // Payment info is optional, but if a method is chosen its detail is required.
  const method = paymentMethod.value
  const handle = paymentHandle.value.trim()
  const note = paymentNote.value.trim()
  if ((method === 'venmo' || method === 'zelle') && !handle) {
    errorMsg.value =
      method === 'venmo' ? 'Enter your Venmo username' : 'Enter your Zelle email or phone'
    return
  }
  if (method === 'other' && !note) {
    errorMsg.value = 'Add a note about your expected payment method'
    return
  }
  const paymentData = {
    payment_method: method || null,
    payment_handle: method === 'venmo' || method === 'zelle' ? handle || null : null,
    payment_note: method === 'other' ? note || null : null,
  }

  loading.value = true
  errorMsg.value = ''
  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.value,
      password: password.value,
      // Stash name + payment info in auth metadata — this persists even before the
      // email is confirmed (when there's no session to write to profiles yet). The
      // profile row is populated from this metadata on first authenticated load.
      options: {
        data: { first_name: firstName.value, last_name: lastName.value, ...paymentData },
      },
    })
    if (error) {
      errorMsg.value = error.message
    } else {
      // If confirmation is off a session exists now, so update the row the signup
      // trigger just created (it owns the NOT NULL display_name) and drop the user
      // straight into the app — same as a normal sign-in.
      if (data.session && data.user) {
        await supabase
          .from('profiles')
          .update({
            first_name: firstName.value,
            last_name: lastName.value,
            ...paymentData,
          })
          .eq('id', data.user.id)
        router.push('/')
      } else {
        // No session: either email confirmation is on, or the address already has
        // an account (Supabase obfuscates that case by returning no session).
        successMsg.value = 'Check your email to confirm your account.'
      }
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Sign up failed'
  } finally {
    loading.value = false
  }
}

async function handleForgot() {
  loading.value = true
  errorMsg.value = ''
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.value, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) errorMsg.value = error.message
    else successMsg.value = 'Check your email for a password reset link.'
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Could not send reset link'
  } finally {
    loading.value = false
  }
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
  <div
    class="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface-page px-4"
  >
    <!-- Ambient theme decor. Invisible until data-skin="raw"; costs nothing in flat mode. -->
    <ThemeAtmosphere />

    <!-- Palm-frond decor in the top-left corner (decorative, non-interactive). -->
    <img
      :src="palmFrondsUrl"
      alt=""
      aria-hidden="true"
      class="pointer-events-none absolute left-0 top-0 w-64 select-none opacity-20 sm:w-80"
    />

    <!-- Ambient Survivor fire glow along the bottom edge (decorative, non-interactive). -->
    <FireGlow position="absolute" />

    <div class="relative z-10 w-full max-w-sm">
      <div class="mb-6 text-center">
        <img
          :src="appIconUrl"
          alt="The Ultimate Survivor Game"
          class="mx-auto mb-2 w-40 select-none"
        />
        <h1 class="text-2xl font-bold text-text-default">The Ultimate Survivor Game</h1>
        <p class="mt-1 text-base text-text-subtle">Outdraft. Outscore. Outlast.</p>
      </div>

      <BaseCard padding="lg">
        <div
          v-if="mode !== 'forgot'"
          class="mb-6 flex gap-1 rounded-md bg-surface-subtle p-1"
        >
          <button
            @click="switchMode('signin')"
            :class="[
              'flex-1 rounded-sm py-1.5 text-sm font-medium transition-colors',
              mode === 'signin'
                ? 'bg-surface-default text-text-default shadow-sm'
                : 'text-text-subtle hover:text-text-default',
            ]"
          >
            Sign in
          </button>
          <button
            @click="switchMode('signup')"
            :class="[
              'flex-1 rounded-sm py-1.5 text-sm font-medium transition-colors',
              mode === 'signup'
                ? 'bg-surface-default text-text-default shadow-sm'
                : 'text-text-subtle hover:text-text-default',
            ]"
          >
            Sign up
          </button>
        </div>

        <div
          v-if="successMsg"
          class="rounded-md bg-status-success-surface px-3 py-2 text-sm text-status-success"
        >
          {{ successMsg }}
        </div>

        <template v-else>
          <div v-if="mode !== 'forgot'" class="mb-4 space-y-3">
            <BaseButton variant="secondary" block @click="handleGoogleSignIn">
              <svg class="h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </BaseButton>
            <div class="relative">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-border-subtle"></div>
              </div>
              <div class="relative flex justify-center">
                <span class="bg-surface-default px-2 text-xs text-text-muted">or</span>
              </div>
            </div>
          </div>

          <form @submit.prevent="handleSubmit" class="space-y-4">
            <BaseInput v-model="email" label="Email" type="email" required autocomplete="email" />

            <div v-if="mode === 'signup'" class="grid grid-cols-2 gap-3">
              <BaseInput v-model="firstName" label="First name" required />
              <BaseInput v-model="lastName" label="Last name" required />
            </div>

            <template v-if="mode !== 'forgot'">
              <BaseInput
                v-model="password"
                label="Password"
                type="password"
                required
                :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
              />
              <BaseInput
                v-if="mode === 'signup'"
                v-model="confirmPassword"
                label="Confirm password"
                type="password"
                required
                autocomplete="new-password"
              />
            </template>

            <div v-if="mode === 'signup'" class="border-t border-border-subtle pt-4">
              <p class="mb-3 text-xs text-text-muted">
                Optional — how you'd like to receive prizes. You can add or change this later.
              </p>
              <PaymentFields
                v-model:method="paymentMethod"
                v-model:handle="paymentHandle"
                v-model:note="paymentNote"
              />
            </div>

            <p v-if="errorMsg" class="text-sm text-status-error">{{ errorMsg }}</p>

            <BaseButton type="submit" block :loading="loading">
              {{
                mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send reset link'
              }}
            </BaseButton>

            <p v-if="mode === 'signin'" class="text-center">
              <button
                type="button"
                @click="switchMode('forgot')"
                class="text-sm text-text-muted hover:text-text-subtle hover:cursor-pointer"
              >
                Forgot password?
              </button>
            </p>
            <p v-if="mode === 'forgot'" class="text-center">
              <button
                type="button"
                @click="switchMode('signin')"
                class="text-sm text-text-muted hover:text-text-subtle"
              >
                Back to sign in
              </button>
            </p>
          </form>
        </template>
      </BaseCard>

      <!-- Attribution callout beneath the login card. -->
      <div class="mt-6 flex items-center justify-center gap-2 text-sm text-text-subtle">
        <span>Presented by</span>
        <img
          :src="lucky5LogoUrl"
          alt="Lucky 5 Games"
          class="h-5 w-auto select-none"
        />
        <span class="font-medium text-text-default">Lucky 5 Games</span>
      </div>
    </div>
  </div>
</template>
