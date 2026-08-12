import './ts/polyfill'
import 'core-js/actual'
import './ts/storage/database.svelte'
import App from './App.svelte'
import { loadData } from './ts/bootstrap'
import { initHotkey } from './ts/hotkey'
import { installRouter } from './ts/router'
import { mount } from 'svelte'
import { installFastifyBrowserSmokeHook } from './ts/server/browserSmoke'
import { installViewportScrollGuard, resetViewportScroll } from './ts/gui/viewportScrollGuard'
import { installVisualViewportCoordinator } from './ts/gui/visualViewportCoordinator'
import {
  installPushNotificationForegroundCleanup,
  installPushNotificationNavigationListener,
} from './ts/server/pushNotifications'
import { alertError } from './ts/alert'
import { language } from './lang'

window.addEventListener('vite:preloadError', (event) => {
  console.error('Chunk load error detected:', event)
  alertError(language.preloadError)
})

installRouter()
installPushNotificationNavigationListener()
installPushNotificationForegroundCleanup()
installVisualViewportCoordinator({ onRelease: resetViewportScroll })
installViewportScrollGuard()
let app = mount(App, {
  target: document.getElementById('app'),
})
if (import.meta.env.VITE_FASTIFY_BROWSER_SMOKE === 'TRUE') {
  installFastifyBrowserSmokeHook()
}
loadData()
initHotkey()
document.getElementById('preloading').remove()

export default app
