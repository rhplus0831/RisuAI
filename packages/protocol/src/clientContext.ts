import { Type, type Static } from '@sinclair/typebox'

export const ReportedClientContextSchema = Type.Object(
  {
    browserLanguage: Type.Optional(Type.String()),
    screenWidth: Type.Optional(Type.Number()),
    screenHeight: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
)

export type ReportedClientContext = Static<typeof ReportedClientContextSchema>

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
