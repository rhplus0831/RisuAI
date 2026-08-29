import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkCompatibilityBaseline, COMPAT_BASELINE_ROOT_ENV } from '../../util/compat-baseline'
import {
  DECISION_REGISTER_PATH,
  EXPECTED_DIFFERENCES_PATH,
  FIXTURE_PROVENANCE_PATH,
  GOLDEN_MANIFEST_PATH,
  INVENTORY_REGISTER_PATH,
  buildCompatDiff,
  buildGoldenManifest,
  parseHarnessCli,
  readJsonFile,
  refreshFixtureProvenanceDigests,
  validateCluster10Artifact,
  validateCompatDiffArtifact,
  validateCompatSideArtifact,
  validateExpectedDifferences,
  validateFixtureProvenance,
  validateGoldenManifest,
} from './governance'

const ROOT = resolve(import.meta.dirname, '../..')
const GOLDEN_DIR = resolve(import.meta.dirname, 'golden')
const ARTIFACT_DIR = resolve(ROOT, 'fast-bootstrap-results/compat-harness')

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

function formatReviewedFiles(): void {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'prettier',
      '--write',
      'test/compat-harness/golden/*.json',
      EXPECTED_DIFFERENCES_PATH,
      FIXTURE_PROVENANCE_PATH,
    ],
    { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Prettier exited with status ${result.status ?? 'unknown'}`)
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, pretty(value), 'utf8')
}

function compareOrUpdate(name: string, actual: unknown, update: boolean): boolean {
  const goldenPath = resolve(GOLDEN_DIR, name)
  if (update) {
    writeJson(goldenPath, actual)
    return true
  }
  if (!existsSync(goldenPath)) {
    throw new Error(`Missing golden ${goldenPath}; use --update-goldens --reason "<review reason>"`)
  }
  const expected = JSON.parse(readFileSync(goldenPath, 'utf8')) as unknown
  if (equal(expected, actual)) return true
  console.error(`Golden mismatch: ${goldenPath}\nActual artifact retained in: ${ARTIFACT_DIR}`)
  return false
}

function validateGovernance(diff: ReturnType<typeof buildCompatDiff>): void {
  validateExpectedDifferences(
    readJsonFile(resolve(ROOT, EXPECTED_DIFFERENCES_PATH)),
    diff,
    readJsonFile(resolve(ROOT, DECISION_REGISTER_PATH)),
    readJsonFile(resolve(ROOT, INVENTORY_REGISTER_PATH)),
  )
}

function readValidatedGoldenDiff(): ReturnType<typeof buildCompatDiff> {
  const baseline = validateCompatSideArtifact(readJsonFile(resolve(GOLDEN_DIR, 'baseline.json')), 'baseline')
  const current = validateCompatSideArtifact(readJsonFile(resolve(GOLDEN_DIR, 'current.json')), 'current')
  const computed = buildCompatDiff(baseline, current)
  validateCompatDiffArtifact(readJsonFile(resolve(GOLDEN_DIR, 'diff.json')), computed)
  validateCluster10Artifact(readJsonFile(resolve(GOLDEN_DIR, 'cluster10.json')))
  return computed
}

const options = parseHarnessCli(process.argv.slice(2))
const update = options.updateReason !== undefined
mkdirSync(ARTIFACT_DIR, { recursive: true })

const provenancePath = resolve(ROOT, FIXTURE_PROVENANCE_PATH)
if (update) refreshFixtureProvenanceDigests(ROOT, provenancePath)
validateFixtureProvenance(readJsonFile(provenancePath), ROOT)
if (!update) {
  validateGoldenManifest(readJsonFile(resolve(ROOT, GOLDEN_MANIFEST_PATH)), ROOT)
  const goldenDiff = readValidatedGoldenDiff()
  if (options.currentOnly) validateGovernance(goldenDiff)
}

let baselineRoot: string | undefined
if (!options.currentOnly) baselineRoot = checkCompatibilityBaseline().baselineRoot

const baselinePath = resolve(ARTIFACT_DIR, 'actual-baseline.json')
const currentPath = resolve(ARTIFACT_DIR, 'actual-current.json')
const diffPath = resolve(ARTIFACT_DIR, 'actual-diff.json')
const cluster10Path = resolve(ARTIFACT_DIR, 'actual-cluster10.json')

if (!options.currentOnly) {
  runVitest(['exec', 'vitest', 'run', '--config', 'test/compat-harness/baseline.vitest.config.ts', '--reporter=dot'], {
    COMPAT_HARNESS_BASELINE_OUTPUT: baselinePath,
    [COMPAT_BASELINE_ROOT_ENV]: baselineRoot,
  })
}
runVitest(['exec', 'vitest', 'run', '--config', 'test/compat-harness/current.vitest.config.ts', '--reporter=dot'], {
  COMPAT_HARNESS_CURRENT_OUTPUT: currentPath,
  COMPAT_HARNESS_CLUSTER10_OUTPUT: cluster10Path,
})

const current = validateCompatSideArtifact(readJsonFile(currentPath), 'current')
const cluster10 = validateCluster10Artifact(readJsonFile(cluster10Path))
if (options.currentOnly) {
  const results = [compareOrUpdate('current.json', current, false), compareOrUpdate('cluster10.json', cluster10, false)]
  if (results.some((result) => !result)) {
    throw new Error('Current compatibility golden mismatch. Inspect the retained actual artifacts.')
  }
  console.log(
    `Current compatibility harness matched: ${current.cells.length} cells; cluster 10 regressions healthy=${cluster10.replayCapCanonicalTerminal.healthy && cluster10.retriedExtendContinueDuplicate.healthy}. Actual artifacts: ${ARTIFACT_DIR}`,
  )
} else {
  const baseline = validateCompatSideArtifact(readJsonFile(baselinePath), 'baseline')
  const diff = buildCompatDiff(baseline, current)
  writeJson(diffPath, diff)
  validateGovernance(diff)
  const results = [
    compareOrUpdate('baseline.json', baseline, update),
    compareOrUpdate('current.json', current, update),
    compareOrUpdate('diff.json', diff, update),
    compareOrUpdate('cluster10.json', cluster10, update),
  ]
  if (results.some((result) => !result)) {
    throw new Error('Compatibility golden mismatch. Inspect the retained actual artifacts.')
  }
  if (options.updateReason) {
    formatReviewedFiles()
    writeJson(resolve(ROOT, GOLDEN_MANIFEST_PATH), buildGoldenManifest(ROOT, options.updateReason))
  }
  console.log(
    `Compatibility harness ${update ? 'updated after explicit review' : 'matched'}: ${diff.summary.totalCells} cells, ${diff.summary.divergentCells} baseline/current divergences; cluster 10 regressions healthy=${cluster10.replayCapCanonicalTerminal.healthy && cluster10.retriedExtendContinueDuplicate.healthy}. Actual artifacts: ${ARTIFACT_DIR}`,
  )
}
