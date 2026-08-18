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
import { installViewportDebugOverlayIfEnabled } from './ts/gui/viewportDebugOverlayGate'
import { installCompletionSoundPriming } from './ts/process/messageCompletionSound'
import {
  installPushNotificationForegroundCleanup,
  installPushNotificationNavigationListener,
} from './ts/server/pushNotifications'
import { alertError } from './ts/alert'
import { language } from './lang'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  console.error('Chunk load error detected:', event)
  alertError(navigator.onLine === false ? language.preloadOfflineError : language.preloadStaleError)
})

installRouter()
installPushNotificationNavigationListener()
installPushNotificationForegroundCleanup()
installVisualViewportCoordinator({ onApply: resetViewportScroll, onRelease: resetViewportScroll })
installViewportScrollGuard()
installCompletionSoundPriming()
let app = mount(App, {
  target: document.getElementById('app'),
})
void installViewportDebugOverlayIfEnabled().catch((error) => {
  console.error('Failed to install viewport diagnostics', error)
})
if (import.meta.env.VITE_FASTIFY_BROWSER_SMOKE === 'TRUE') {
  installFastifyBrowserSmokeHook()
}
loadData()
initHotkey()
document.getElementById('preloading').remove()

export default app
