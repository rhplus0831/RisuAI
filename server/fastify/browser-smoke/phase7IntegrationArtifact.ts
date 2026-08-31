import fs from 'node:fs'
import path from 'node:path'
import type { StartupCoordinatorSnapshot, StartupReadinessSnapshot } from '@risuai/protocol/startup-telemetry'
import { directLinkCases, phase7DirectLinkBatchCount } from './phase7DirectLinks.js'

export interface RolloutStartupCase {
  fixture: 'small' | 'large'
  observerMode: 'disabled' | 'enabled'
  observerVisibleBeforeWriter: boolean
  startup: StartupReadinessSnapshot
  coordinator: StartupCoordinatorSnapshot
  earlyRequests: {
    mutationsBeforeWriterReady: number
    generationsBeforeChatReady: number
  }
  telemetry: BrowserStartupTelemetry[]
}

export interface BrowserStartupTelemetry {
  schemaVersion: number
  kind: string
  attemptCount: number
  observerShellEnabled: boolean
  milestone?: string
  entryDurationMs?: number
  attemptDurationMs?: number
  failureCode?: string
  failureMilestone?: string
  requestUid?: string
}

export interface DirectLinkCase {
  path: string
  requestedRouteKey: string
  finalRouteKey: string
  surfaces: string[]
  requiredPaths: string[]
  requestedPaths: string[]
}

export interface RecoveryJourney {
  scenario: 'event-gap' | 'offline-before-send' | 'response-lost-after-commit'
  initialRevision: number
  finalRevision: number
  retainedMutationId?: string
  commandAttempts: number
  receiptAcknowledgements: number
  resourceRefreshes: number
}

export interface WriterJourney {
  scenario: 'denial-then-takeover'
  observerCommandsBeforePromotion: number
  oldWriterCommandsAfterTakeover: number
  newWriterMutationAccepted: boolean
}

export interface OptionalRuntimeJourney {
  runtime: 'background-resources' | 'inlay-catalog'
  mode: 'failed' | 'slow'
  canRenderShell: boolean
  canMutate: boolean
  canGenerate: boolean
  localizedFailure: boolean
  retrySucceeded: boolean
}

export interface Phase7RecoveryArtifact {
  schemaVersion: 1
  startupRollout: RolloutStartupCase[]
  recoveryJourneys: RecoveryJourney[]
  writerJourneys: WriterJourney[]
  optionalRuntimeJourneys: OptionalRuntimeJourney[]
}

export interface Phase7IntegrationArtifact extends Phase7RecoveryArtifact {
  directLinks: DirectLinkCase[]
}

export interface IndexedDirectLinkCase {
  caseIndex: number
  result: DirectLinkCase
}

export interface Phase7DirectLinkBatchArtifact {
  schemaVersion: 1
  batchIndex: number
  batchCount: number
  totalCaseCount: number
  complete: boolean
  directLinks: IndexedDirectLinkCase[]
}

const finalJsonName = 'phase7-integration.json'
const finalTextName = 'phase7-integration.txt'
const recoveryPartialName = 'phase7-integration.recovery.partial.json'
const directLinkPartialPattern = /^phase7-integration\.direct-links-(\d+)-of-(\d+)\.partial\.json$/

export function phase7OutputDir(): string {
  return path.resolve('fast-bootstrap-results')
}

export function emptyPhase7RecoveryArtifact(): Phase7RecoveryArtifact {
  return {
    schemaVersion: 1,
    startupRollout: [],
    recoveryJourneys: [],
    writerJourneys: [],
    optionalRuntimeJourneys: [],
  }
}

export function resetPhase7ArtifactOutputs(outputDir = phase7OutputDir()): void {
  if (!fs.existsSync(outputDir)) return
  for (const name of fs.readdirSync(outputDir)) {
    if (
      name === finalJsonName ||
      name === finalTextName ||
      name === recoveryPartialName ||
      directLinkPartialPattern.test(name)
    ) {
      fs.unlinkSync(path.join(outputDir, name))
    }
  }
}

export function writePhase7RecoveryPartial(artifact: Phase7RecoveryArtifact, outputDir = phase7OutputDir()): string {
  validateRecoveryArtifact(artifact)
  return writeJson(path.join(outputDir, recoveryPartialName), artifact)
}

export function writePhase7DirectLinkBatchPartial(
  artifact: Phase7DirectLinkBatchArtifact,
  outputDir = phase7OutputDir(),
): string {
  validateDirectLinkBatchArtifact(artifact)
  const name = `phase7-integration.direct-links-${artifact.batchIndex + 1}-of-${artifact.batchCount}.partial.json`
  return writeJson(path.join(outputDir, name), artifact)
}

export function mergePhase7ArtifactOutputs({
  outputDir = phase7OutputDir(),
  required = false,
}: {
  outputDir?: string
  required?: boolean
} = {}): Phase7IntegrationArtifact | null {
  const recoveryPath = path.join(outputDir, recoveryPartialName)
  const recovery = fs.existsSync(recoveryPath) ? readRecoveryArtifact(recoveryPath) : emptyPhase7RecoveryArtifact()
  const batchPaths = fs.existsSync(outputDir)
    ? fs
        .readdirSync(outputDir)
        .filter((name) => directLinkPartialPattern.test(name))
        .sort()
        .map((name) => path.join(outputDir, name))
    : []

  if (!required && !fs.existsSync(recoveryPath) && batchPaths.length === 0) return null

  const issues: string[] = []
  if (!fs.existsSync(recoveryPath)) issues.push(`missing ${recoveryPartialName}`)
  const batches: Phase7DirectLinkBatchArtifact[] = []
  for (const batchPath of batchPaths) {
    try {
      batches.push(readDirectLinkBatchArtifact(batchPath))
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error))
    }
  }

  const byBatchIndex = new Map<number, Phase7DirectLinkBatchArtifact>()
  for (const batch of batches) {
    if (byBatchIndex.has(batch.batchIndex)) issues.push(`duplicate direct-link batch ${batch.batchIndex + 1}`)
    else byBatchIndex.set(batch.batchIndex, batch)
  }
  for (let batchIndex = 0; batchIndex < phase7DirectLinkBatchCount; batchIndex += 1) {
    const batch = byBatchIndex.get(batchIndex)
    if (!batch) issues.push(`missing direct-link batch ${batchIndex + 1}/${phase7DirectLinkBatchCount}`)
    else if (!batch.complete)
      issues.push(`incomplete direct-link batch ${batchIndex + 1}/${phase7DirectLinkBatchCount}`)
  }

  const expectedCases = directLinkCases()
  const byCaseIndex = new Map<number, DirectLinkCase>()
  for (const batch of batches) {
    if (batch.batchCount !== phase7DirectLinkBatchCount) {
      issues.push(`direct-link batch ${batch.batchIndex + 1} reports batchCount=${batch.batchCount}`)
    }
    if (batch.totalCaseCount !== expectedCases.length) {
      issues.push(`direct-link batch ${batch.batchIndex + 1} reports totalCaseCount=${batch.totalCaseCount}`)
    }
    for (const entry of batch.directLinks) {
      if (byCaseIndex.has(entry.caseIndex)) issues.push(`duplicate direct-link case index ${entry.caseIndex}`)
      else byCaseIndex.set(entry.caseIndex, entry.result)
    }
  }

  const directLinks: DirectLinkCase[] = []
  for (let caseIndex = 0; caseIndex < expectedCases.length; caseIndex += 1) {
    const result = byCaseIndex.get(caseIndex)
    if (!result) {
      issues.push(`missing direct-link case index ${caseIndex}`)
      continue
    }
    if (result.path !== expectedCases[caseIndex]!.path) {
      issues.push(
        `direct-link case index ${caseIndex} has path ${JSON.stringify(result.path)} instead of ${JSON.stringify(expectedCases[caseIndex]!.path)}`,
      )
    }
    directLinks.push(result)
  }

  const artifact: Phase7IntegrationArtifact = { ...recovery, directLinks }
  if (required || issues.length === 0) writePhase7IntegrationArtifact(artifact, outputDir)
  if (issues.length > 0 && required) throw new Error(`Phase 7 artifact merge failed: ${issues.join('; ')}`)
  return issues.length === 0 ? artifact : null
}

export function writePhase7IntegrationArtifact(
  artifact: Phase7IntegrationArtifact,
  outputDir = phase7OutputDir(),
): { json: string; text: string } {
  const json = `${JSON.stringify(artifact, null, 2)}\n`
  const text = formatIntegrationArtifact(artifact)
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(path.join(outputDir, finalJsonName), json)
  fs.writeFileSync(path.join(outputDir, finalTextName), text)
  return { json, text }
}

export function formatIntegrationArtifact(artifact: Phase7IntegrationArtifact): string {
  const lines = [
    'Phase 7 integration matrix',
    'fixture\tobserver\tobserver_before_writer\tobserver_ms\twriter_ms\tbackground_ms',
  ]
  for (const entry of artifact.startupRollout) {
    lines.push(
      [
        entry.fixture,
        entry.observerMode,
        entry.observerVisibleBeforeWriter,
        formatNumber(entry.startup.durationsFromEntry['observer-ready']),
        formatNumber(entry.startup.durationsFromEntry['writer-ready']),
        formatNumber(entry.startup.durationsFromEntry['background-ready']),
      ].join('\t'),
    )
  }
  lines.push('', 'Direct links', 'path\trequested_route_key\tfinal_route_key\tsurfaces\trequired_paths')
  for (const entry of artifact.directLinks) {
    lines.push(
      [
        entry.path,
        entry.requestedRouteKey,
        entry.finalRouteKey,
        entry.surfaces.join(','),
        entry.requiredPaths.join(','),
      ].join('\t'),
    )
  }
  lines.push(
    '',
    'Recovery',
    'scenario\tinitial_revision\tfinal_revision\tcommand_attempts\treceipt_acks\tresource_refreshes',
  )
  for (const entry of artifact.recoveryJourneys) {
    lines.push(
      [
        entry.scenario,
        entry.initialRevision,
        entry.finalRevision,
        entry.commandAttempts,
        entry.receiptAcknowledgements,
        entry.resourceRefreshes,
      ].join('\t'),
    )
  }
  lines.push('', 'Writer journeys', 'scenario\tobserver_commands_before_promotion\told_writer_commands\taccepted')
  for (const entry of artifact.writerJourneys) {
    lines.push(
      [
        entry.scenario,
        entry.observerCommandsBeforePromotion,
        entry.oldWriterCommandsAfterTakeover,
        entry.newWriterMutationAccepted,
      ].join('\t'),
    )
  }
  lines.push(
    '',
    'Optional runtimes',
    'runtime\tmode\tcan_render_shell\tcan_mutate\tcan_generate\tlocalized_failure\tretry_succeeded',
  )
  for (const entry of artifact.optionalRuntimeJourneys) {
    lines.push(
      [
        entry.runtime,
        entry.mode,
        entry.canRenderShell,
        entry.canMutate,
        entry.canGenerate,
        entry.localizedFailure,
        entry.retrySucceeded,
      ].join('\t'),
    )
  }
  return `${lines.join('\n')}\n`
}

function readRecoveryArtifact(file: string): Phase7RecoveryArtifact {
  const value = readJson(file)
  validateRecoveryArtifact(value)
  return value
}

function readDirectLinkBatchArtifact(file: string): Phase7DirectLinkBatchArtifact {
  const value = readJson(file)
  validateDirectLinkBatchArtifact(value)
  return value
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`could not read ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function validateRecoveryArtifact(value: unknown): asserts value is Phase7RecoveryArtifact {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('invalid Phase 7 recovery artifact schema')
  for (const field of ['startupRollout', 'recoveryJourneys', 'writerJourneys', 'optionalRuntimeJourneys']) {
    if (!Array.isArray(value[field])) throw new Error(`invalid Phase 7 recovery artifact field ${field}`)
  }
}

function validateDirectLinkBatchArtifact(value: unknown): asserts value is Phase7DirectLinkBatchArtifact {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('invalid Phase 7 direct-link artifact schema')
  if (!Number.isInteger(value.batchIndex) || (value.batchIndex as number) < 0) {
    throw new Error('invalid Phase 7 direct-link artifact field batchIndex')
  }
  for (const field of ['batchCount', 'totalCaseCount']) {
    if (!Number.isInteger(value[field]) || (value[field] as number) < 1) {
      throw new Error(`invalid Phase 7 direct-link artifact field ${field}`)
    }
  }
  if ((value.batchIndex as number) >= (value.batchCount as number)) {
    throw new Error('invalid Phase 7 direct-link artifact batch index')
  }
  if (typeof value.complete !== 'boolean' || !Array.isArray(value.directLinks)) {
    throw new Error('invalid Phase 7 direct-link artifact payload')
  }
  for (const entry of value.directLinks) {
    if (
      !isRecord(entry) ||
      !Number.isInteger(entry.caseIndex) ||
      (entry.caseIndex as number) < 0 ||
      !isDirectLinkCase(entry.result)
    ) {
      throw new Error('invalid Phase 7 direct-link artifact entry')
    }
  }
}

function isDirectLinkCase(value: unknown): value is DirectLinkCase {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.requestedRouteKey === 'string' &&
    typeof value.finalRouteKey === 'string' &&
    isStringArray(value.surfaces) &&
    isStringArray(value.requiredPaths) &&
    isStringArray(value.requestedPaths)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function writeJson(file: string, value: unknown): string {
  const output = `${JSON.stringify(value, null, 2)}\n`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, output)
  return output
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? '' : value.toFixed(2)
}
