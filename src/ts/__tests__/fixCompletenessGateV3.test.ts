import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * V3 fix-completeness gate, Phase 0 parser foundation.
 *
 * This first slice proves the gate can read the current v3 plan universe from
 * docs/plan before later slices add the routing registry, DONE proof checks,
 * and phase/status mirror enforcement.
 */

// `vitest run` executes from the repo root. Match the v1/v2 gates and keep
// v3 pointed at the active plan docs until the eventual archive repoint.
const ROOT = process.cwd()
const PLAN = 'docs/plan'
const AUDIT_DOC = path.join(ROOT, PLAN, 'audit-stability-and-performance-v3.md')
const RISK_DOC = path.join(ROOT, PLAN, 'active-risk-analysis.md')

type AuditKind = 'H' | 'M' | 'L' | 'I'
type ActiveRiskKind = AuditKind | 'K'
type V3DocKind = ActiveRiskKind | 'R'
type ActiveRiskStatus = 'PENDING' | 'DONE'
type ActiveRiskRouting = 'scheduled' | 'no-action'

interface ActiveRiskRoutingRow {
  id: string
  routing: ActiveRiskRouting
  phase: number | null
  targetFix: string
  status: ActiveRiskStatus | null
  rawRouting: string
  rawStatus: string
}

interface KnownOverlapResidual {
  id: string
  phase: string
  targetFix: string
  status: string
}

function readDoc(file: string): string {
  return readFileSync(file, 'utf8')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The slice of `text` under a markdown heading up to the next same-or-higher heading. */
function sectionOf(text: string, heading: string): string {
  const match = new RegExp(`^(#{1,6})\\s+${escapeRegExp(heading)}\\s*$`, 'm').exec(text)
  if (!match) throw new Error(`section "${heading}" not found`)

  const level = match[1].length
  const rest = text.slice(match.index + match[0].length)
  const nextHeading = new RegExp(`\\n#{1,${level}}\\s`).exec(rest)
  return nextHeading ? rest.slice(0, nextHeading.index) : rest
}

function kindOrder(kind: string): number {
  return ['H', 'M', 'L', 'I', 'K', 'R'].indexOf(kind)
}

function numericIdSort(a: string, b: string): number {
  const kindCompare = kindOrder(a[0]) - kindOrder(b[0])
  if (kindCompare !== 0) return kindCompare
  return Number(a.slice(1)) - Number(b.slice(1))
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort(numericIdSort)
}

function rangeIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `${prefix}${index + 1}`)
}

function blankAuditUniverse(): Record<AuditKind, Set<string>> {
  return {
    H: new Set<string>(),
    M: new Set<string>(),
    L: new Set<string>(),
    I: new Set<string>(),
  }
}

function blankActiveRiskUniverse(): Record<ActiveRiskKind, Set<string>> {
  return {
    H: new Set<string>(),
    M: new Set<string>(),
    L: new Set<string>(),
    I: new Set<string>(),
    K: new Set<string>(),
  }
}

function markdownTableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null

  const cells: string[] = []
  let cell = ''
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const char = trimmed[index]
    if (char === '|' && trimmed[index - 1] !== '\\') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += char
  }
  cells.push(cell.trim())

  if (!cells[0] || /^-+$/.test(cells[0])) return null
  return cells
}

/**
 * H/M/L/I ids are v3-scoped only when they appear as explicit finding headings
 * or as the first cell of a machine-readable audit table row.
 */
function auditFindingIdsByKind(text = readDoc(AUDIT_DOC)): Record<AuditKind, string[]> {
  const ids = blankAuditUniverse()

  for (const match of text.matchAll(/^###\s+([HMLI]\d+)\s+(?:-{1,2}|\u2014)\s+/gm)) {
    const id = match[1]
    ids[id[0] as AuditKind].add(id)
  }

  for (const line of text.split('\n')) {
    const cells = markdownTableCells(line)
    const match = cells?.[0].match(/^([HMLI]\d+)$/)
    if (!match) continue

    const id = match[1]
    ids[id[0] as AuditKind].add(id)
  }

  return {
    H: sortedIds(ids.H),
    M: sortedIds(ids.M),
    L: sortedIds(ids.L),
    I: sortedIds(ids.I),
  }
}

function allAuditIds(universe: Record<AuditKind, string[]>): string[] {
  return sortedIds(Object.values(universe).flat())
}

function activeRiskStatus(value: string): ActiveRiskStatus | null {
  if (value === 'PENDING' || value === 'DONE') return value
  return null
}

function activeRiskRoutingRows(text = readDoc(RISK_DOC)): ActiveRiskRoutingRow[] {
  const rows: ActiveRiskRoutingRow[] = []

  for (const line of text.split('\n')) {
    const cells = markdownTableCells(line)
    const id = cells?.[0]?.match(/^([HMLIK]\d+)$/)?.[1]
    if (!id) continue

    const routingCell = cells[1] ?? ''
    if (routingCell === 'no action') {
      rows.push({
        id,
        routing: 'no-action',
        phase: null,
        targetFix: cells[2] ?? '',
        status: null,
        rawRouting: routingCell,
        rawStatus: cells[3] ?? '',
      })
      continue
    }

    const rawStatus = cells[3] ?? ''
    const phaseMatch = /\[(\d+)\]\(/.exec(routingCell)
    rows.push({
      id,
      routing: 'scheduled',
      phase: phaseMatch ? Number(phaseMatch[1]) : null,
      targetFix: cells[2] ?? '',
      status: activeRiskStatus(rawStatus),
      rawRouting: routingCell,
      rawStatus,
    })
  }

  return rows
}

function activeRiskIdsByKind(rows = activeRiskRoutingRows()): Record<ActiveRiskKind, string[]> {
  const ids = blankActiveRiskUniverse()

  for (const row of rows) {
    ids[row.id[0] as ActiveRiskKind].add(row.id)
  }

  return {
    H: sortedIds(ids.H),
    M: sortedIds(ids.M),
    L: sortedIds(ids.L),
    I: sortedIds(ids.I),
    K: sortedIds(ids.K),
  }
}

function knownOverlapResidualRows(text = readDoc(RISK_DOC)): KnownOverlapResidual[] {
  return activeRiskRoutingRows(text)
    .filter((row) => row.id.startsWith('K') && row.routing === 'scheduled')
    .map((row) => ({
      id: row.id,
      phase: row.rawRouting,
      targetFix: row.targetFix,
      status: row.rawStatus,
    }))
}

function dismissedCandidateIds(text = readDoc(AUDIT_DOC)): string[] {
  const section = sectionOf(text, 'Investigated And Dismissed')
  const numbers = [...section.matchAll(/^(\d+)\.\s+\*\*/gm)].map((match) => Number(match[1]))
  numbers.sort((a, b) => a - b)
  return numbers.map((number) => `R${number}`)
}

function activeRiskDismissedCandidateIds(text = readDoc(RISK_DOC)): string[] {
  const section = sectionOf(text, 'Dismissed Candidates')
  return sortedIds([...section.matchAll(/^- (R\d+) - /gm)].map((match) => match[1]))
}

function v3DocUniverse(
  auditText = readDoc(AUDIT_DOC),
  riskText = readDoc(RISK_DOC),
): Record<V3DocKind, string[]> {
  const auditUniverse = auditFindingIdsByKind(auditText)
  return {
    ...auditUniverse,
    K: knownOverlapResidualRows(riskText).map((row) => row.id),
    R: dismissedCandidateIds(auditText),
  }
}

const EXPECTED_DOC_RANGES: Record<V3DocKind, string[]> = {
  H: rangeIds('H', 1),
  M: rangeIds('M', 9),
  L: rangeIds('L', 56),
  I: rangeIds('I', 23),
  K: rangeIds('K', 4),
  R: rangeIds('R', 5),
}

const EXPECTED_ACTIVE_RISK_RANGES: Record<ActiveRiskKind, string[]> = {
  H: EXPECTED_DOC_RANGES.H,
  M: EXPECTED_DOC_RANGES.M,
  L: EXPECTED_DOC_RANGES.L,
  I: EXPECTED_DOC_RANGES.I,
  K: EXPECTED_DOC_RANGES.K,
}

function collectIdRangeDriftProblems<K extends string>(
  universe: Record<K, string[]>,
  expected: Record<K, string[]>,
  label = 'ids',
): string[] {
  const problems: string[] = []

  for (const kind of Object.keys(expected) as K[]) {
    const actualIds = new Set(universe[kind])
    const expectedIds = new Set(expected[kind])
    const missing = expected[kind].filter((id) => !actualIds.has(id))
    const extra = universe[kind].filter((id) => !expectedIds.has(id))

    if (missing.length > 0) problems.push(`${kind}: missing ${label} ${missing.join(', ')}`)
    if (extra.length > 0) problems.push(`${kind}: unexpected ${label} ${extra.join(', ')}`)
  }

  return problems
}

function collectDocUniverseDriftProblems(
  universe: Record<V3DocKind, string[]> = v3DocUniverse(),
): string[] {
  return collectIdRangeDriftProblems(universe, EXPECTED_DOC_RANGES)
}

function collectActiveRiskUniverseDriftProblems(
  rows: ActiveRiskRoutingRow[] = activeRiskRoutingRows(),
): string[] {
  return collectIdRangeDriftProblems(
    activeRiskIdsByKind(rows),
    EXPECTED_ACTIVE_RISK_RANGES,
    'active-risk ids',
  )
}

describe('v3 fix-completeness gate doc universe', () => {
  it('points at the current docs/plan sources', () => {
    expect(AUDIT_DOC).toContain(path.join('docs', 'plan', 'audit-stability-and-performance-v3.md'))
    expect(RISK_DOC).toContain(path.join('docs', 'plan', 'active-risk-analysis.md'))
    expect(AUDIT_DOC).not.toContain(path.join('docs', 'archive'))
    expect(RISK_DOC).not.toContain(path.join('docs', 'archive'))
    expect(existsSync(AUDIT_DOC)).toBe(true)
    expect(existsSync(RISK_DOC)).toBe(true)
  })

  it('parses the exact H/M/L/I/K/R counts and sorted ranges', () => {
    const universe = v3DocUniverse()

    expect(universe.H).toHaveLength(1)
    expect(universe.H).toEqual(rangeIds('H', 1))

    expect(universe.M).toHaveLength(9)
    expect(universe.M).toEqual(rangeIds('M', 9))

    expect(universe.L).toHaveLength(56)
    expect(universe.L).toEqual(rangeIds('L', 56))

    expect(universe.I).toHaveLength(23)
    expect(universe.I).toEqual(rangeIds('I', 23))

    expect(universe.K).toHaveLength(4)
    expect(universe.K).toEqual(rangeIds('K', 4))

    expect(universe.R).toHaveLength(5)
    expect(universe.R).toEqual(rangeIds('R', 5))

    expect(collectDocUniverseDriftProblems(universe)).toEqual([])
  })

  it('parses active-risk routing rows for H/M/L/I/K and scheduled status markers', () => {
    const rows = activeRiskRoutingRows()
    const scheduledRows = rows.filter((row) => row.routing === 'scheduled')
    const noActionRows = rows.filter((row) => row.routing === 'no-action')

    expect(activeRiskIdsByKind(rows)).toEqual(EXPECTED_ACTIVE_RISK_RANGES)
    expect(scheduledRows.map((row) => row.id)).toEqual([
      ...rangeIds('H', 1),
      ...rangeIds('M', 9),
      ...rangeIds('L', 56),
      ...rangeIds('K', 4),
    ])
    expect(scheduledRows.map((row) => row.status)).toEqual(
      Array.from({ length: 70 }, () => 'PENDING'),
    )
    expect(noActionRows.map((row) => row.id)).toEqual(rangeIds('I', 23))
    expect(collectActiveRiskUniverseDriftProblems(rows)).toEqual([])
  })

  it('recognizes a fake new scheduled active-risk id as doc drift', () => {
    const riskText = `${readDoc(RISK_DOC)}
| M10 | [2](phases/phase-2-command-surface-scoping.md) | fake drift | PENDING |
`
    const rows = activeRiskRoutingRows(riskText)

    expect(rows.find((row) => row.id === 'M10')?.status).toBe('PENDING')
    expect(collectActiveRiskUniverseDriftProblems(rows)).toEqual([
      'M: unexpected active-risk ids M10',
    ])
  })

  it('accepts heading separators and table rows without mining prior-audit prose', () => {
    const auditText = `
### H1 - high separator
Mentions v2-L12 and v1-L4 in prose only.
### M1 -- double hyphen separator
| L1 | Low | perf | server | table row |
### I1 \u2014 em dash separator
| Known item | v2-L16 | Low | overlap evidence |
`
    const universe = auditFindingIdsByKind(auditText)

    expect(universe).toEqual({
      H: ['H1'],
      M: ['M1'],
      L: ['L1'],
      I: ['I1'],
    })
    expect(allAuditIds(universe)).not.toContain('L12')
    expect(allAuditIds(universe)).not.toContain('L4')
    expect(allAuditIds(universe)).not.toContain('L16')
  })

  it('collects K residuals from active-risk and treats audit overlaps as evidence', () => {
    const rows = knownOverlapResidualRows()
    const overlapEvidenceUniverse = auditFindingIdsByKind(
      sectionOf(readDoc(AUDIT_DOC), 'Known-Item Overlaps'),
    )

    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.id)).toEqual(rangeIds('K', 4))
    expect(rows.map((row) => row.status)).toEqual(['PENDING', 'PENDING', 'PENDING', 'PENDING'])
    expect(rows[0].targetFix).toContain('v2-R5 re-open')
    expect(allAuditIds(overlapEvidenceUniverse)).toEqual([])
  })

  it('parses dismissed candidates from both current v3 doc sources', () => {
    expect(dismissedCandidateIds()).toEqual(rangeIds('R', 5))
    expect(activeRiskDismissedCandidateIds()).toEqual(rangeIds('R', 5))
  })
})
