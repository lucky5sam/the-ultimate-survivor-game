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
import PaymentFields from '../components/PaymentFields.vue'
import ImageUploadField from '../components/ImageUploadField.vue'
import { uploadImage } from '../lib/uploadImage'

const auth = useAuthStore()
const toast = useToast()

const firstName = ref('')
const lastName = ref('')
const savingName = ref(false)
const nameError = ref('')

// Profile photo: the picker hands us a File to upload on save, or a remove
// signal (avatarFile stays null, avatarRemoved flips true).
const avatarFile = ref<File | null>(null)
const avatarRemoved = ref(false)
const savingAvatar = ref(false)
const avatarError = ref('')

function onAvatarSelect(file: File) {
  avatarFile.value = file
  avatarRemoved.value = false
}
function onAvatarRemove() {
  avatarFile.value = null
  avatarRemoved.value = true
}

async function saveAvatar() {
  if (!auth.user) return
  avatarError.value = ''
  savingAvatar.value = true
  try {
    let url: string | null = auth.avatarUrl || null
    if (avatarFile.value) {
      url = await uploadImage(avatarFile.value, 'avatars')
    } else if (avatarRemoved.value) {
      url = null
    }

    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: url })
      .eq('id', auth.user.id)
    if (error) throw new Error(error.message)
    // Mirror to auth metadata, matching how name/payment are kept in sync.
    await supabase.auth.updateUser({ data: { avatar_url: url } })

    auth.avatarUrl = url ?? ''
    avatarFile.value = null
    avatarRemoved.value = false
    toast.success('Profile photo updated')
  } catch (e) {
    avatarError.value = e instanceof Error ? e.message : 'Failed to update photo'
  } finally {
    savingAvatar.value = false
  }
}

const paymentMethod = ref('')
const paymentHandle = ref('')
const paymentNote = ref('')
const savingPayment = ref(false)
const paymentError = ref('')

const newPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)
const passwordError = ref('')

onMounted(() => {
  firstName.value = auth.firstName
  lastName.value = auth.lastName
  paymentMethod.value = auth.paymentMethod
  paymentHandle.value = auth.paymentHandle
  paymentNote.value = auth.paymentNote
})

async function savePayment() {
  paymentError.value = ''
  const method = paymentMethod.value
  const handle = paymentHandle.value.trim()
  const note = paymentNote.value.trim()

  if ((method === 'venmo' || method === 'zelle') && !handle) {
    paymentError.value =
      method === 'venmo' ? 'Enter your Venmo username' : 'Enter your Zelle email or phone'
    return
  }
  if (method === 'other' && !note) {
    paymentError.value = 'Add a note about your expected payment method'
    return
  }

  savingPayment.value = true
  const payload = {
    payment_method: method || null,
    payment_handle: method === 'venmo' || method === 'zelle' ? handle || null : null,
    payment_note: method === 'other' ? note || null : null,
  }
  try {
    const { error: metaErr } = await supabase.auth.updateUser({ data: payload })
    if (metaErr) throw new Error(metaErr.message)
    if (auth.user) {
      // The profile row is created by a signup trigger (with a NOT NULL
      // display_name), so only ever UPDATE our own fields — never upsert/insert.
      const { error } = await supabase.from('profiles').update(payload).eq('id', auth.user.id)
      if (error) throw new Error(error.message)
    }
    auth.paymentMethod = payload.payment_method ?? ''
    auth.paymentHandle = payload.payment_handle ?? ''
    auth.paymentNote = payload.payment_note ?? ''
    toast.success('Payment info updated')
  } catch (e) {
    paymentError.value = e instanceof Error ? e.message : 'Failed to update payment info'
  } finally {
    savingPayment.value = false
  }
}

async function saveProfile() {
  savingName.value = true
  nameError.value = ''

  const first = firstName.value.trim()
  const last = lastName.value.trim()

  try {
    const { error: metaErr } = await supabase.auth.updateUser({
      data: { first_name: first, last_name: last },
    })
    if (metaErr) throw new Error(metaErr.message)

    if (auth.user) {
      const { error: profErr } = await supabase
        .from('profiles')
        .update({ first_name: first, last_name: last })
        .eq('id', auth.user.id)
      if (profErr) throw new Error(profErr.message)
    }

    auth.firstName = first
    auth.lastName = last
    toast.success('Profile updated')
  } catch (e) {
    nameError.value = e instanceof Error ? e.message : 'Failed to update profile'
  } finally {
    savingName.value = false
  }
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
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword.value })
    if (error) throw new Error(error.message)
    newPassword.value = ''
    confirmPassword.value = ''
    toast.success('Password updated')
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : 'Failed to update password'
  } finally {
    savingPassword.value = false
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-lg px-6 py-8">
    <h2 class="mb-6 text-2xl font-bold text-text-default">Account</h2>

    <!-- Profile photo -->
    <BaseCard class="mb-6">
      <h3 class="mb-4 text-sm font-semibold text-text-default">Profile photo</h3>
      <ImageUploadField
        :model-value="avatarRemoved ? null : auth.avatarUrl || null"
        shape="circle"
        :size="96"
        @select="onAvatarSelect"
        @remove="onAvatarRemove"
      />
      <p v-if="avatarError" class="mt-3 text-sm text-status-error">{{ avatarError }}</p>
      <div class="mt-4 flex justify-end">
        <BaseButton
          :loading="savingAvatar"
          :disabled="!avatarFile && !avatarRemoved"
          @click="saveAvatar"
          >Save photo</BaseButton
        >
      </div>
    </BaseCard>

    <!-- Profile details -->
    <BaseCard class="mb-6">
      <h3 class="mb-4 text-sm font-semibold text-text-default">Profile</h3>

      <div class="mb-4">
        <label class="mb-1 block text-sm font-medium text-text-default">Email</label>
        <p
          class="rounded-md border border-dashed border-border-subtle bg-surface-page px-3 py-2 text-sm text-text-subtle"
        >
          {{ auth.user?.email }}
        </p>
      </div>

      <form class="space-y-4" @submit.prevent="saveProfile">
        <BaseInput
          v-model="firstName"
          label="First name"
          autocomplete="given-name"
          placeholder="First name"
        />
        <BaseInput
          v-model="lastName"
          label="Last name"
          autocomplete="family-name"
          placeholder="Last name"
        />
        <p v-if="nameError" class="text-sm text-status-error">{{ nameError }}</p>
        <div class="flex justify-end">
          <BaseButton type="submit" :loading="savingName">Save changes</BaseButton>
        </div>
      </form>
    </BaseCard>

    <!-- Payment -->
    <BaseCard class="mb-6">
      <h3 class="mb-1 text-sm font-semibold text-text-default">Payment</h3>
      <p class="mb-4 text-xs text-text-muted">
        How you'd like to receive prize payouts. Required to be eligible for prizes.
      </p>
      <form class="space-y-4" @submit.prevent="savePayment">
        <PaymentFields
          v-model:method="paymentMethod"
          v-model:handle="paymentHandle"
          v-model:note="paymentNote"
        />
        <p v-if="paymentError" class="text-sm text-status-error">{{ paymentError }}</p>
        <div class="flex justify-end">
          <BaseButton type="submit" :loading="savingPayment">Save payment info</BaseButton>
        </div>
      </form>
    </BaseCard>

    <!-- Change password -->
    <BaseCard>
      <h3 class="mb-4 text-sm font-semibold text-text-default">Change password</h3>
      <form class="space-y-4" @submit.prevent="changePassword">
        <BaseInput
          v-model="newPassword"
          type="password"
          label="New password"
          autocomplete="new-password"
          placeholder="••••••••"
        />
        <BaseInput
          v-model="confirmPassword"
          type="password"
          label="Confirm new password"
          autocomplete="new-password"
          placeholder="••••••••"
        />
        <p v-if="passwordError" class="text-sm text-status-error">{{ passwordError }}</p>
        <div class="flex justify-end">
          <BaseButton
            type="submit"
            :loading="savingPassword"
            :disabled="!newPassword && !confirmPassword"
            >Update password</BaseButton
          >
        </div>
      </form>
    </BaseCard>
  </div>
</template>
