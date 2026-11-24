// A test-only page for the notification compatibility gate (e2e/notifications-compat.mjs): the
// real host and facade with long Arabic text. It is built apart from the application and mounted
// only into the gate's container, so the application gains no route, button or window hook.
// Without the mount, /__compat/ is no 404: nginx's SPA fallback serves the app's index.html (200).
import { createPinia } from 'pinia'
import { createApp, h } from 'vue'

import '@/assets/main.css'
import NotificationHost from '@/components/NotificationHost.vue'
import { notify, type UiSeverity } from '@/lib/notifications'
import { useLocaleStore } from '@/stores/locale'

const ARABIC = 'تم تجهيز ملف الأدلة لهذا التنبيه، وهو يضم العقد والعلاقات ومصدر كل سجل فيه. '
const SEVERITIES: UiSeverity[] = ['success', 'info', 'warning', 'error']

const app = createApp({
  render: () => [
    h(
      'main',
      { class: 'page' },
      SEVERITIES.map((severity) =>
        h(
          'button',
          { type: 'button', onClick: () => notify({ severity, message: ARABIC.repeat(4).trim() }) },
          severity,
        ),
      ),
    ),
    h(NotificationHost),
  ],
})
app.use(createPinia())
useLocaleStore().setLocale(new URLSearchParams(location.search).get('dir') === 'rtl' ? 'ar' : 'en')
app.mount('#app')
