<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { supabase } from '../../lib/supabase'

const registrationCode = ref('')
const newCode = ref('')
const loading = ref(true)
const saving = ref(false)
const errorMsg = ref('')
const successMsg = ref('')
const codeVisible = ref(false)
const linkCopied = ref(false)

const inviteLink = computed(
  () => `${window.location.origin}/login?mode=signup&code=${registrationCode.value}`
)

async function fetchCode() {
  loading.value = true
  const { data, error } = await supabase
    .from('league_settings')
    .select('registration_code')
    .eq('id', 1)
    .single()
  if (error) errorMsg.value = error.message
  else {
    registrationCode.value = data.registration_code
    newCode.value = data.registration_code
  }
  loading.value = false
}

async function saveCode() {
  if (!newCode.value.trim()) return
  saving.value = true
  errorMsg.value = ''
  successMsg.value = ''
  const { error } = await supabase
    .from('league_settings')
    .update({ registration_code: newCode.value.trim() })
    .eq('id', 1)
  if (error) {
    errorMsg.value = error.message
  } else {
    registrationCode.value = newCode.value.trim()
    successMsg.value = 'League code updated.'
  }
  saving.value = false
}

async function copyInviteLink() {
  await navigator.clipboard.writeText(inviteLink.value)
  linkCopied.value = true
  setTimeout(() => (linkCopied.value = false), 2000)
}

onMounted(fetchCode)
</script>

<template>
  <div class="max-w-lg">
    <h2 class="text-xl font-semibold text-gray-900 mb-6">League Settings</h2>

    <div v-if="loading" class="text-sm text-gray-500">Loading…</div>

    <template v-else>
      <div class="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <h3 class="text-sm font-medium text-gray-700 mb-1">Registration Code</h3>
          <p class="text-xs text-gray-400 mb-3">Players must enter this code to create an account.</p>

          <div class="flex items-center gap-2 mb-4">
            <div class="flex-1 relative">
              <input
                :type="codeVisible ? 'text' : 'password'"
                :value="registrationCode"
                readonly
                class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 font-mono"
              />
            </div>
            <button
              type="button"
              @click="codeVisible = !codeVisible"
              class="text-xs text-gray-500 hover:text-gray-700 px-3 py-2 border border-gray-200 rounded-lg"
            >{{ codeVisible ? 'Hide' : 'Show' }}</button>
          </div>

          <div class="flex gap-2">
            <input
              v-model="newCode"
              type="text"
              placeholder="New code"
              class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              @click="saveCode"
              :disabled="saving || newCode === registrationCode"
              class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
            >{{ saving ? 'Saving…' : 'Update' }}</button>
          </div>

          <p v-if="errorMsg" class="text-sm text-red-600 mt-2">{{ errorMsg }}</p>
          <p v-if="successMsg" class="text-sm text-green-600 mt-2">{{ successMsg }}</p>
        </div>

        <div class="border-t border-gray-100 pt-5">
          <h3 class="text-sm font-medium text-gray-700 mb-1">Invite Link</h3>
          <p class="text-xs text-gray-400 mb-3">Share this link — it auto-fills the league code on the sign-up page.</p>
          <div class="flex items-center gap-2">
            <input
              :value="inviteLink"
              readonly
              class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs bg-gray-50 text-gray-600 font-mono truncate"
            />
            <button
              @click="copyInviteLink"
              class="text-xs text-gray-500 hover:text-gray-700 px-3 py-2 border border-gray-200 rounded-lg whitespace-nowrap"
            >{{ linkCopied ? 'Copied!' : 'Copy' }}</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
