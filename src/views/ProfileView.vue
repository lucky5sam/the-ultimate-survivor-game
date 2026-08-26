<script setup lang="ts">
// Account-level settings — not tied to any season or team. Edit your name and
// password. Name is written to both the profile row and auth metadata so the two
// stay in sync (the metadata is the source used to backfill a fresh profile).
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'
import { useToast } from '../composables/useToast'
import BaseInput from '../components/base/BaseInput.vue'
import BaseButton from '../components/base/BaseButton.vue'
import BaseCard from '../components/base/BaseCard.vue'

const auth = useAuthStore()
const toast = useToast()

const firstName = ref('')
const lastName = ref('')
const savingName = ref(false)
const nameError = ref('')

const newPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)
const passwordError = ref('')

onMounted(() => {
  firstName.value = auth.firstName
  lastName.value = auth.lastName
})

async function saveProfile() {
  savingName.value = true
  nameError.value = ''

  const first = firstName.value.trim()
  const last = lastName.value.trim()

  const { error: metaErr } = await supabase.auth.updateUser({
    data: { first_name: first, last_name: last },
  })
  if (metaErr) { nameError.value = metaErr.message; savingName.value = false; return }

  if (auth.user) {
    const { error: profErr } = await supabase
      .from('profiles')
      .upsert({ id: auth.user.id, first_name: first, last_name: last }, { onConflict: 'id' })
    if (profErr) { nameError.value = profErr.message; savingName.value = false; return }
  }

  auth.firstName = first
  auth.lastName = last
  savingName.value = false
  toast.success('Profile updated')
}

async function changePassword() {
  passwordError.value = ''
  if (newPassword.value.length < 6) {
    passwordError.value = 'Password must be at least 6 characters'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = 'Passwords do not match'
    return
  }
  savingPassword.value = true
  const { error } = await supabase.auth.updateUser({ password: newPassword.value })
  if (error) { passwordError.value = error.message; savingPassword.value = false; return }
  newPassword.value = ''
  confirmPassword.value = ''
  savingPassword.value = false
  toast.success('Password updated')
}
</script>

<template>
  <div class="mx-auto w-full max-w-lg px-6 py-8">
    <h2 class="mb-6 text-2xl font-bold text-text-default">Account</h2>

    <!-- Profile details -->
    <BaseCard class="mb-6">
      <h3 class="mb-4 text-sm font-semibold text-text-default">Profile</h3>

      <div class="mb-4">
        <label class="mb-1 block text-sm font-medium text-text-default">Email</label>
        <p class="rounded-md border border-dashed border-border-subtle bg-surface-page px-3 py-2 text-sm text-text-subtle">
          {{ auth.user?.email }}
        </p>
      </div>

      <form class="space-y-4" @submit.prevent="saveProfile">
        <BaseInput v-model="firstName" label="First name" autocomplete="given-name" placeholder="First name" />
        <BaseInput v-model="lastName" label="Last name" autocomplete="family-name" placeholder="Last name" />
        <p v-if="nameError" class="text-sm text-status-error">{{ nameError }}</p>
        <div class="flex justify-end">
          <BaseButton type="submit" :loading="savingName">Save changes</BaseButton>
        </div>
      </form>
    </BaseCard>

    <!-- Change password -->
    <BaseCard>
      <h3 class="mb-4 text-sm font-semibold text-text-default">Change password</h3>
      <form class="space-y-4" @submit.prevent="changePassword">
        <BaseInput v-model="newPassword" type="password" label="New password" autocomplete="new-password" placeholder="••••••••" />
        <BaseInput v-model="confirmPassword" type="password" label="Confirm new password" autocomplete="new-password" placeholder="••••••••" />
        <p v-if="passwordError" class="text-sm text-status-error">{{ passwordError }}</p>
        <div class="flex justify-end">
          <BaseButton
            type="submit"
            :loading="savingPassword"
            :disabled="!newPassword && !confirmPassword"
          >Update password</BaseButton>
        </div>
      </form>
    </BaseCard>
  </div>
</template>
