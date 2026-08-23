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
import { installCompletionAudioUnlock } from './ts/process/messageCompletionSound'
import {
  installPushNotificationForegroundCleanup,
  installPushNotificationNavigationListener,
} from './ts/server/pushNotifications'
import { recordStartupMilestone } from './ts/startupReadiness'

export function startApplication() {
  installRouter()
  installPushNotificationNavigationListener()
  installPushNotificationForegroundCleanup()
  installVisualViewportCoordinator({ onApply: resetViewportScroll, onRelease: resetViewportScroll })
  installViewportScrollGuard()
  installCompletionAudioUnlock()
  const app = mount(App, {
    target: document.getElementById('app')!,
  })
  recordStartupMilestone('shell-mounted')
  void installViewportDebugOverlayIfEnabled().catch((error) => {
    console.error('Failed to install viewport diagnostics', error)
  })
  if (import.meta.env.VITE_FASTIFY_BROWSER_SMOKE === 'TRUE') {
    installFastifyBrowserSmokeHook()
  }
  void loadData()
  initHotkey()
  document.getElementById('preloading')?.remove()

  return app
}
