import { errorHandler as monacoErrorHandler } from 'monaco-editor/esm/vs/base/common/errors.js'

type MonacoErrorHandler = {
  unexpectedErrorHandler?: (error: unknown) => void
}

const installedWorkerErrorFilters = new WeakSet<MonacoErrorHandler>()

export function isMonacoWorkerErrorEvent(error: unknown): error is Event {
  return (
    typeof Event !== 'undefined' &&
    error instanceof Event &&
    error.type === 'error' &&
    typeof Worker !== 'undefined' &&
    error.target instanceof Worker
  )
}

export function installMonacoWorkerErrorEventFilter(handler: MonacoErrorHandler = monacoErrorHandler): void {
  if (installedWorkerErrorFilters.has(handler) || typeof handler.unexpectedErrorHandler !== 'function') {
    return
  }

  const originalUnexpectedErrorHandler = handler.unexpectedErrorHandler.bind(handler)
  handler.unexpectedErrorHandler = (error: unknown) => {
    if (isMonacoWorkerErrorEvent(error)) {
      console.warn('Monaco editor worker reported an error event during popup editor lifecycle.', error)
      return
    }

    originalUnexpectedErrorHandler(error)
  }
  installedWorkerErrorFilters.add(handler)
}
