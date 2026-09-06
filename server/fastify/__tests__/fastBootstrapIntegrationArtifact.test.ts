import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { directLinkBatches, directLinkCases } from '../browser-smoke/fastBootstrapDirectLinks.js'
import {
  emptyFastBootstrapRecoveryArtifact,
  mergeFastBootstrapArtifactOutputs,
  resetFastBootstrapArtifactOutputs,
  writeFastBootstrapDirectLinkBatchPartial,
  writeFastBootstrapRecoveryPartial,
  type FastBootstrapDirectLinkBatchArtifact,
} from '../browser-smoke/fastBootstrapIntegrationArtifact.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Fast-bootstrap integration artifact merge', () => {
  it('merges route batches in manifest order and writes the combined JSON/TXT contract', () => {
    const outputDir = temporaryOutputDir()
    const definitions = directLinkCases()
    writeFastBootstrapRecoveryPartial(emptyFastBootstrapRecoveryArtifact(), outputDir)
    for (const batch of directLinkBatches(definitions)) {
      writeFastBootstrapDirectLinkBatchPartial(completeBatchArtifact(batch, definitions.length), outputDir)
    }

    const merged = mergeFastBootstrapArtifactOutputs({ outputDir, required: true })

    expect(merged?.directLinks.map((entry) => entry.path)).toEqual(definitions.map((entry) => entry.path))
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'fast-bootstrap-integration.json'), 'utf8'))).toEqual(merged)
    expect(fs.readFileSync(path.join(outputDir, 'fast-bootstrap-integration.txt'), 'utf8')).toContain(
      'Direct links\npath\trequested_route_key',
    )
  })

  it('rejects an incomplete required matrix while retaining diagnostic output', () => {
    const outputDir = temporaryOutputDir()
    const definitions = directLinkCases()
    writeFastBootstrapRecoveryPartial(emptyFastBootstrapRecoveryArtifact(), outputDir)
    for (const batch of directLinkBatches(definitions).slice(0, -1)) {
      writeFastBootstrapDirectLinkBatchPartial(completeBatchArtifact(batch, definitions.length), outputDir)
    }

    expect(() => mergeFastBootstrapArtifactOutputs({ outputDir, required: true })).toThrow('missing direct-link batch')
    expect(fs.existsSync(path.join(outputDir, 'fast-bootstrap-integration.json'))).toBe(true)
  })

  it('clears only Fast-bootstrap merge outputs before a Playwright run', () => {
    const outputDir = temporaryOutputDir()
    for (const name of [
      'fast-bootstrap-integration.json',
      'fast-bootstrap-integration.txt',
      'fast-bootstrap-integration.recovery.partial.json',
      'fast-bootstrap-integration.direct-links-1-of-4.partial.json',
      'startup-matrix.json',
    ]) {
      fs.writeFileSync(path.join(outputDir, name), '{}\n')
    }

    resetFastBootstrapArtifactOutputs(outputDir)

    expect(fs.readdirSync(outputDir)).toEqual(['startup-matrix.json'])
  })
})

function temporaryOutputDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-fast-bootstrap-artifacts-'))
  temporaryDirectories.push(directory)
  return directory
}

function completeBatchArtifact(
  batch: ReturnType<typeof directLinkBatches>[number],
  totalCaseCount: number,
): FastBootstrapDirectLinkBatchArtifact {
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
