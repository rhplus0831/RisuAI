import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.dirname(fileURLToPath(import.meta.url))
const runtimeFiles = fs
  .readdirSync(sourceRoot)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort()

const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g
const allowedBareImports = new Set(['@sinclair/typebox', '@sinclair/typebox/value'])

describe('@risuai/protocol import boundary', () => {
  it('keeps every runtime module browser-safe and inside the protocol package', () => {
    const violations: string[] = []

    for (const file of runtimeFiles) {
      const absolutePath = path.join(sourceRoot, file)
      const source = fs.readFileSync(absolutePath, 'utf8')
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1]
        if (specifier.startsWith('.')) {
          const target = path.resolve(sourceRoot, specifier)
          if (!target.startsWith(`${sourceRoot}${path.sep}`)) violations.push(`${file}: ${specifier}`)
          continue
        }
        if (!allowedBareImports.has(specifier)) violations.push(`${file}: ${specifier}`)
      }
    }

    expect(runtimeFiles).toEqual(['generationSse.ts', 'index.ts', 'startupTelemetry.ts'])
    expect(violations).toEqual([])
  })
})
