import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function allSeperateParametersSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/lib/Others/AllSeperateParameters.svelte'), 'utf8')
}

function claudeThinkingSeparateParamsSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte'), 'utf8')
}

function extractFunctionBody(source: string, functionSignature: string): string {
  const functionStart = source.indexOf(functionSignature)
  expect(functionStart).toBeGreaterThanOrEqual(0)

  const bodyStart = source.indexOf('{', functionStart)
  expect(bodyStart).toBeGreaterThanOrEqual(0)

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]

    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(bodyStart + 1, index)
      }
    }
  }

  throw new Error(`Could not find the end of ${functionSignature}`)
}

describe('AllSeperateParameters import wiring', () => {
  it('uses the file-selected hook when importing separate parameters JSON', () => {
    const source = allSeperateParametersSource()

    expect(source).toContain("from 'src/ts/server/seperateParametersImport'")
    expect(source).toContain('async function importParametersJson(): Promise<void>')
    expect(source).toContain("selectSingleFile(['json'], { onFileSelected: beginImport })")
    expect(source).toContain('onclick={importParametersJson}')
  })

  it('routes guarded imports through callbacks instead of directly assigning bound value', () => {
    const source = allSeperateParametersSource()
    const importBody = extractFunctionBody(source, 'async function importParametersJson(): Promise<void>')

    const targetIndex = importBody.indexOf('const target = guardedImport?.captureTarget() ?? null')
    const selectIndex = importBody.indexOf(
      "const file = await selectSingleFile(['json'], { onFileSelected: beginImport })",
    )
    const parseIndex = importBody.indexOf('const imported = parseSeperateParametersImport')
    const guardedIndex = importBody.indexOf('if (guardedImport) {', parseIndex)
    const applyIndex = importBody.indexOf('guardedImport.applyImport(operation, imported)')
    const fallbackIndex = importBody.indexOf('value = imported')

    expect(targetIndex).toBeGreaterThanOrEqual(0)
    expect(selectIndex).toBeGreaterThan(targetIndex)
    expect(parseIndex).toBeGreaterThan(selectIndex)
    expect(guardedIndex).toBeGreaterThan(parseIndex)
    expect(applyIndex).toBeGreaterThan(guardedIndex)
    expect(fallbackIndex).toBeGreaterThan(applyIndex)
    expect(importBody).not.toContain('JSON.parse')
  })
})

describe('separate parameter model resolution', () => {
  it('uses chatAux role resolution when AllSeperateParameters has no explicit parameter key', () => {
    const source = allSeperateParametersSource()

    expect(source).toContain("if (!paramKey) return resolveModelForRole(DBState.db, 'chatAux')")
    expect(source).not.toContain('if (!paramKey) return DBState.db.subModel')
  })

  it('uses chatAux role resolution when Claude thinking parameters have no explicit parameter key', () => {
    const source = claudeThinkingSeparateParamsSource()

    expect(source).toContain("if (!paramKey) return resolveModelForRole(DBState.db, 'chatAux')")
    expect(source).not.toContain('if (!paramKey) return DBState.db.subModel')
  })
})
