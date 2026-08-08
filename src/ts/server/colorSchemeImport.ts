import type { ColorScheme } from '../gui/colorscheme'
import { createLatestOperationGuard, type LatestOperationToken } from './staleStateGuards'

const COLOR_SCHEME_IMPORT_TARGET = 'colorSchemeImport' as const

export interface ColorSchemeImportTarget {
  readonly colorSchemeNameSnapshot: string
  readonly colorSchemeSnapshot: string
  readonly customColorSchemeSnapshot: string
}

export interface ColorSchemeImportOperation extends ColorSchemeImportTarget {
  readonly token: LatestOperationToken<typeof COLOR_SCHEME_IMPORT_TARGET>
}

export interface ColorSchemeImportFreshness {
  readonly colorSchemeName: unknown
  readonly colorScheme: unknown
  readonly customColorScheme: unknown
}

export type ColorSchemeImportPatch = Record<string, unknown> & {
  readonly colorSchemeName: 'custom'
  readonly colorScheme: ColorScheme
  readonly customColorScheme: ColorScheme
}

const colorSchemeImportGuard = createLatestOperationGuard<typeof COLOR_SCHEME_IMPORT_TARGET>()

const colorSchemeStringFields = [
  'bgcolor',
  'darkbg',
  'borderc',
  'selected',
  'draculared',
  'textcolor',
  'textcolor2',
  'darkBorderc',
  'darkbutton',
  'type',
] as const

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function isColorSchemeShape(value: unknown): value is Record<(typeof colorSchemeStringFields)[number], unknown> {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Record<(typeof colorSchemeStringFields)[number], unknown>
  return colorSchemeStringFields.every((field) => typeof candidate[field] === 'string')
}

export function parseColorSchemeImport(source: string): ColorScheme | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }

  return isColorSchemeShape(parsed) ? (parsed as ColorScheme) : null
}

export function captureColorSchemeImportTarget(freshness: ColorSchemeImportFreshness): ColorSchemeImportTarget {
  return {
    colorSchemeNameSnapshot: snapshotJson(freshness.colorSchemeName),
    colorSchemeSnapshot: snapshotJson(freshness.colorScheme),
    customColorSchemeSnapshot: snapshotJson(freshness.customColorScheme),
  }
}

export function beginColorSchemeImport(target: ColorSchemeImportTarget): ColorSchemeImportOperation {
  return {
    ...target,
    token: colorSchemeImportGuard.issue(COLOR_SCHEME_IMPORT_TARGET),
  }
}

export function clearColorSchemeImport(operation: ColorSchemeImportOperation): void {
  colorSchemeImportGuard.clear(operation.token)
}

export function isFreshColorSchemeImport(
  operation: ColorSchemeImportOperation,
  freshness: ColorSchemeImportFreshness,
): boolean {
  if (!colorSchemeImportGuard.isLatest(operation.token)) return false
  if (snapshotJson(freshness.colorSchemeName) !== operation.colorSchemeNameSnapshot) return false
  if (snapshotJson(freshness.colorScheme) !== operation.colorSchemeSnapshot) return false
  return snapshotJson(freshness.customColorScheme) === operation.customColorSchemeSnapshot
}

export function resolveFreshColorSchemeImportPatch(input: {
  operation: ColorSchemeImportOperation
  freshness: ColorSchemeImportFreshness
  colorScheme: ColorScheme
}): ColorSchemeImportPatch | null {
  if (!isFreshColorSchemeImport(input.operation, input.freshness)) return null
  return {
    colorSchemeName: 'custom',
    colorScheme: input.colorScheme,
    customColorScheme: input.colorScheme,
  }
}
