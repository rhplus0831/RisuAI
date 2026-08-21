export interface ReportedClientContext {
  browserLanguage?: string
  screenWidth?: number
  screenHeight?: number
}

const MAX_BROWSER_LANGUAGE_LENGTH = 128
const MAX_REPORTED_SCREEN_DIMENSION = 100_000
const BROWSER_LANGUAGE_PATTERN = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/u

export function normalizeReportedClientContext(value: unknown): ReportedClientContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const browserLanguageValue = typeof raw.browserLanguage === 'string' ? raw.browserLanguage.trim() : ''
  const browserLanguage =
    browserLanguageValue.length <= MAX_BROWSER_LANGUAGE_LENGTH && BROWSER_LANGUAGE_PATTERN.test(browserLanguageValue)
      ? browserLanguageValue
      : undefined
  const screenWidthValue = raw.screenWidth
  const screenWidth =
    typeof screenWidthValue === 'number' && Number.isFinite(screenWidthValue) && screenWidthValue > 0
      ? Math.min(Math.round(screenWidthValue), MAX_REPORTED_SCREEN_DIMENSION)
      : undefined
  const screenHeightValue = raw.screenHeight
  const screenHeight =
    typeof screenHeightValue === 'number' && Number.isFinite(screenHeightValue) && screenHeightValue > 0
      ? Math.min(Math.round(screenHeightValue), MAX_REPORTED_SCREEN_DIMENSION)
      : undefined

  return browserLanguage !== undefined || screenWidth !== undefined || screenHeight !== undefined
    ? { browserLanguage, screenWidth, screenHeight }
    : undefined
}

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
