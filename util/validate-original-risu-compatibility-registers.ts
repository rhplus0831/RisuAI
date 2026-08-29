import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const UPSTREAM_UNIT_ID_PATTERN = /^ORC-UPSTREAM-[0-9]{3}$/
const EXPECTED_UPSTREAM_UNIT_COUNT = 85

export const compatibilityRegisterPaths = {
  inventory: 'docs/plan/original-risu-behavioral-compatibility/inventory/compatibility-surfaces.json',
  inventorySchema: 'docs/plan/original-risu-behavioral-compatibility/inventory/inventory.schema.json',
  findings: 'docs/plan/original-risu-behavioral-compatibility/findings/findings.json',
  findingsSchema: 'docs/plan/original-risu-behavioral-compatibility/findings/findings.schema.json',
  decisions: 'docs/plan/original-risu-behavioral-compatibility/findings/decisions.json',
  decisionsSchema: 'docs/plan/original-risu-behavioral-compatibility/findings/decisions.schema.json',
  upstreamUnits: 'docs/plan/original-risu-behavioral-compatibility/inventory/upstream-units.json',
  upstreamUnitsSchema: 'docs/plan/original-risu-behavioral-compatibility/inventory/upstream-units.schema.json',
} as const

export interface CompatibilityRegisterDocuments {
  inventory: unknown
  findings: unknown
  decisions: unknown
  upstreamUnits?: unknown
}

export interface CompatibilityRegisterSchemas {
  inventory: unknown
  findings: unknown
  decisions: unknown
  upstreamUnits?: unknown
}

export interface CompatibilityRegisterValidationInput {
  documents: CompatibilityRegisterDocuments
  schemas: CompatibilityRegisterSchemas
  expectedUpstreamCommits?: readonly string[]
}

export interface CompatibilityRegisterValidationResult {
  ok: boolean
  errors: string[]
}

type JsonObject = Record<string, unknown>

interface InventoryRow extends JsonObject {
  id: string
  sourceObligation: string
  upstream: JsonObject & {
    commits: string[]
    disposition: string
    nativePortCommits: string[]
  }
  verification: JsonObject & {
    state: string
    lastFastifyCommit: string | null
    findingIds: string[]
    decisionId: string | null
  }
}

interface Finding extends JsonObject {
  id: string
  disposition: string
  inventoryIds: string[]
  decisionId: string | null
  implementationCommit: string | null
  verificationCommit: string | null
}

interface RawMapping extends JsonObject {
  sourceId: string
  outcome: string
  targetId: string | null
}

interface Decision extends JsonObject {
  id: string
  state: string
  inventoryIds: string[]
}

interface UpstreamUnit extends JsonObject {
  id: string
  sequence: number
  upstreamCommit: string
  historicalDisposition: unknown
  decisionId: string | null
  currentVerification: JsonObject & { state: unknown; inventoryIds: string[] }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function schemaErrors(label: string, errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath || '/'
    return `${label}${location}: ${error.message ?? error.keyword}`
  })
}

function validateSchema(label: string, schema: unknown, document: unknown): string[] {
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv)
    const validate = ajv.compile(schema as object)
    return validate(document) ? [] : schemaErrors(label, validate.errors)
  } catch (error) {
    return [`${label} schema could not be compiled: ${error instanceof Error ? error.message : String(error)}`]
  }
}

function addDuplicates(errors: string[], label: string, values: readonly unknown[]): void {
  const seen = new Set<unknown>()
  const reported = new Set<unknown>()
  for (const value of values) {
    if (seen.has(value) && !reported.has(value)) {
      errors.push(`${label} contains duplicate value ${JSON.stringify(value)}`)
      reported.add(value)
    }
    seen.add(value)
  }
}

function requireReference(errors: string[], label: string, id: string, ids: ReadonlySet<string>): void {
  if (!ids.has(id)) errors.push(`${label} references missing ID ${JSON.stringify(id)}`)
}

function validateCommit(errors: string[], label: string, commit: unknown, nullable = false): void {
  if (nullable && commit === null) return
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) {
    errors.push(`${label} must be a 40-character lowercase hexadecimal commit`)
  }
}

function validateCommitFields(value: unknown, location: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateCommitFields(item, `${location}/${index}`, errors))
    return
  }
  if (!isObject(value)) return

  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}/${key}`
    if (/commit$/i.test(key)) {
      validateCommit(errors, childLocation, child, key !== 'upstreamCommit')
    } else if (/commits$/i.test(key)) {
      if (!Array.isArray(child)) {
        errors.push(`${childLocation} must be an array of 40-character lowercase hexadecimal commits`)
      } else {
        child.forEach((commit, index) => validateCommit(errors, `${childLocation}/${index}`, commit))
      }
    }
    validateCommitFields(child, childLocation, errors)
  }
}

function validateCoreRelationships(documents: CompatibilityRegisterDocuments, errors: string[]): void {
  const inventory = documents.inventory as { references: JsonObject; rows: InventoryRow[] }
  const findingsRegister = documents.findings as { rawMappings: RawMapping[]; findings: Finding[] }
  const decisionsRegister = documents.decisions as { decisions: Decision[] }

  const inventoryRows = inventory.rows
  const findings = findingsRegister.findings
  const decisions = decisionsRegister.decisions
  const inventoryIds = new Set(inventoryRows.map((row) => row.id))
  const findingIds = new Set(findings.map((finding) => finding.id))
  const decisionIds = new Set(decisions.map((decision) => decision.id))
  const inventoryById = new Map(inventoryRows.map((row) => [row.id, row]))
  const findingById = new Map(findings.map((finding) => [finding.id, finding]))
  const decisionById = new Map(decisions.map((decision) => [decision.id, decision]))

  addDuplicates(
    errors,
    'inventory row IDs',
    inventoryRows.map((row) => row.id),
  )
  addDuplicates(
    errors,
    'finding IDs',
    findings.map((finding) => finding.id),
  )
  addDuplicates(
    errors,
    'decision IDs',
    decisions.map((decision) => decision.id),
  )
  addDuplicates(
    errors,
    'raw finding source IDs',
    findingsRegister.rawMappings.map((mapping) => mapping.sourceId),
  )

  for (const mapping of findingsRegister.rawMappings) {
    const label = `raw mapping ${mapping.sourceId}`
    if (mapping.outcome === 'canonical-finding') {
      if (mapping.targetId === null) errors.push(`${label} must target a canonical finding`)
      else requireReference(errors, label, mapping.targetId, findingIds)
    } else if (mapping.outcome === 'existing-decision') {
      if (mapping.targetId === null) errors.push(`${label} must target an existing decision`)
      else requireReference(errors, label, mapping.targetId, decisionIds)
    } else if (mapping.outcome === 'not-a-finding' && mapping.targetId !== null) {
      errors.push(`${label} with not-a-finding outcome must have a null targetId`)
    }
  }

  for (const row of inventoryRows) {
    for (const findingId of row.verification.findingIds) {
      requireReference(errors, `inventory row ${row.id}`, findingId, findingIds)
      const finding = findingById.get(findingId)
      if (finding && !finding.inventoryIds.includes(row.id)) {
        errors.push(`inventory row ${row.id} links finding ${findingId}, but the finding does not link back`)
      }
    }

    if (row.verification.decisionId !== null) {
      requireReference(errors, `inventory row ${row.id}`, row.verification.decisionId, decisionIds)
      const decision = decisionById.get(row.verification.decisionId)
      if (decision?.state === 'superseded') {
        errors.push(`inventory row ${row.id} cannot rely on superseded decision ${decision.id}`)
      }
    }

    if (row.verification.state === 'finding' && row.verification.findingIds.length === 0) {
      errors.push(`inventory row ${row.id} has finding state without a finding ID`)
    }
    if (row.verification.state === 'decision-required' && row.verification.decisionId === null) {
      errors.push(`inventory row ${row.id} has decision-required state without a decision ID`)
    }
    if (
      (row.sourceObligation === 'signed-divergence' || row.sourceObligation === 'standing-unsupported') &&
      row.verification.decisionId === null
    ) {
      errors.push(`inventory row ${row.id} has ${row.sourceObligation} obligation without a decision ID`)
    }
    const obligationDecision = row.verification.decisionId ? decisionById.get(row.verification.decisionId) : undefined
    if (row.sourceObligation === 'signed-divergence' && obligationDecision?.state !== 'signed') {
      if (obligationDecision) {
        errors.push(
          `inventory row ${row.id} requires a signed decision, but ${obligationDecision.id} is ${obligationDecision.state}`,
        )
      }
    }
    if (row.sourceObligation === 'standing-unsupported' && obligationDecision) {
      if (row.verification.state === 'decision-required' && obligationDecision.state !== 'proposed') {
        errors.push(
          `inventory row ${row.id} is authority-pending, but ${obligationDecision.id} is ${obligationDecision.state}`,
        )
      } else if (row.verification.state !== 'decision-required' && obligationDecision.state !== 'signed') {
        errors.push(
          `inventory row ${row.id} requires a signed decision, but ${obligationDecision.id} is ${obligationDecision.state}`,
        )
      }
    }
    if (row.upstream.disposition === 'ported' && row.upstream.nativePortCommits.length === 0) {
      errors.push(`inventory row ${row.id} has ported upstream disposition without a native port commit`)
    }
    if (
      (row.upstream.disposition === 'no-port' || row.upstream.disposition === 'decision-required') &&
      row.verification.decisionId === null
    ) {
      errors.push(`inventory row ${row.id} has ${row.upstream.disposition} upstream disposition without a decision ID`)
    }
  }

  for (const finding of findings) {
    for (const inventoryId of finding.inventoryIds) {
      requireReference(errors, `finding ${finding.id}`, inventoryId, inventoryIds)
      const row = inventoryById.get(inventoryId)
      if (row && !row.verification.findingIds.includes(finding.id)) {
        errors.push(`finding ${finding.id} links inventory row ${inventoryId}, but the row does not link back`)
      }
    }

    const requiresDecision = ['decide', 'signed-keep', 'standing-unsupported'].includes(finding.disposition)
    if (requiresDecision && finding.decisionId === null) {
      errors.push(`finding ${finding.id} has ${finding.disposition} disposition without a decision ID`)
      continue
    }
    if (finding.decisionId === null) continue

    requireReference(errors, `finding ${finding.id}`, finding.decisionId, decisionIds)
    const decision = decisionById.get(finding.decisionId)
    if (!decision) continue
    if (decision.state === 'superseded') {
      errors.push(`finding ${finding.id} cannot rely on superseded decision ${decision.id}`)
    }
    if (['signed-keep', 'standing-unsupported'].includes(finding.disposition) && decision.state !== 'signed') {
      errors.push(`finding ${finding.id} requires a signed decision, but ${decision.id} is ${decision.state}`)
    }
    if (finding.disposition === 'decide' && decision.state !== 'proposed') {
      errors.push(`finding ${finding.id} still has decide disposition, but ${decision.id} is ${decision.state}`)
    }
  }

  for (const decision of decisions) {
    for (const inventoryId of decision.inventoryIds) {
      requireReference(errors, `decision ${decision.id}`, inventoryId, inventoryIds)
    }
  }

  validateCommitFields(documents.inventory, 'inventory', errors)
  validateCommitFields(documents.findings, 'findings', errors)
}

function validateUpstreamUnits(
  document: unknown,
  expectedCommits: readonly string[] | undefined,
  inventory: { references: JsonObject; rows: InventoryRow[] },
  decisions: { decisions: Decision[] },
  errors: string[],
): void {
  const register = document as { references: JsonObject; units: UpstreamUnit[] }
  const units = register.units
  const inventoryIds = new Set(inventory.rows.map((row) => row.id))
  const decisionIds = new Set(decisions.decisions.map((decision) => decision.id))
  const decisionsById = new Map(decisions.decisions.map((decision) => [decision.id, decision]))
  const unitsByCommit = new Map(units.map((unit) => [unit.upstreamCommit, unit]))
  addDuplicates(
    errors,
    'upstream unit IDs',
    units.map((unit) => unit.id),
  )
  addDuplicates(
    errors,
    'upstream unit commits',
    units.map((unit) => unit.upstreamCommit),
  )
  addDuplicates(
    errors,
    'upstream unit sequences',
    units.map((unit) => unit.sequence),
  )

  if (units.length !== EXPECTED_UPSTREAM_UNIT_COUNT) {
    errors.push(`upstream register must contain exactly ${EXPECTED_UPSTREAM_UNIT_COUNT} units; found ${units.length}`)
  }
  if (!expectedCommits) {
    errors.push('upstream first-parent commit list could not be established')
  } else if (expectedCommits.length !== EXPECTED_UPSTREAM_UNIT_COUNT) {
    errors.push(
      `Git first-parent range must contain exactly ${EXPECTED_UPSTREAM_UNIT_COUNT} commits; found ${expectedCommits.length}`,
    )
  }

  if (register.references.startExclusive !== inventory.references.compatibilityBaseline) {
    errors.push('upstream register startExclusive must equal the inventory compatibilityBaseline')
  }
  if (register.references.endInclusive !== inventory.references.behavioralSyncCursor) {
    errors.push('upstream register endInclusive must equal the inventory behavioralSyncCursor')
  }

  units.forEach((unit, index) => {
    const label = `upstream unit at index ${index}`
    if (!UPSTREAM_UNIT_ID_PATTERN.test(unit.id)) {
      errors.push(`${label} has invalid stable ID ${JSON.stringify(unit.id)}`)
    }
    if (unit.sequence !== index + 1) {
      errors.push(`${label} must have sequence ${index + 1}; found ${JSON.stringify(unit.sequence)}`)
    }
    validateCommit(errors, `${label} upstreamCommit`, unit.upstreamCommit)
    if (expectedCommits && unit.upstreamCommit !== expectedCommits[index]) {
      errors.push(
        `${label} does not match first-parent commit order: expected ${expectedCommits[index] ?? '<none>'}, found ${unit.upstreamCommit}`,
      )
    }
    if (typeof unit.historicalDisposition !== 'string' || unit.historicalDisposition.trim() === '') {
      errors.push(`${label} must have a nonempty historicalDisposition`)
    }
    if (unit.decisionId !== null) {
      requireReference(errors, label, unit.decisionId, decisionIds)
      if (decisionsById.get(unit.decisionId)?.state === 'superseded') {
        errors.push(`${label} cannot rely on superseded decision ${unit.decisionId}`)
      }
    }
    if (unit.historicalDisposition === 'standing-no-port' && unit.decisionId === null) {
      errors.push(`${label} has standing-no-port disposition without a decision ID`)
    }
    if (!isObject(unit.currentVerification) || typeof unit.currentVerification.state !== 'string') {
      errors.push(`${label} must have an independent currentVerification.state`)
    } else if (unit.currentVerification.state.trim() === '') {
      errors.push(`${label} must have a nonempty currentVerification.state`)
    }
    for (const inventoryId of unit.currentVerification.inventoryIds) {
      requireReference(errors, `${label} current verification`, inventoryId, inventoryIds)
      const row = inventory.rows.find((candidate) => candidate.id === inventoryId)
      if (row && !row.upstream.commits.includes(unit.upstreamCommit)) {
        errors.push(`${label} links inventory row ${inventoryId}, but the row does not link back`)
      }
    }
  })

  for (const row of inventory.rows) {
    for (const commit of row.upstream.commits) {
      if (!unitsByCommit.has(commit)) {
        errors.push(`inventory row ${row.id} references upstream commit ${commit}, which has no upstream unit`)
      }
    }
  }

  validateCommitFields(document, 'upstreamUnits', errors)
}

export function validateOriginalRisuCompatibilityRegisterDocuments(
  input: CompatibilityRegisterValidationInput,
): CompatibilityRegisterValidationResult {
  const errors = [
    ...validateSchema('inventory', input.schemas.inventory, input.documents.inventory),
    ...validateSchema('findings', input.schemas.findings, input.documents.findings),
    ...validateSchema('decisions', input.schemas.decisions, input.documents.decisions),
  ]
  const coreSchemasValid = errors.length === 0

  const hasUpstreamDocument = input.documents.upstreamUnits !== undefined
  const hasUpstreamSchema = input.schemas.upstreamUnits !== undefined
  if (hasUpstreamDocument !== hasUpstreamSchema) {
    errors.push('upstream register and schema must either both exist or both be absent')
  }

  let upstreamSchemaValid = false
  if (hasUpstreamDocument && hasUpstreamSchema) {
    const upstreamErrors = validateSchema('upstreamUnits', input.schemas.upstreamUnits, input.documents.upstreamUnits)
    errors.push(...upstreamErrors)
    upstreamSchemaValid = upstreamErrors.length === 0
  }

  if (coreSchemasValid) validateCoreRelationships(input.documents, errors)
  if (coreSchemasValid && upstreamSchemaValid) {
    validateUpstreamUnits(
      input.documents.upstreamUnits,
      input.expectedUpstreamCommits,
      input.documents.inventory as { references: JsonObject; rows: InventoryRow[] },
      input.documents.decisions as { decisions: Decision[] },
      errors,
    )
  }

  return { ok: errors.length === 0, errors }
}

function readJson(file: string, label: string, errors: string[]): unknown | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch (error) {
    errors.push(`${label} could not be loaded: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function readExpectedUpstreamCommits(repoRoot: string, inventory: unknown, errors: string[]): string[] | undefined {
  if (!isObject(inventory) || !isObject(inventory.references)) {
    errors.push('inventory references are unavailable for upstream first-parent validation')
    return undefined
  }
  const baseline = inventory.references.compatibilityBaseline
  const cursor = inventory.references.behavioralSyncCursor
  if (typeof baseline !== 'string' || typeof cursor !== 'string') {
    errors.push('inventory baseline and sync cursor are unavailable for upstream first-parent validation')
    return undefined
  }
  try {
    return execFileSync('git', ['rev-list', '--first-parent', '--reverse', `${baseline}..${cursor}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch (error) {
    errors.push(`Git first-parent range could not be loaded: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

export function validateOriginalRisuCompatibilityRegisters(
  repoRoot = process.cwd(),
): CompatibilityRegisterValidationResult {
  const loadErrors: string[] = []
  const absolute = (relativePath: string) => path.join(repoRoot, relativePath)
  const upstreamDocumentExists = existsSync(absolute(compatibilityRegisterPaths.upstreamUnits))
  const upstreamSchemaExists = existsSync(absolute(compatibilityRegisterPaths.upstreamUnitsSchema))

  const inventory = readJson(absolute(compatibilityRegisterPaths.inventory), 'inventory', loadErrors)
  const findings = readJson(absolute(compatibilityRegisterPaths.findings), 'findings', loadErrors)
  const decisions = readJson(absolute(compatibilityRegisterPaths.decisions), 'decisions', loadErrors)
  const inventorySchema = readJson(absolute(compatibilityRegisterPaths.inventorySchema), 'inventory schema', loadErrors)
  const findingsSchema = readJson(absolute(compatibilityRegisterPaths.findingsSchema), 'findings schema', loadErrors)
  const decisionsSchema = readJson(absolute(compatibilityRegisterPaths.decisionsSchema), 'decisions schema', loadErrors)
  const upstreamUnits = upstreamDocumentExists
    ? readJson(absolute(compatibilityRegisterPaths.upstreamUnits), 'upstream register', loadErrors)
    : undefined
  const upstreamUnitsSchema = upstreamSchemaExists
    ? readJson(absolute(compatibilityRegisterPaths.upstreamUnitsSchema), 'upstream schema', loadErrors)
    : undefined

  if (!upstreamDocumentExists && upstreamSchemaExists) {
    loadErrors.push('upstream register is missing while its schema exists')
  } else if (upstreamDocumentExists && !upstreamSchemaExists) {
    loadErrors.push('upstream schema is missing while its register exists')
  }

  if (
    inventory === undefined ||
    findings === undefined ||
    decisions === undefined ||
    inventorySchema === undefined ||
    findingsSchema === undefined ||
    decisionsSchema === undefined ||
    (upstreamDocumentExists && upstreamUnits === undefined) ||
    (upstreamSchemaExists && upstreamUnitsSchema === undefined)
  ) {
    return { ok: false, errors: loadErrors }
  }

  const expectedUpstreamCommits = upstreamUnits
    ? readExpectedUpstreamCommits(repoRoot, inventory, loadErrors)
    : undefined
  const result = validateOriginalRisuCompatibilityRegisterDocuments({
    documents: { inventory, findings, decisions, upstreamUnits },
    schemas: {
      inventory: inventorySchema,
      findings: findingsSchema,
      decisions: decisionsSchema,
      upstreamUnits: upstreamUnitsSchema,
    },
    expectedUpstreamCommits,
  })
  return { ok: loadErrors.length === 0 && result.ok, errors: [...loadErrors, ...result.errors] }
}

function encodeObservable(value: unknown, ancestors: Set<object>): unknown {
  if (value === null) return ['null']
  if (value === undefined) return ['undefined']
  if (typeof value === 'string') return ['string', value]
  if (typeof value === 'boolean') return ['boolean', value]
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Compatibility observables may contain only finite numbers')
    return ['number', Object.is(value, -0) ? '-0' : String(value)]
  }
  if (typeof value !== 'object') {
    throw new Error(`Unsupported compatibility observable type: ${typeof value}`)
  }
  if (ancestors.has(value)) throw new Error('Compatibility observables must not contain cycles')

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return [
        'array',
        Array.from({ length: value.length }, (_, index) =>
          Object.prototype.hasOwnProperty.call(value, index)
            ? encodeObservable(value[index], ancestors)
            : ['missing-array-item'],
        ),
      ]
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error('Compatibility observables must be plain objects')
    }
    return [
      'object',
      Object.keys(value)
        .sort()
        .map((key) => [key, encodeObservable((value as JsonObject)[key], ancestors)]),
    ]
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Canonicalizes only JSON object key order. Missing, undefined, null, array/event
 * order, repeated values, and endpoint strings remain semantically distinct.
 */
export function canonicalizeCompatibilityObservable(value: unknown): string {
  return JSON.stringify(encodeObservable(value, new Set()))
}

export function runOriginalRisuCompatibilityRegisterValidatorCli(argv = process.argv.slice(2)): number {
  if (argv.length > 1) {
    process.stderr.write('Usage: validate-original-risu-compatibility-registers [repo-root]\n')
    return 1
  }
  const repoRoot = argv[0] ? path.resolve(argv[0]) : process.cwd()
  const result = validateOriginalRisuCompatibilityRegisters(repoRoot)
  if (result.ok) {
    process.stdout.write('Original RisuAI compatibility registers: PASS\n')
    return 0
  }
  process.stderr.write(
    `Original RisuAI compatibility registers: FAIL\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`,
  )
  return 1
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === fileURLToPath(import.meta.url) && existsSync(invokedPath)) {
  process.exitCode = runOriginalRisuCompatibilityRegisterValidatorCli()
}
