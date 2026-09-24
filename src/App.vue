<script setup lang="ts">
import ToastContainer from './components/ToastContainer.vue'
// Vercel Web Analytics — the Vue integration (NOT the /next one, which is React).
// Auto-tracks page views across route changes; only sends in production.
import { Analytics } from '@vercel/analytics/vue'
</script>

<template>
  <RouterView />
  <ToastContainer />
  <Analytics />
</template>
