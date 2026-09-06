import { normalizeReportedClientContext, type ReportedClientContext } from '@risuai/protocol/client-context'

/**
 * Capture the browser values that server-owned CBS cannot observe directly.
 * Every fresh generation/preview request reports a new snapshot; Fastify uses
 * that last-reported snapshot for the lifetime of the assembled request.
 */
export function readBrowserClientContext(): ReportedClientContext | undefined {
  const context: ReportedClientContext = {}

  try {
    if (typeof navigator !== 'undefined') {
      const browserLanguage = navigator.language.trim()
      if (browserLanguage.length > 0) {
        context.browserLanguage = browserLanguage
      }
    }
  } catch {
    // Browser privacy shims may expose a throwing getter. Context reporting is
    // diagnostic input and must never prevent generation.
  }

  try {
    if (typeof window !== 'undefined') {
      const screenWidth = window.innerWidth
      if (Number.isFinite(screenWidth) && screenWidth > 0) {
        context.screenWidth = screenWidth
      }
      const screenHeight = window.innerHeight
      if (Number.isFinite(screenHeight) && screenHeight > 0) {
        context.screenHeight = screenHeight
      }
    }
  } catch {
    // See the navigator guard above.
  }

  return normalizeReportedClientContext(context)
}
