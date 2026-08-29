import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { checkCompatibilityBaseline } from '../../util/compat-baseline'
import type {
  Cluster10Artifact,
  CompatCellArtifact,
  CompatCellDiff,
  CompatDiffArtifact,
  CompatSideArtifact,
} from './types'

const ROOT = resolve(import.meta.dirname, '../..')
const GOLDEN_DIR = resolve(import.meta.dirname, 'golden')
const DIAGNOSTIC_DIR = resolve(ROOT, 'fast-bootstrap-results/compat-harness')
const UPDATE = process.env.UPDATE_COMPAT_HARNESS === '1'
const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--current-only')) {
  throw new Error(`Unknown compatibility harness option: ${args.find((arg) => arg !== '--current-only')}`)
}
const CURRENT_ONLY = args.includes('--current-only')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function runVitest(args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync('pnpm', args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Vitest runner exited with status ${result.status ?? 'unknown'}`)
}

function cellPayload(cell: CompatCellArtifact): CompatCellDiff['baseline'] {
  return {
    execution: cell.execution,
    persistedTranscript: cell.persistedTranscript,
    providerRequests: cell.providerRequests,
  }
}

function buildDiff(baseline: CompatSideArtifact, current: CompatSideArtifact): CompatDiffArtifact {
  const currentById = new Map(current.cells.map((cell) => [cell.id, cell]))
  const cells = baseline.cells.map((baselineCell): CompatCellDiff => {
    const currentCell = currentById.get(baselineCell.id)
    if (!currentCell) throw new Error(`Current artifact is missing matrix cell ${baselineCell.id}`)
    const executionDivergent = !equal(baselineCell.execution, currentCell.execution)
    const transcriptDivergent = !equal(baselineCell.persistedTranscript, currentCell.persistedTranscript)
    const requestDivergent = !equal(baselineCell.providerRequests, currentCell.providerRequests)
    return {
      id: baselineCell.id,
      scenario: baselineCell.scenario,
      transport: baselineCell.transport,
      useSayNothing: baselineCell.useSayNothing,
      divergent: executionDivergent || transcriptDivergent || requestDivergent,
      transcriptDivergent,
      requestDivergent,
      executionDivergent,
      baseline: cellPayload(baselineCell),
      current: cellPayload(currentCell),
    }
  })
  if (cells.length !== current.cells.length) throw new Error('Baseline and current matrix cell counts differ')
  return {
    schemaVersion: 1,
    baselineCommit: baseline.baselineCommit,
    summary: {
      totalCells: cells.length,
      divergentCells: cells.filter((cell) => cell.divergent).length,
      transcriptDivergences: cells.filter((cell) => cell.transcriptDivergent).length,
      requestDivergences: cells.filter((cell) => cell.requestDivergent).length,
      executionDivergences: cells.filter((cell) => cell.executionDivergent).length,
    },
    cells,
  }
}

function compareOrUpdate(name: string, actual: unknown): boolean {
  const path = resolve(GOLDEN_DIR, name)
  if (UPDATE) {
    writeFileSync(path, pretty(actual), 'utf8')
    return true
  }
  if (!existsSync(path)) throw new Error(`Missing golden ${path}; run with UPDATE_COMPAT_HARNESS=1`)
  const expected = readJson<unknown>(path)
  if (equal(expected, actual)) return true
  mkdirSync(DIAGNOSTIC_DIR, { recursive: true })
  const actualPath = resolve(DIAGNOSTIC_DIR, `actual-${name}`)
  writeFileSync(actualPath, pretty(actual), 'utf8')
  console.error(`Golden mismatch: ${path}\nActual artifact: ${actualPath}`)
  return false
}

if (!CURRENT_ONLY) checkCompatibilityBaseline()
const scratch = mkdtempSync(resolve(tmpdir(), 'risu-compat-harness-'))
try {
  const baselinePath = resolve(scratch, 'baseline.json')
  const currentPath = resolve(scratch, 'current.json')
  const cluster10Path = resolve(scratch, 'cluster10.json')
  if (!CURRENT_ONLY) {
    runVitest(
      ['exec', 'vitest', 'run', '--config', 'test/compat-harness/baseline.vitest.config.ts', '--reporter=dot'],
      { COMPAT_HARNESS_BASELINE_OUTPUT: baselinePath },
    )
  }
  runVitest(['exec', 'vitest', 'run', '--config', 'test/compat-harness/current.vitest.config.ts', '--reporter=dot'], {
    COMPAT_HARNESS_CURRENT_OUTPUT: currentPath,
    COMPAT_HARNESS_CLUSTER10_OUTPUT: cluster10Path,
  })

  const current = readJson<CompatSideArtifact>(currentPath)
  const cluster10 = readJson<Cluster10Artifact>(cluster10Path)
  if (CURRENT_ONLY) {
    const results = [compareOrUpdate('current.json', current), compareOrUpdate('cluster10.json', cluster10)]
    if (results.some((result) => !result)) {
      throw new Error(
        'Current compatibility golden mismatch. Inspect fast-bootstrap-results/compat-harness or update intentionally with UPDATE_COMPAT_HARNESS=1.',
      )
    }
    console.log(
      `Current compatibility harness ${UPDATE ? 'updated' : 'matched'}: ${current.cells.length} cells; cluster 10 regressions healthy=${cluster10.replayCapCanonicalTerminal.healthy && cluster10.retriedExtendContinueDuplicate.healthy}.`,
    )
  } else {
    const baseline = readJson<CompatSideArtifact>(baselinePath)
    const diff = buildDiff(baseline, current)
    const results = [
      compareOrUpdate('baseline.json', baseline),
      compareOrUpdate('current.json', current),
      compareOrUpdate('diff.json', diff),
      compareOrUpdate('cluster10.json', cluster10),
    ]
    if (results.some((result) => !result)) {
      throw new Error(
        'Compatibility golden mismatch. Inspect fast-bootstrap-results/compat-harness or update intentionally with UPDATE_COMPAT_HARNESS=1.',
      )
    }
    console.log(
      `Compatibility harness ${UPDATE ? 'updated' : 'matched'}: ${diff.summary.totalCells} cells, ${diff.summary.divergentCells} baseline/current divergences; cluster 10 regressions healthy=${cluster10.replayCapCanonicalTerminal.healthy && cluster10.retriedExtendContinueDuplicate.healthy}.`,
    )
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
