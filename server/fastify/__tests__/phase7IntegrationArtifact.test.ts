import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { directLinkBatches, directLinkCases } from '../browser-smoke/phase7DirectLinks.js'
import {
  emptyPhase7RecoveryArtifact,
  mergePhase7ArtifactOutputs,
  resetPhase7ArtifactOutputs,
  writePhase7DirectLinkBatchPartial,
  writePhase7RecoveryPartial,
  type Phase7DirectLinkBatchArtifact,
} from '../browser-smoke/phase7IntegrationArtifact.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Phase 7 integration artifact merge', () => {
  it('merges route batches in manifest order and writes the combined JSON/TXT contract', () => {
    const outputDir = temporaryOutputDir()
    const definitions = directLinkCases()
    writePhase7RecoveryPartial(emptyPhase7RecoveryArtifact(), outputDir)
    for (const batch of directLinkBatches(definitions)) {
      writePhase7DirectLinkBatchPartial(completeBatchArtifact(batch, definitions.length), outputDir)
    }

    const merged = mergePhase7ArtifactOutputs({ outputDir, required: true })

    expect(merged?.directLinks.map((entry) => entry.path)).toEqual(definitions.map((entry) => entry.path))
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'phase7-integration.json'), 'utf8'))).toEqual(merged)
    expect(fs.readFileSync(path.join(outputDir, 'phase7-integration.txt'), 'utf8')).toContain(
      'Direct links\npath\trequested_route_key',
    )
  })

  it('rejects an incomplete required matrix while retaining diagnostic output', () => {
    const outputDir = temporaryOutputDir()
    const definitions = directLinkCases()
    writePhase7RecoveryPartial(emptyPhase7RecoveryArtifact(), outputDir)
    for (const batch of directLinkBatches(definitions).slice(0, -1)) {
      writePhase7DirectLinkBatchPartial(completeBatchArtifact(batch, definitions.length), outputDir)
    }

    expect(() => mergePhase7ArtifactOutputs({ outputDir, required: true })).toThrow('missing direct-link batch')
    expect(fs.existsSync(path.join(outputDir, 'phase7-integration.json'))).toBe(true)
  })

  it('clears only Phase 7 merge outputs before a Playwright run', () => {
    const outputDir = temporaryOutputDir()
    for (const name of [
      'phase7-integration.json',
      'phase7-integration.txt',
      'phase7-integration.recovery.partial.json',
      'phase7-integration.direct-links-1-of-4.partial.json',
      'startup-matrix.json',
    ]) {
      fs.writeFileSync(path.join(outputDir, name), '{}\n')
    }

    resetPhase7ArtifactOutputs(outputDir)

    expect(fs.readdirSync(outputDir)).toEqual(['startup-matrix.json'])
  })
})

function temporaryOutputDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-phase7-artifacts-'))
  temporaryDirectories.push(directory)
  return directory
}

function completeBatchArtifact(
  batch: ReturnType<typeof directLinkBatches>[number],
  totalCaseCount: number,
): Phase7DirectLinkBatchArtifact {
  return {
    schemaVersion: 1,
    batchIndex: batch.batchIndex,
    batchCount: batch.batchCount,
    totalCaseCount,
    complete: true,
    directLinks: batch.cases.map(({ caseIndex, definition }) => ({
      caseIndex,
      result: {
        path: definition.path,
        requestedRouteKey: `requested:${caseIndex}`,
        finalRouteKey: `final:${caseIndex}`,
        surfaces: [],
        requiredPaths: [],
        requestedPaths: [],
      },
    })),
  }
}
