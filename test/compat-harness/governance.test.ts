import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DECISION_REGISTER_PATH,
  EXPECTED_DIFFERENCES_PATH,
  FIXTURE_PROVENANCE_PATH,
  INVENTORY_REGISTER_PATH,
  buildCompatDiff,
  buildGoldenManifest,
  parseHarnessCli,
  readJsonFile,
  semanticDifferenceDigest,
  validateCompatSideArtifact,
  validateExpectedDifferences,
  validateFixtureProvenance,
  validateGoldenManifest,
  type CompatDivergenceAspect,
  type ExpectedDifferenceRegister,
} from './governance'
import type { CompatCellDiff, CompatDiffArtifact } from './types'

const ROOT = path.resolve(import.meta.dirname, '../..')

function clone<T>(value: T): T {
  return structuredClone(value)
}

function golden(name: string): unknown {
  return readJsonFile(path.resolve(import.meta.dirname, 'golden', name))
}

function payload(cell: CompatCellDiff, aspect: CompatDivergenceAspect): [unknown, unknown] {
  if (aspect === 'execution') return [cell.baseline.execution, cell.current.execution]
  if (aspect === 'transcript') return [cell.baseline.persistedTranscript, cell.current.persistedTranscript]
  return [cell.baseline.providerRequests, cell.current.providerRequests]
}

function matchingExpectedDifferences(diff: CompatDiffArtifact): ExpectedDifferenceRegister {
  const register = clone(readJsonFile(path.resolve(ROOT, EXPECTED_DIFFERENCES_PATH)) as ExpectedDifferenceRegister)
  for (const mapping of register.mappings) {
    const cell = diff.cells.find((candidate) => candidate.id === mapping.cellId)!
    const [baseline, current] = payload(cell, mapping.aspect)
    mapping.differenceDigest = semanticDifferenceDigest(baseline, current)
  }
  return register
}

describe('compatibility harness governance', () => {
  it.each(['duplicate', 'extra', 'missing', 'reordered'] as const)('rejects a %s case set', (mutation) => {
    const artifact = clone(golden('baseline.json') as { cells: unknown[] })
    if (mutation === 'duplicate') artifact.cells[1] = clone(artifact.cells[0])
    if (mutation === 'extra') artifact.cells.push(clone(artifact.cells[0]))
    if (mutation === 'missing') artifact.cells.pop()
    if (mutation === 'reordered') [artifact.cells[0], artifact.cells[1]] = [artifact.cells[1], artifact.cells[0]]
    expect(() => validateCompatSideArtifact(artifact, 'baseline')).toThrow()
  })

  it('requires exact signed authority, inventory backlinks, and semantic delta digests', () => {
    const baseline = validateCompatSideArtifact(golden('baseline.json'), 'baseline')
    const current = validateCompatSideArtifact(golden('current.json'), 'current')
    const diff = buildCompatDiff(baseline, current)
    const register = matchingExpectedDifferences(diff)
    const decisions = readJsonFile(path.resolve(ROOT, DECISION_REGISTER_PATH))
    const inventory = readJsonFile(path.resolve(ROOT, INVENTORY_REGISTER_PATH))
    expect(() => validateExpectedDifferences(register, diff, decisions, inventory)).not.toThrow()

    const digestDrift = clone(register)
    digestDrift.mappings[0].differenceDigest = '0'.repeat(64)
    expect(() => validateExpectedDifferences(digestDrift, diff, decisions, inventory)).toThrow(/semantic delta changed/)

    const missingDecision = clone(register)
    missingDecision.mappings[0].decisionIds = ['ORC-DECISION-999']
    expect(() => validateExpectedDifferences(missingDecision, diff, decisions, inventory)).toThrow(/missing decision/)

    const unsignedDecisions = clone(decisions as { decisions: Array<{ id: string; state: string }> })
    unsignedDecisions.decisions.find((decision) => decision.id === register.mappings[0].decisionIds[0])!.state =
      'pending'
    expect(() => validateExpectedDifferences(register, diff, unsignedDecisions, inventory)).toThrow(/unsigned decision/)

    const brokenInventory = clone(
      inventory as { rows: Array<{ id: string; verification: { decisionId: string | null } }> },
    )
    brokenInventory.rows.find((row) => row.id === register.mappings[0].inventoryIds[0])!.verification.decisionId = null
    expect(() => validateExpectedDifferences(register, diff, decisions, brokenInventory)).toThrow(/does not backlink/)
  })

  it('rejects fixture-provenance and golden-manifest digest drift', () => {
    const provenance = readJsonFile(path.resolve(ROOT, FIXTURE_PROVENANCE_PATH))
    validateFixtureProvenance(provenance, ROOT)
    const brokenProvenance = clone(provenance as { sourceFiles: Array<{ sha256: string }> })
    brokenProvenance.sourceFiles[0].sha256 = '0'.repeat(64)
    expect(() => validateFixtureProvenance(brokenProvenance, ROOT)).toThrow(/digest mismatch/)

    const manifest = buildGoldenManifest(ROOT, 'Governance test manifest review')
    expect(() => validateGoldenManifest(manifest, ROOT)).not.toThrow()
    const brokenManifest = clone(manifest)
    brokenManifest.files[0].sha256 = '0'.repeat(64)
    expect(() => validateGoldenManifest(brokenManifest, ROOT)).toThrow(/digest mismatch/)
  })

  it('requires an explicit full-lane update reason and rejects the legacy environment switch', () => {
    expect(() => parseHarnessCli(['--update-goldens'], {})).toThrow(/requires --reason/)
    expect(() => parseHarnessCli(['--update-goldens', '--reason', 'short'], {})).toThrow(/at least 12/)
    expect(() =>
      parseHarnessCli(['--current-only', '--update-goldens', '--reason', 'Reviewed compatibility change'], {}),
    ).toThrow(/full pinned differential/)
    expect(() => parseHarnessCli([], { UPDATE_COMPAT_HARNESS: '1' })).toThrow(/no longer supported/)
    expect(parseHarnessCli(['--update-goldens', '--reason', 'Reviewed compatibility change'], {})).toEqual({
      currentOnly: false,
      updateReason: 'Reviewed compatibility change',
    })
  })
})
