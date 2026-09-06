import path from 'node:path'
import type { Rolldown } from 'vite'

const ineffectiveDynamicImportCode = 'INEFFECTIVE_DYNAMIC_IMPORT'

type BuildLogHandler = NonNullable<Rolldown.RolldownOptions['onLog']>

export interface IneffectiveDynamicImportException {
  importedModule: string
  importers: readonly string[]
  reason: string
}

// Keep exceptions exact and rare. An entry documents a deliberately shared
// static/dynamic owner; a broad substring allowlist would hide new regressions.
export const ineffectiveDynamicImportExceptions = [] satisfies readonly IneffectiveDynamicImportException[]

function normalizeModuleId(rootDir: string, moduleId: string): string {
  const withoutQuery = moduleId.split('?')[0]
  const normalizedId = withoutQuery.replaceAll('\\', '/')
  const normalizedRoot = path.resolve(rootDir).replaceAll('\\', '/')

  if (normalizedId === normalizedRoot) {
    return '.'
  }

  if (normalizedId.startsWith(`${normalizedRoot}/`)) {
    return normalizedId.slice(normalizedRoot.length + 1)
  }

  return normalizedId
}

function normalizeImporters(rootDir: string, importers: readonly string[] | undefined): string[] {
  return [...new Set((importers ?? []).map((importer) => normalizeModuleId(rootDir, importer)))].sort()
}

function hasMatchingException(
  importedModule: string,
  importers: readonly string[],
  exceptions: readonly IneffectiveDynamicImportException[],
): boolean {
  return exceptions.some((exception) => {
    if (exception.importedModule !== importedModule) {
      return false
    }

    const expectedImporters = [...new Set(exception.importers)].sort()
    return (
      expectedImporters.length === importers.length &&
      expectedImporters.every((importer, index) => importer === importers[index])
    )
  })
}

function validateExceptions(exceptions: readonly IneffectiveDynamicImportException[]): void {
  for (const exception of exceptions) {
    if (!exception.reason.trim()) {
      throw new Error(`Ineffective dynamic-import exception for ${exception.importedModule} must include a reason`)
    }
  }
}

export function createViteBuildWarningPolicy(
  rootDir: string,
  exceptions: readonly IneffectiveDynamicImportException[] = ineffectiveDynamicImportExceptions,
): BuildLogHandler {
  validateExceptions(exceptions)

  return (level, log, defaultHandler) => {
    if (log.code !== ineffectiveDynamicImportCode) {
      defaultHandler(level, log)
      return
    }

    const importedModule = normalizeModuleId(rootDir, log.id ?? '<unknown module>')
    const importers = normalizeImporters(rootDir, log.ids)

    if (hasMatchingException(importedModule, importers, exceptions)) {
      defaultHandler(level, log)
      return
    }

    const importerList = importers.length > 0 ? importers.map((id) => `  - ${id}`).join('\n') : '  - <unknown>'

    throw new Error(
      [
        `Unexplained ${ineffectiveDynamicImportCode} warning for ${importedModule}.`,
        'Static importers:',
        importerList,
        'Remove the redundant static or dynamic path. If sharing is intentional, add an exact documented exception.',
      ].join('\n'),
    )
  }
}
