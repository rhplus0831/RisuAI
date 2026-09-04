import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInside, moduleSpecifiers, parseSource, resolveModule } from '../../../util/test-support/source-contract.js'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.dirname(fileURLToPath(import.meta.url))

function discoverRuntimeFiles(root: string, directory = root): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...discoverRuntimeFiles(root, absolutePath))
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path.relative(root, absolutePath).replaceAll(path.sep, '/'))
    }
  }
  return files.sort()
}

function auditImportBoundary(root: string): { runtimeFiles: string[]; violations: string[] } {
  const runtimeFiles = discoverRuntimeFiles(root)
  const violations: string[] = []
  for (const file of runtimeFiles) {
    const absolutePath = path.join(root, file)
    for (const specifier of moduleSpecifiers(parseSource(absolutePath, fs.readFileSync(absolutePath, 'utf8')))) {
      if (!specifier.startsWith('.')) {
        violations.push(`${file}: ${specifier}`)
        continue
      }
      const target = resolveModule(root, absolutePath, specifier)
      if (!target || !isInside(root, target)) {
        violations.push(`${file}: ${specifier}`)
      }
    }
  }
  return { runtimeFiles, violations }
}

describe('@risuai/shared-core import boundary', () => {
  it('keeps every runtime module dependency-free and inside shared core', () => {
    const result = auditImportBoundary(sourceRoot)
    expect(result.runtimeFiles.length).toBeGreaterThan(0)
    expect(result.violations).toEqual([])
  })

  it('rejects bare, nested, dynamic, require, and package-escape imports', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-shared-core-import-boundary-'))
    try {
      fs.mkdirSync(path.join(fixtureRoot, 'nested'))
      fs.writeFileSync(
        path.join(fixtureRoot, 'index.ts'),
        `
          import { writable } from 'svelte/store'
          const dynamicModule = import('node:path')
          type Imported = import('node:crypto').Hash
          const computed = import(moduleName)
          export { missing } from './missing.js'
          // import fake from 'node:util'
          const example = "require('node:util')"
        `,
      )
      fs.writeFileSync(
        path.join(fixtureRoot, 'nested', 'runtime.ts'),
        `
          import fs = require('node:fs')
          const platform = require('node:os')
          export { escaped } from '../../outside.js'
        `,
      )
      expect(auditImportBoundary(fixtureRoot)).toEqual({
        runtimeFiles: ['index.ts', 'nested/runtime.ts'],
        violations: [
          'index.ts: svelte/store',
          'index.ts: node:path',
          'index.ts: node:crypto',
          'index.ts: <non-literal module>',
          'index.ts: ./missing.js',
          'nested/runtime.ts: node:fs',
          'nested/runtime.ts: node:os',
          'nested/runtime.ts: ../../outside.js',
        ],
      })
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
