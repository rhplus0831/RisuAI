import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { COMPAT_BASELINE_COMMIT } from '../../util/compat-baseline'
import {
  compatCells,
  type CapturedProviderRequest,
  type Cluster10Artifact,
  type CompatCellArtifact,
  type CompatCellDiff,
  type CompatDiffArtifact,
  type CompatSideArtifact,
} from './types'

export const EXPECTED_DIFFERENCES_PATH = 'test/compat-harness/expected-differences.json'
export const FIXTURE_PROVENANCE_PATH = 'test/compat-harness/fixture-provenance.json'
export const GOLDEN_MANIFEST_PATH = 'test/compat-harness/golden/manifest.json'
export const DECISION_REGISTER_PATH = 'docs/plan/original-risu-behavioral-compatibility/findings/decisions.json'
export const INVENTORY_REGISTER_PATH =
  'docs/plan/original-risu-behavioral-compatibility/inventory/compatibility-surfaces.json'

const GOLDEN_ARTIFACT_PATHS = [
  'test/compat-harness/golden/baseline.json',
  'test/compat-harness/golden/current.json',
  'test/compat-harness/golden/diff.json',
  'test/compat-harness/golden/cluster10.json',
] as const

const MANIFEST_DIGEST_PATHS = [...GOLDEN_ARTIFACT_PATHS, EXPECTED_DIFFERENCES_PATH, FIXTURE_PROVENANCE_PATH] as const

type JsonRecord = Record<string, unknown>
export type CompatDivergenceAspect = 'execution' | 'transcript' | 'request'

export interface ExpectedDifferenceMapping {
  cellId: string
  aspect: CompatDivergenceAspect
  differenceDigest: string
  decisionIds: string[]
  inventoryIds: string[]
  rationale: string
}

export interface ExpectedDifferenceRegister {
  schemaVersion: 1
  baselineCommit: string
  decisionRegister: string
  inventoryRegister: string
  mappings: ExpectedDifferenceMapping[]
}

interface FixtureSource {
  path: string
  sha256: string
}

export interface FixtureProvenanceRegister {
  schemaVersion: 1
  fixtureId: string
  baselineCommit: string
  deterministicClock: string
  providerEndpoint: string
  caseIds: string[]
  sourceFiles: FixtureSource[]
  normalizationContract: string[]
}

interface GoldenManifest {
  schemaVersion: 1
  baselineCommit: string
  updateReason: string
  updateCommand: string
  files: FixtureSource[]
}

export interface HarnessCliOptions {
  currentOnly: boolean
  updateReason?: string
}

export function parseHarnessCli(args: string[], env: NodeJS.ProcessEnv = process.env): HarnessCliOptions {
  let currentOnly = false
  let updateGoldens = false
  let updateReason: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    if (arg === '--current-only') {
      currentOnly = true
      continue
    }
    if (arg === '--update-goldens') {
      updateGoldens = true
      continue
    }
    if (arg === '--reason') {
      updateReason = args[index + 1]
      index += 1
      continue
    }
    if (arg.startsWith('--reason=')) {
      updateReason = arg.slice('--reason='.length)
      continue
    }
    throw new Error(`Unknown compatibility harness option: ${arg}`)
  }
  if (env.UPDATE_COMPAT_HARNESS === '1') {
    throw new Error('UPDATE_COMPAT_HARNESS is no longer supported. Use --update-goldens --reason "<review reason>".')
  }
  if (updateGoldens && currentOnly) throw new Error('Golden updates require the full pinned differential')
  if (updateGoldens && (!updateReason || updateReason.trim().length < 12)) {
    throw new Error('--update-goldens requires --reason with at least 12 non-whitespace characters')
  }
  if (!updateGoldens && updateReason !== undefined) throw new Error('--reason requires --update-goldens')
  return { currentOnly, ...(updateReason ? { updateReason: updateReason.trim() } : {}) }
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as JsonRecord
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function nonEmptyString(value: unknown, label: string): string {
  const result = string(value, label)
  if (result.length === 0) throw new Error(`${label} must be non-empty`)
  return result
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function exactKeys(value: JsonRecord, required: string[], optional: string[], label: string): void {
  const allowed = new Set([...required, ...optional])
  for (const key of required) {
    if (!(key in value)) throw new Error(`${label} is missing ${key}`)
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} has unknown field ${key}`)
  }
}

function uniqueStrings(value: unknown, label: string, allowEmpty = false): string[] {
  const values = array(value, label).map((item, index) => nonEmptyString(item, `${label}[${index}]`))
  if (!allowEmpty && values.length === 0) throw new Error(`${label} must not be empty`)
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`)
  return values
}

function assertJsonValue(value: unknown, label: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${label}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${label}.${key}`)
    return
  }
  throw new Error(`${label} is not JSON-compatible`)
}

function validateProviderRequest(value: unknown, label: string): CapturedProviderRequest {
  const request = record(value, label)
  exactKeys(request, ['url', 'method', 'headers', 'body'], [], label)
  nonEmptyString(request.url, `${label}.url`)
  nonEmptyString(request.method, `${label}.method`)
  const headers = record(request.headers, `${label}.headers`)
  for (const [key, headerValue] of Object.entries(headers)) string(headerValue, `${label}.headers.${key}`)
  record(request.body, `${label}.body`)
  assertJsonValue(request.body, `${label}.body`)
  return request as unknown as CapturedProviderRequest
}

function validateCell(value: unknown, expectedIndex: number, label: string): CompatCellArtifact {
  const cell = record(value, label)
  exactKeys(
    cell,
    ['id', 'scenario', 'transport', 'useSayNothing', 'execution', 'persistedTranscript', 'providerRequests'],
    [],
    label,
  )
  const expected = compatCells()[expectedIndex]
  if (!expected) throw new Error(`${label} is an unexpected extra case`)
  for (const key of ['id', 'scenario', 'transport', 'useSayNothing'] as const) {
    if (cell[key] !== expected[key]) {
      throw new Error(`${label}.${key} is ${String(cell[key])}; expected ${String(expected[key])}`)
    }
  }
  const execution = record(cell.execution, `${label}.execution`)
  exactKeys(execution, ['completed', 'providerCallCount'], ['error'], `${label}.execution`)
  boolean(execution.completed, `${label}.execution.completed`)
  if (!Number.isInteger(execution.providerCallCount) || (execution.providerCallCount as number) < 0) {
    throw new Error(`${label}.execution.providerCallCount must be a non-negative integer`)
  }
  if ('error' in execution) string(execution.error, `${label}.execution.error`)
  array(cell.persistedTranscript, `${label}.persistedTranscript`).forEach((item, index) => {
    const message = record(item, `${label}.persistedTranscript[${index}]`)
    nonEmptyString(message.role, `${label}.persistedTranscript[${index}].role`)
    string(message.data, `${label}.persistedTranscript[${index}].data`)
    assertJsonValue(message, `${label}.persistedTranscript[${index}]`)
  })
  array(cell.providerRequests, `${label}.providerRequests`).forEach((item, index) =>
    validateProviderRequest(item, `${label}.providerRequests[${index}]`),
  )
  return cell as unknown as CompatCellArtifact
}

export function validateCompatSideArtifact(value: unknown, expectedSide: 'baseline' | 'current'): CompatSideArtifact {
  const artifact = record(value, `${expectedSide} artifact`)
  exactKeys(artifact, ['schemaVersion', 'side', 'baselineCommit', 'boundary', 'cells'], [], `${expectedSide} artifact`)
  if (artifact.schemaVersion !== 1) throw new Error(`${expectedSide} artifact schemaVersion must be 1`)
  if (artifact.side !== expectedSide) throw new Error(`${expectedSide} artifact has side ${String(artifact.side)}`)
  if (artifact.baselineCommit !== COMPAT_BASELINE_COMMIT) {
    throw new Error(`${expectedSide} artifact baselineCommit must be ${COMPAT_BASELINE_COMMIT}`)
  }
  nonEmptyString(artifact.boundary, `${expectedSide} artifact.boundary`)
  const cells = array(artifact.cells, `${expectedSide} artifact.cells`)
  const expectedCells = compatCells()
  if (cells.length !== expectedCells.length) {
    throw new Error(
      `${expectedSide} artifact must contain exactly ${expectedCells.length} cases; found ${cells.length}`,
    )
  }
  const ids = cells.map((cell, index) => string(record(cell, `cell ${index}`).id, `cell ${index}.id`))
  if (new Set(ids).size !== ids.length) throw new Error(`${expectedSide} artifact contains duplicate case IDs`)
  cells.forEach((cell, index) => validateCell(cell, index, `${expectedSide} artifact.cells[${index}]`))
  return artifact as unknown as CompatSideArtifact
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const MISSING = { $missing: true } as const

interface SemanticDifference {
  path: string
  baseline: unknown
  current: unknown
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value as JsonRecord)
      .sort()
      .map((key) => [key, canonicalValue((value as JsonRecord)[key])]),
  )
}

function semanticDifferences(
  baseline: unknown,
  current: unknown,
  currentPath = '$',
  baselinePresent = true,
  currentPresent = true,
): SemanticDifference[] {
  if (!baselinePresent || !currentPresent) {
    return [
      {
        path: currentPath,
        baseline: baselinePresent ? canonicalValue(baseline) : MISSING,
        current: currentPresent ? canonicalValue(current) : MISSING,
      },
    ]
  }
  if (equal(canonicalValue(baseline), canonicalValue(current))) return []
  if (Array.isArray(baseline) && Array.isArray(current)) {
    const differences: SemanticDifference[] = []
    const length = Math.max(baseline.length, current.length)
    for (let index = 0; index < length; index += 1) {
      differences.push(
        ...semanticDifferences(
          baseline[index],
          current[index],
          `${currentPath}[${index}]`,
          index < baseline.length,
          index < current.length,
        ),
      )
    }
    return differences
  }
  if (
    baseline &&
    current &&
    typeof baseline === 'object' &&
    typeof current === 'object' &&
    !Array.isArray(baseline) &&
    !Array.isArray(current)
  ) {
    const baselineRecord = record(baseline, currentPath)
    const currentRecord = record(current, currentPath)
    const keys = [...new Set([...Object.keys(baselineRecord), ...Object.keys(currentRecord)])].sort()
    return keys.flatMap((key) =>
      semanticDifferences(
        baselineRecord[key],
        currentRecord[key],
        `${currentPath}.${key}`,
        key in baselineRecord,
        key in currentRecord,
      ),
    )
  }
  return [{ path: currentPath, baseline: canonicalValue(baseline), current: canonicalValue(current) }]
}

export function semanticDifferenceDigest(baseline: unknown, current: unknown): string {
  const differences = semanticDifferences(baseline, current)
  return createHash('sha256').update(JSON.stringify(differences)).digest('hex')
}

function cellPayload(cell: CompatCellArtifact): CompatCellDiff['baseline'] {
  return {
    execution: cell.execution,
    persistedTranscript: cell.persistedTranscript,
    providerRequests: cell.providerRequests,
  }
}

export function buildCompatDiff(baseline: CompatSideArtifact, current: CompatSideArtifact): CompatDiffArtifact {
  const cells = baseline.cells.map((baselineCell, index): CompatCellDiff => {
    const currentCell = current.cells[index]
    if (!currentCell || currentCell.id !== baselineCell.id) {
      throw new Error(`Current artifact is missing ordered matrix cell ${baselineCell.id}`)
    }
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

export function validateCompatDiffArtifact(value: unknown, expected: CompatDiffArtifact): CompatDiffArtifact {
  const artifact = record(value, 'diff artifact')
  exactKeys(artifact, ['schemaVersion', 'baselineCommit', 'summary', 'cells'], [], 'diff artifact')
  if (!equal(value, expected)) throw new Error('Diff artifact does not exactly match the validated side artifacts')
  return artifact as unknown as CompatDiffArtifact
}

export function validateCluster10Artifact(value: unknown): Cluster10Artifact {
  const artifact = record(value, 'cluster10 artifact')
  exactKeys(
    artifact,
    ['schemaVersion', 'replayCapCanonicalTerminal', 'retriedExtendContinueDuplicate'],
    [],
    'cluster10 artifact',
  )
  if (artifact.schemaVersion !== 1) throw new Error('cluster10 artifact schemaVersion must be 1')
  const replay = record(artifact.replayCapCanonicalTerminal, 'cluster10 replay result')
  exactKeys(
    replay,
    ['healthy', 'retainedEventTypes', 'clientStatus', 'canonicalTerminalResult', 'clientDisplayedResult'],
    ['clientError'],
    'cluster10 replay result',
  )
  boolean(replay.healthy, 'cluster10 replay result.healthy')
  array(replay.retainedEventTypes, 'cluster10 replay result.retainedEventTypes').forEach((item, index) =>
    string(item, `cluster10 replay result.retainedEventTypes[${index}]`),
  )
  for (const key of ['clientStatus', 'canonicalTerminalResult', 'clientDisplayedResult'] as const) {
    string(replay[key], `cluster10 replay result.${key}`)
  }
  if ('clientError' in replay) string(replay.clientError, 'cluster10 replay result.clientError')
  const retry = record(artifact.retriedExtendContinueDuplicate, 'cluster10 retry result')
  exactKeys(
    retry,
    ['healthy', 'afterFirstAttempt', 'duringRetry', 'canonicalTerminalResult', 'afterCanonicalTerminal'],
    [],
    'cluster10 retry result',
  )
  boolean(retry.healthy, 'cluster10 retry result.healthy')
  for (const key of [
    'afterFirstAttempt',
    'duringRetry',
    'canonicalTerminalResult',
    'afterCanonicalTerminal',
  ] as const) {
    string(retry[key], `cluster10 retry result.${key}`)
  }
  if (replay.healthy !== true || retry.healthy !== true)
    throw new Error('cluster10 artifact contains an unhealthy regression')
  return artifact as unknown as Cluster10Artifact
}

export function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function absoluteInsideRoot(root: string, relativePath: string, label: string): string {
  if (path.isAbsolute(relativePath)) throw new Error(`${label} must be repository-relative`)
  const absolutePath = path.resolve(root, relativePath)
  const relative = path.relative(root, absolutePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} escapes the repository root`)
  return absolutePath
}

export function validateFixtureProvenance(
  value: unknown,
  root: string,
  options: { verifyDigests?: boolean } = {},
): FixtureProvenanceRegister {
  const provenance = record(value, 'fixture provenance')
  exactKeys(
    provenance,
    [
      'schemaVersion',
      'fixtureId',
      'baselineCommit',
      'deterministicClock',
      'providerEndpoint',
      'caseIds',
      'sourceFiles',
      'normalizationContract',
    ],
    [],
    'fixture provenance',
  )
  if (provenance.schemaVersion !== 1) throw new Error('fixture provenance schemaVersion must be 1')
  nonEmptyString(provenance.fixtureId, 'fixture provenance.fixtureId')
  if (provenance.baselineCommit !== COMPAT_BASELINE_COMMIT) {
    throw new Error(`fixture provenance baselineCommit must be ${COMPAT_BASELINE_COMMIT}`)
  }
  nonEmptyString(provenance.deterministicClock, 'fixture provenance.deterministicClock')
  nonEmptyString(provenance.providerEndpoint, 'fixture provenance.providerEndpoint')
  const caseIds = uniqueStrings(provenance.caseIds, 'fixture provenance.caseIds')
  const expectedIds = compatCells().map((cell) => cell.id)
  if (!equal(caseIds, expectedIds))
    throw new Error('fixture provenance caseIds do not match the exact ordered case set')
  uniqueStrings(provenance.normalizationContract, 'fixture provenance.normalizationContract')
  const sources = array(provenance.sourceFiles, 'fixture provenance.sourceFiles')
  if (sources.length === 0) throw new Error('fixture provenance.sourceFiles must not be empty')
  const sourcePaths = new Set<string>()
  sources.forEach((item, index) => {
    const source = record(item, `fixture provenance.sourceFiles[${index}]`)
    exactKeys(source, ['path', 'sha256'], [], `fixture provenance.sourceFiles[${index}]`)
    const relativePath = nonEmptyString(source.path, `fixture provenance.sourceFiles[${index}].path`)
    const digest = nonEmptyString(source.sha256, `fixture provenance.sourceFiles[${index}].sha256`)
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`fixture provenance digest is invalid for ${relativePath}`)
    if (sourcePaths.has(relativePath)) throw new Error(`fixture provenance duplicates source ${relativePath}`)
    sourcePaths.add(relativePath)
    if (options.verifyDigests !== false) {
      const actual = sha256File(absoluteInsideRoot(root, relativePath, `fixture source ${relativePath}`))
      if (actual !== digest) throw new Error(`fixture provenance digest mismatch for ${relativePath}`)
    }
  })
  return provenance as unknown as FixtureProvenanceRegister
}

export function refreshFixtureProvenanceDigests(root: string, provenancePath: string): FixtureProvenanceRegister {
  const provenance = validateFixtureProvenance(readJsonFile(provenancePath), root, { verifyDigests: false })
  const refreshed: FixtureProvenanceRegister = {
    ...provenance,
    sourceFiles: provenance.sourceFiles.map((source) => ({
      path: source.path,
      sha256: sha256File(absoluteInsideRoot(root, source.path, `fixture source ${source.path}`)),
    })),
  }
  writeFileSync(provenancePath, `${JSON.stringify(refreshed, null, 2)}\n`, 'utf8')
  return refreshed
}

function divergenceKeys(diff: CompatDiffArtifact): string[] {
  const aspects: Array<[CompatDivergenceAspect, keyof CompatCellDiff]> = [
    ['execution', 'executionDivergent'],
    ['transcript', 'transcriptDivergent'],
    ['request', 'requestDivergent'],
  ]
  return diff.cells.flatMap((cell) =>
    aspects.filter(([, flag]) => cell[flag] === true).map(([aspect]) => `${cell.id}::${aspect}`),
  )
}

function divergencePayload(cell: CompatCellDiff, aspect: CompatDivergenceAspect): [unknown, unknown] {
  switch (aspect) {
    case 'execution':
      return [cell.baseline.execution, cell.current.execution]
    case 'transcript':
      return [cell.baseline.persistedTranscript, cell.current.persistedTranscript]
    case 'request':
      return [cell.baseline.providerRequests, cell.current.providerRequests]
  }
}

export function validateExpectedDifferences(
  value: unknown,
  diff: CompatDiffArtifact,
  decisionsValue: unknown,
  inventoryValue: unknown,
): ExpectedDifferenceRegister {
  const registerValue = record(value, 'expected-difference register')
  exactKeys(
    registerValue,
    ['schemaVersion', 'baselineCommit', 'decisionRegister', 'inventoryRegister', 'mappings'],
    [],
    'expected-difference register',
  )
  if (registerValue.schemaVersion !== 1) throw new Error('expected-difference schemaVersion must be 1')
  if (registerValue.baselineCommit !== COMPAT_BASELINE_COMMIT) {
    throw new Error(`expected-difference baselineCommit must be ${COMPAT_BASELINE_COMMIT}`)
  }
  if (registerValue.decisionRegister !== DECISION_REGISTER_PATH) {
    throw new Error(`expected-difference decisionRegister must be ${DECISION_REGISTER_PATH}`)
  }
  if (registerValue.inventoryRegister !== INVENTORY_REGISTER_PATH) {
    throw new Error(`expected-difference inventoryRegister must be ${INVENTORY_REGISTER_PATH}`)
  }

  const decisions = array(record(decisionsValue, 'decision register').decisions, 'decision register.decisions')
  const decisionById = new Map(
    decisions.map((item) => {
      const decision = record(item, 'decision')
      return [string(decision.id, 'decision.id'), decision]
    }),
  )
  const rows = array(record(inventoryValue, 'inventory register').rows, 'inventory register.rows')
  const inventoryById = new Map(
    rows.map((item) => {
      const row = record(item, 'inventory row')
      return [string(row.id, 'inventory row.id'), row]
    }),
  )

  const mappings = array(registerValue.mappings, 'expected-difference mappings')
  const mappingKeys: string[] = []
  mappings.forEach((item, index) => {
    const mapping = record(item, `expected-difference mappings[${index}]`)
    exactKeys(
      mapping,
      ['cellId', 'aspect', 'differenceDigest', 'decisionIds', 'inventoryIds', 'rationale'],
      [],
      `expected-difference mappings[${index}]`,
    )
    const cellId = nonEmptyString(mapping.cellId, `expected-difference mappings[${index}].cellId`)
    const aspect = nonEmptyString(mapping.aspect, `expected-difference mappings[${index}].aspect`)
    if (!['execution', 'transcript', 'request'].includes(aspect)) {
      throw new Error(`expected-difference mapping has invalid aspect ${aspect}`)
    }
    const typedAspect = aspect as CompatDivergenceAspect
    mappingKeys.push(`${cellId}::${aspect}`)
    const digest = nonEmptyString(mapping.differenceDigest, `expected-difference mappings[${index}].differenceDigest`)
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`expected-difference mapping has invalid digest for ${cellId}`)
    const diffCell = diff.cells.find((cell) => cell.id === cellId)
    if (!diffCell) throw new Error(`expected-difference mapping references unknown case ${cellId}`)
    const [baselinePayload, currentPayload] = divergencePayload(diffCell, typedAspect)
    const actualDigest = semanticDifferenceDigest(baselinePayload, currentPayload)
    if (digest !== actualDigest) {
      throw new Error(`expected-difference semantic delta changed for ${cellId}::${aspect}`)
    }
    nonEmptyString(mapping.rationale, `expected-difference mappings[${index}].rationale`)
    const decisionIds = uniqueStrings(mapping.decisionIds, `expected-difference mappings[${index}].decisionIds`)
    const inventoryIds = uniqueStrings(mapping.inventoryIds, `expected-difference mappings[${index}].inventoryIds`)
    const ownedInventory = new Set<string>()
    for (const decisionId of decisionIds) {
      const decision = decisionById.get(decisionId)
      if (!decision) throw new Error(`expected difference references missing decision ${decisionId}`)
      if (decision.state !== 'signed') throw new Error(`expected difference references unsigned decision ${decisionId}`)
      uniqueStrings(decision.inventoryIds, `decision ${decisionId}.inventoryIds`).forEach((id) =>
        ownedInventory.add(id),
      )
    }
    if (!equal([...ownedInventory].sort(), [...inventoryIds].sort())) {
      throw new Error(
        `expected difference inventory IDs do not exactly match decision ownership for ${cellId}::${aspect}`,
      )
    }
    for (const inventoryId of inventoryIds) {
      const inventory = inventoryById.get(inventoryId)
      if (!inventory) throw new Error(`expected difference references missing inventory row ${inventoryId}`)
      const verification = record(inventory.verification, `inventory ${inventoryId}.verification`)
      if (!decisionIds.includes(String(verification.decisionId))) {
        throw new Error(`inventory ${inventoryId} does not backlink to a mapped signed decision`)
      }
    }
  })
  if (new Set(mappingKeys).size !== mappingKeys.length)
    throw new Error('expected-difference mappings contain duplicates')
  const actualKeys = divergenceKeys(diff)
  if (!equal(mappingKeys, actualKeys)) {
    const missing = actualKeys.filter((key) => !mappingKeys.includes(key))
    const extra = mappingKeys.filter((key) => !actualKeys.includes(key))
    throw new Error(
      `expected-difference mappings do not match raw divergences; missing=${missing.join(',')} extra=${extra.join(',')}`,
    )
  }
  return registerValue as unknown as ExpectedDifferenceRegister
}

export function buildGoldenManifest(root: string, reason: string): GoldenManifest {
  if (reason.trim().length < 12)
    throw new Error('Golden update reason must contain at least 12 non-whitespace characters')
  return {
    schemaVersion: 1,
    baselineCommit: COMPAT_BASELINE_COMMIT,
    updateReason: reason.trim(),
    updateCommand: 'pnpm test:compat-harness -- --update-goldens --reason "<review reason>"',
    files: MANIFEST_DIGEST_PATHS.map((relativePath) => ({
      path: relativePath,
      sha256: sha256File(path.resolve(root, relativePath)),
    })),
  }
}

export function validateGoldenManifest(value: unknown, root: string): void {
  const manifest = record(value, 'golden manifest')
  exactKeys(
    manifest,
    ['schemaVersion', 'baselineCommit', 'updateReason', 'updateCommand', 'files'],
    [],
    'golden manifest',
  )
  if (manifest.schemaVersion !== 1) throw new Error('golden manifest schemaVersion must be 1')
  if (manifest.baselineCommit !== COMPAT_BASELINE_COMMIT) throw new Error('golden manifest baselineCommit is wrong')
  nonEmptyString(manifest.updateReason, 'golden manifest.updateReason')
  nonEmptyString(manifest.updateCommand, 'golden manifest.updateCommand')
  const files = array(manifest.files, 'golden manifest.files')
  const paths = files.map((item, index) => {
    const file = record(item, `golden manifest.files[${index}]`)
    exactKeys(file, ['path', 'sha256'], [], `golden manifest.files[${index}]`)
    const relativePath = nonEmptyString(file.path, `golden manifest.files[${index}].path`)
    const expectedDigest = nonEmptyString(file.sha256, `golden manifest.files[${index}].sha256`)
    const actualDigest = sha256File(absoluteInsideRoot(root, relativePath, `manifest file ${relativePath}`))
    if (actualDigest !== expectedDigest) throw new Error(`golden manifest digest mismatch for ${relativePath}`)
    return relativePath
  })
  if (!equal(paths, [...MANIFEST_DIGEST_PATHS]))
    throw new Error('golden manifest does not contain the exact artifact set')
}
