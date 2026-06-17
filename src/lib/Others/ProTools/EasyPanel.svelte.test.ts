import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function easyPanelSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/lib/Others/ProTools/EasyPanel.svelte'), 'utf8')
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

describe('EasyPanel separate parameters import wiring', () => {
  it('wires guarded imports for override and base import/export branches', () => {
    const source = easyPanelSource()

    expect(source).toContain("from 'src/ts/server/seperateParametersImport'")
    expect(source).toContain('guardedImport={createOverrideSeperateParametersImportGuards(parameterModelSelection)}')
    expect(source).toContain("guardedImport={createBaseSeperateParametersImportGuards('memory')}")
    expect(source).toContain("guardedImport={createBaseSeperateParametersImportGuards('translate')}")
    expect(source).toContain("guardedImport={createBaseSeperateParametersImportGuards('emotion')}")
    expect(source).toContain("guardedImport={createBaseSeperateParametersImportGuards('otherAx')}")
  })

  it('captures only the active target slot as freshness state', () => {
    const source = easyPanelSource()
    const freshnessBody = extractFunctionBody(source, 'function currentSeperateParametersImportFreshness(')

    expect(freshnessBody).toContain('selectedOptionIsParameters: selectedOption ===')
    expect(freshnessBody).toContain('byModel')
    expect(freshnessBody).toContain('activeSelector: byModel ? parameterModelSelection : selectedParameterOption')
    expect(freshnessBody).toContain('targetSlot: getSeperateParametersImportTargetSlot(slotKind, targetKey)')
    expect(freshnessBody).not.toContain('targetSlot: seperateParametersDraft.value')
    expect(freshnessBody).not.toContain('JSON.stringify(seperateParametersDraft.value')
  })

  it('applies fresh imports by replacing only the active base or override slot', () => {
    const source = easyPanelSource()
    const applyBody = extractFunctionBody(source, 'function applySeperateParametersImport(')

    const resolveIndex = applyBody.indexOf('const freshValue = resolveFreshSeperateParametersImportValue({')
    const baseBranchIndex = applyBody.indexOf("if (operation.slotKind === 'base') {")
    const baseAssignIndex = applyBody.indexOf(
      'seperateParametersDraft.value = { ...seperateParametersDraft.value, [baseKey]: freshValue }',
    )
    const overridesCloneIndex = applyBody.indexOf(
      'const overrides = { ...(seperateParametersDraft.value.overrides ?? {}) }',
    )
    const overrideAssignIndex = applyBody.indexOf('overrides[operation.targetKey] = freshValue')
    const draftAssignIndex = applyBody.indexOf(
      'seperateParametersDraft.value = { ...seperateParametersDraft.value, overrides }',
    )

    expect(resolveIndex).toBeGreaterThanOrEqual(0)
    expect(baseBranchIndex).toBeGreaterThan(resolveIndex)
    expect(baseAssignIndex).toBeGreaterThan(baseBranchIndex)
    expect(overridesCloneIndex).toBeGreaterThan(baseAssignIndex)
    expect(overrideAssignIndex).toBeGreaterThan(overridesCloneIndex)
    expect(draftAssignIndex).toBeGreaterThan(overrideAssignIndex)
    expect(applyBody).not.toContain('seperateParametersDraft.value = freshValue')
  })
})
