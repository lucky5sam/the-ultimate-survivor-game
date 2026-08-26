import { createApp } from 'vue'
import { createPinia } from 'pinia'

import './style.css'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

const auth = useAuthStore()
// init() is written to never reject, but guard anyway so a failure here can
// never prevent the app from mounting (it would mount logged-out).
try {
  await auth.init()
} catch (e) {
  console.error('Auth init failed', e)
}

app.use(router)
app.mount('#app')
