import { language } from './lang'
import { alertError } from './ts/alert'
import { renderEntryLoadError } from './ts/entryLoadError'
import { startApplicationAfterEnvironment } from './ts/entryStartup'
import { installRuntimeEnvironment } from './ts/polyfill'
import { recordStartupMilestone } from './ts/startupReadiness'

recordStartupMilestone('entry', 0)

function entryLoadErrorMessage(): string {
  return navigator.onLine === false ? language.preloadOfflineError : language.preloadStaleError
}

function showEntryLoadError(error: unknown): void {
  console.error('Application entry load failed:', error)
  const message = entryLoadErrorMessage()
  alertError(message)
  renderEntryLoadError({
    documentTarget: document,
    message,
    reloadLabel: language.preloadReload,
    onReload: () => window.location.reload(),
  })
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  showEntryLoadError(event)
})

const app = startApplicationAfterEnvironment(installRuntimeEnvironment, () => import('./appStartup')).catch((error) => {
  showEntryLoadError(error)
  return null
})

export default app
