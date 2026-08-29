import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeCompatibilityObservable,
  compatibilityRegisterPaths,
  validateOriginalRisuCompatibilityRegisterDocuments,
  validateOriginalRisuCompatibilityRegisters,
  type CompatibilityRegisterDocuments,
  type CompatibilityRegisterSchemas,
} from './validate-original-risu-compatibility-registers.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const commit = (value: number) => value.toString(16).padStart(40, '0')

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as unknown
}

const coreSchemas: CompatibilityRegisterSchemas = {
  inventory: readJson(compatibilityRegisterPaths.inventorySchema),
  findings: readJson(compatibilityRegisterPaths.findingsSchema),
  decisions: readJson(compatibilityRegisterPaths.decisionsSchema),
}

function inventoryRow(id = 'ORC-SURFACE-001') {
  return {
    id,
    title: 'Compatibility surface',
    primaryCategory: 'A',
    seamTags: [],
    sourceObligation: 'fork-parity',
    observables: ['persisted value'],
    variants: ['missing', 'null'],
    owners: { baseline: [], browser: [], protocol: [], fastify: [], persistence: [] },
    upstream: { commits: [], disposition: 'not-applicable', nativePortCommits: [] },
    normalization: ['JSON object key order only'],
    evidence: { baseline: [], current: [], tests: [], fixtures: [] },
    verification: {
      state: 'candidate',
      confidence: 'none',
      lastFastifyCommit: null,
      findingIds: [],
      decisionId: null,
      residual: null,
    },
    notes: '',
  }
}

function finding(id = 'ORC-A-001') {
  return {
    id,
    title: 'Observable difference',
    category: 'A',
    severity: 'Medium',
    evidenceState: 'reported',
    verificationState: 'pending',
    disposition: 'fix',
    expected: 'Expected behavior',
    actual: 'Actual behavior',
    userConsequence: 'Visible mismatch',
    inventoryIds: ['ORC-SURFACE-001'],
    sourceEvidence: [],
    reproduction: [],
    decisionId: null,
    implementationCommit: null,
    regressionEvidence: [],
    verificationCommit: null,
    residualRisk: null,
  }
}

function decision(id = 'ORC-DECISION-001') {
  return {
    id,
    state: 'proposed',
    title: 'Compatibility decision',
    baselineBehavior: 'Baseline behavior',
    decidedBehavior: 'Proposed behavior',
    observables: ['visible result'],
    inventoryIds: ['ORC-SURFACE-001'],
    rationale: 'A specific tradeoff needs authority.',
    parityAlternative: 'Restore baseline parity.',
    authority: 'Maintainer review pending',
    authorityDate: '2026-08-30',
    source: 'historical audit',
    implementationOwners: [],
    regressionOwners: [],
    diagnostics: [],
    revisitTrigger: null,
  }
}

function coreDocuments(): CompatibilityRegisterDocuments {
  return {
    inventory: {
      $schema: './inventory.schema.json',
      schemaVersion: 1,
      references: {
        compatibilityBaseline: commit(1001),
        behavioralSyncCursor: commit(85),
        planningAuditAnchor: commit(2001),
      },
      state: 'active',
      rows: [],
    },
    findings: {
      $schema: './findings.schema.json',
      schemaVersion: 1,
      state: 'active',
      rawMappings: [],
      findings: [],
    },
    decisions: {
      $schema: './decisions.schema.json',
      schemaVersion: 1,
      state: 'active',
      decisions: [],
    },
  }
}

function validate(documents: CompatibilityRegisterDocuments) {
  return validateOriginalRisuCompatibilityRegisterDocuments({ documents, schemas: coreSchemas })
}

describe('original RisuAI compatibility register validator', () => {
  it('loads and validates the repository registers with their JSON schemas', () => {
    expect(validateOriginalRisuCompatibilityRegisters(repoRoot)).toEqual({ ok: true, errors: [] })
  })

  it('fails closed when required register files cannot be loaded', () => {
    const result = validateOriginalRisuCompatibilityRegisters(path.join(repoRoot, 'does-not-exist'))

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('inventory could not be loaded')]))
  })

  it('preserves the schema distinction between a required nullable field and a missing field', () => {
    const documents = coreDocuments()
    const row = inventoryRow()
    ;(documents.inventory as { rows: unknown[] }).rows.push(row)

    expect(validate(documents)).toEqual({ ok: true, errors: [] })

    delete (row.verification as Partial<typeof row.verification>).decisionId
    const missing = validate(documents)
    expect(missing.ok).toBe(false)
    expect(missing.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("must have required property 'decisionId'")]),
    )
  })

  it('rejects duplicate stable IDs, duplicate raw source IDs, and dangling references', () => {
    const documents = coreDocuments()
    const firstRow = inventoryRow()
    const secondRow = inventoryRow()
    ;(documents.inventory as { rows: unknown[] }).rows.push(firstRow, secondRow)
    ;(documents.findings as { rawMappings: unknown[]; findings: unknown[] }).rawMappings.push(
      {
        sourceId: 'audit/raw-1',
        source: 'first report',
        outcome: 'not-a-finding',
        targetId: null,
        rationale: 'Not reproducible.',
      },
      {
        sourceId: 'audit/raw-1',
        source: 'second report',
        outcome: 'canonical-finding',
        targetId: 'ORC-A-999',
        rationale: 'Reported elsewhere.',
      },
    )
    ;(documents.findings as { rawMappings: unknown[]; findings: unknown[] }).findings.push({
      ...finding(),
      id: 'ORC-A-002',
      inventoryIds: ['ORC-SURFACE-999'],
    })

    const result = validate(documents)
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('inventory row IDs contains duplicate value "ORC-SURFACE-001"'),
        expect.stringContaining('raw finding source IDs contains duplicate value "audit/raw-1"'),
        expect.stringContaining('raw mapping audit/raw-1 references missing ID "ORC-A-999"'),
        expect.stringContaining('finding ORC-A-002 references missing ID "ORC-SURFACE-999"'),
      ]),
    )
  })

  it('requires bidirectional links and signed authority for accepted dispositions', () => {
    const documents = coreDocuments()
    const row = inventoryRow()
    row.sourceObligation = 'signed-divergence'
    row.verification.state = 'finding'
    row.verification.findingIds = ['ORC-A-001']
    row.verification.decisionId = 'ORC-DECISION-001'
    const acceptedFinding = {
      ...finding(),
      disposition: 'signed-keep',
      decisionId: 'ORC-DECISION-001',
    }
    ;(documents.inventory as { rows: unknown[] }).rows.push(row)
    ;(documents.findings as { findings: unknown[] }).findings.push(acceptedFinding)
    ;(documents.decisions as { decisions: unknown[] }).decisions.push(decision())

    const proposed = validate(documents)
    expect(proposed.ok).toBe(false)
    expect(proposed.errors).toEqual(
      expect.arrayContaining([
        'inventory row ORC-SURFACE-001 requires a signed decision, but ORC-DECISION-001 is proposed',
        'finding ORC-A-001 requires a signed decision, but ORC-DECISION-001 is proposed',
      ]),
    )
    ;(documents.decisions as { decisions: Array<{ state: string }> }).decisions[0].state = 'signed'
    expect(validate(documents)).toEqual({ ok: true, errors: [] })
  })

  it('allows proposed authority only for an explicitly decision-required unsupported row', () => {
    const documents = coreDocuments()
    const row = inventoryRow()
    row.sourceObligation = 'standing-unsupported'
    row.upstream.disposition = 'no-port'
    row.verification.state = 'decision-required'
    row.verification.decisionId = 'ORC-DECISION-001'
    ;(documents.inventory as { rows: unknown[] }).rows.push(row)
    ;(documents.decisions as { decisions: unknown[] }).decisions.push(decision())

    expect(validate(documents)).toEqual({ ok: true, errors: [] })

    row.verification.state = 'mapped'
    const prematurelyAccepted = validate(documents)
    expect(prematurelyAccepted.ok).toBe(false)
    expect(prematurelyAccepted.errors).toContain(
      'inventory row ORC-SURFACE-001 requires a signed decision, but ORC-DECISION-001 is proposed',
    )
  })
})

function upstreamSchema(): unknown {
  return readJson(compatibilityRegisterPaths.upstreamUnitsSchema)
}

function upstreamFixture(expectedCommits: readonly string[]) {
  return {
    $schema: './upstream-units.schema.json',
    schemaVersion: 1,
    state: 'active',
    references: {
      startExclusive: commit(1001),
      endInclusive: expectedCommits.at(-1),
    },
    sourceLedger: 'synthetic adversarial fixture',
    units: expectedCommits.map((upstreamCommit, index) => ({
      id: `ORC-UPSTREAM-${String(index + 1).padStart(3, '0')}`,
      sequence: index + 1,
      upstreamCommit,
      committedDate: '2026-08-30',
      subject: `Upstream unit ${index + 1}`,
      historicalDisposition: 'already-covered',
      decisionId: null,
      sourceRefs: ['synthetic fixture'],
      nativePortCommits: [],
      currentOwners: ['test owner'],
      currentVerification: {
        state: 'pending',
        lastFastifyCommit: null,
        evidence: [],
        inventoryIds: [],
      },
      notes: '',
    })),
  }
}

describe('upstream unit coverage', () => {
  it('accepts only the exact 85 first-parent commits in sequence and order', () => {
    const expectedCommits = Array.from({ length: 85 }, (_, index) => commit(index + 1))
    const documents = coreDocuments()
    documents.upstreamUnits = upstreamFixture(expectedCommits)
    const schemas = { ...coreSchemas, upstreamUnits: upstreamSchema() }

    expect(
      validateOriginalRisuCompatibilityRegisterDocuments({
        documents,
        schemas,
        expectedUpstreamCommits: expectedCommits,
      }),
    ).toEqual({ ok: true, errors: [] })

    const units = (documents.upstreamUnits as { units: Array<{ upstreamCommit: string }> }).units
    ;[units[40].upstreamCommit, units[41].upstreamCommit] = [units[41].upstreamCommit, units[40].upstreamCommit]
    const reordered = validateOriginalRisuCompatibilityRegisterDocuments({
      documents,
      schemas,
      expectedUpstreamCommits: expectedCommits,
    })
    expect(reordered.ok).toBe(false)
    expect(reordered.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('does not match first-parent commit order')]),
    )
  })

  it('rejects unfinished and stale evidence when the registers declare closure', () => {
    const expectedCommits = Array.from({ length: 85 }, (_, index) => commit(index + 1))
    const documents = coreDocuments()
    documents.upstreamUnits = upstreamFixture(expectedCommits)
    ;(documents.inventory as { state: string; rows: unknown[] }).state = 'closed'
    ;(documents.findings as { state: string; findings: unknown[] }).state = 'closed'
    ;(documents.decisions as { state: string; decisions: unknown[] }).state = 'closed'
    ;(documents.upstreamUnits as { state: string }).state = 'closed'

    const row = inventoryRow()
    row.verification.residual = 'The owning domain phase must independently re-verify current behavior.'
    ;(documents.inventory as { rows: unknown[] }).rows.push(row)
    ;(documents.findings as { findings: unknown[] }).findings.push({
      ...finding(),
      residualRisk: 'The owning phase must re-run current regression evidence.',
    })
    ;(documents.decisions as { decisions: unknown[] }).decisions.push(decision())

    const units = (
      documents.upstreamUnits as {
        units: Array<{
          currentVerification: { state: string; lastFastifyCommit: string | null; evidence: string[] }
        }>
      }
    ).units
    for (const unit of units) {
      unit.currentVerification.state = 'not-applicable'
      unit.currentVerification.evidence = ['current exclusion evidence']
    }
    units[0].currentVerification.state = 'pending'
    units[0].currentVerification.evidence = []

    const result = validateOriginalRisuCompatibilityRegisterDocuments({
      documents,
      schemas: { ...coreSchemas, upstreamUnits: upstreamSchema() },
      expectedUpstreamCommits: expectedCommits,
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'closed inventory row ORC-SURFACE-001 cannot remain candidate',
        'closed inventory row ORC-SURFACE-001 retains a phase-owned re-verification placeholder',
        'closed finding ORC-A-001 cannot remain pending',
        'closed finding ORC-A-001 cannot retain fix disposition',
        'closed finding ORC-A-001 retains a phase-owned re-verification placeholder',
        'closed decision ORC-DECISION-001 cannot remain proposed',
        'closed upstream unit ORC-UPSTREAM-001 cannot remain pending',
        'closed upstream unit ORC-UPSTREAM-001 must record current evidence',
      ]),
    )
  })

  it('rejects duplicate IDs and commits even when the unit count remains 85', () => {
    const expectedCommits = Array.from({ length: 85 }, (_, index) => commit(index + 1))
    const documents = coreDocuments()
    documents.upstreamUnits = upstreamFixture(expectedCommits)
    const units = (
      documents.upstreamUnits as {
        units: Array<{ id: string; upstreamCommit: string }>
      }
    ).units
    units[1].id = units[0].id
    units[1].upstreamCommit = units[0].upstreamCommit

    const result = validateOriginalRisuCompatibilityRegisterDocuments({
      documents,
      schemas: { ...coreSchemas, upstreamUnits: upstreamSchema() },
      expectedUpstreamCommits: expectedCommits,
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('upstream unit IDs contains duplicate value'),
        expect.stringContaining('upstream unit commits contains duplicate value'),
      ]),
    )
  })

  it('rejects abbreviated and non-lowercase commit IDs', () => {
    const expectedCommits = Array.from({ length: 85 }, (_, index) => commit(index + 1))
    const documents = coreDocuments()
    documents.upstreamUnits = upstreamFixture(expectedCommits)
    ;(documents.upstreamUnits as { units: Array<{ upstreamCommit: string }> }).units[0].upstreamCommit = 'ABC123'

    const result = validateOriginalRisuCompatibilityRegisterDocuments({
      documents,
      schemas: { ...coreSchemas, upstreamUnits: upstreamSchema() },
      expectedUpstreamCommits: expectedCommits,
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('must match pattern')]))
  })

  it('rejects an upstream decision reference that is absent from the decision register', () => {
    const expectedCommits = Array.from({ length: 85 }, (_, index) => commit(index + 1))
    const documents = coreDocuments()
    documents.upstreamUnits = upstreamFixture(expectedCommits)
    ;(documents.upstreamUnits as { units: Array<{ decisionId: string | null }> }).units[0].decisionId =
      'ORC-DECISION-999'

    const result = validateOriginalRisuCompatibilityRegisterDocuments({
      documents,
      schemas: { ...coreSchemas, upstreamUnits: upstreamSchema() },
      expectedUpstreamCommits: expectedCommits,
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('references missing ID "ORC-DECISION-999"')]),
    )
  })
})

describe('semantic observable normalization', () => {
  it('normalizes JSON object key order without erasing missing, undefined, or null', () => {
    expect(canonicalizeCompatibilityObservable({ b: 2, a: 1 })).toBe(
      canonicalizeCompatibilityObservable({ a: 1, b: 2 }),
    )

    const missing = canonicalizeCompatibilityObservable({})
    const undefinedValue = canonicalizeCompatibilityObservable({ value: undefined })
    const nullValue = canonicalizeCompatibilityObservable({ value: null })
    expect(new Set([missing, undefinedValue, nullValue])).toHaveLength(3)
  })

  it('keeps array/event order, repeated values, and exact endpoint path/query semantic', () => {
    expect(canonicalizeCompatibilityObservable(['start', 'finish'])).not.toBe(
      canonicalizeCompatibilityObservable(['finish', 'start']),
    )
    expect(canonicalizeCompatibilityObservable(['retry', 'retry'])).not.toBe(
      canonicalizeCompatibilityObservable(['retry']),
    )
    expect(
      canonicalizeCompatibilityObservable({ endpoint: 'https://api.example/v1/responses?mode=a&retry=1' }),
    ).not.toBe(canonicalizeCompatibilityObservable({ endpoint: 'https://api.example/v1/chat?mode=a&retry=1' }))
    expect(
      canonicalizeCompatibilityObservable({ endpoint: 'https://api.example/v1/responses?mode=a&retry=1' }),
    ).not.toBe(canonicalizeCompatibilityObservable({ endpoint: 'https://api.example/v1/responses?retry=1&mode=a' }))
  })
})
