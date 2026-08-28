import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { uiCoverageSupportFiles, uiCoverageTestFiles } from '../vitest.ui-coverage-tests.js'
import { performanceTestFiles } from '../vitest.performance-tests.js'
import {
  parseTestAllJobs,
  qualityLanes,
  runLanePool,
  validateQualityLanePhases,
  type QualityLane,
  type QualityLaneResult,
} from './test-all.js'

describe('test:all orchestration', () => {
  it('uses bounded concurrency and validates the jobs override', () => {
    expect(parseTestAllJobs(undefined)).toBe(2)
    expect(parseTestAllJobs('4')).toBe(4)
    expect(() => parseTestAllJobs('0')).toThrow('positive integer')
  })

  it('keeps dist and duplicate-test conflicts ordered and performance gates isolated', () => {
    const byId = new Map(qualityLanes.map((lane) => [lane.id, lane]))

    expect(byId.get('browser-smoke')).toMatchObject({ after: ['server-check'], isolated: true })
    expect(byId.get('frontend-routing')?.args).toEqual(['check:test-inventories'])
    expect(byId.get('frontend-tests')?.args).toEqual(['test:frontend:run'])
    expect(byId.get('frontend-tests')?.env).toEqual({ RISU_TEST_EXCLUDE_UI_MAP: 'true' })
    expect(byId.get('ui-coverage')?.after).toContain('frontend-tests')
    expect(byId.get('server-tests')?.isolated).toBe(true)
    expect(byId.has('audit-gates')).toBe(false)
    expect(byId.get('performance-gates')).toMatchObject({
      isolated: true,
      args: ['test:gates:perf', '--no-file-parallelism', '--maxWorkers=1'],
    })

    const packageScripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>
    expect(packageScripts['coverage:ui-map'].match(/src\/\S+\.test\.ts/g)).toEqual([...uiCoverageTestFiles])
    expect(packageScripts['test:gates:perf'].match(/src\/\S+\.test\.ts/g)).toEqual([...performanceTestFiles])
  })

  it('starts dependents after completion even when a prerequisite fails', async () => {
    const lanes: QualityLane[] = [
      { id: 'first', label: 'first', args: [] },
      { id: 'independent', label: 'independent', args: [] },
      { id: 'dependent', label: 'dependent', args: [], after: ['first'] },
    ]
    const events: string[] = []
    let active = 0
    let peakActive = 0

    const results = await runLanePool(lanes, 2, async (lane): Promise<QualityLaneResult> => {
      events.push(`start:${lane.id}`)
      active += 1
      peakActive = Math.max(peakActive, active)
      await Promise.resolve()
      active -= 1
      events.push(`finish:${lane.id}`)
      return { id: lane.id, exitCode: lane.id === 'first' ? 1 : 0, elapsedMs: 0 }
    })

    expect(peakActive).toBe(2)
    expect(events.indexOf('start:dependent')).toBeGreaterThan(events.indexOf('finish:first'))
    expect(results.map((result) => result.exitCode)).toEqual([1, 0, 0])
  })

  it('rejects dependency cycles', async () => {
    const lanes: QualityLane[] = [
      { id: 'first', label: 'first', args: [], after: ['second'] },
      { id: 'second', label: 'second', args: [], after: ['first'] },
    ]

    await expect(runLanePool(lanes, 2, async (lane) => ({ id: lane.id, exitCode: 0, elapsedMs: 0 }))).rejects.toThrow(
      'dependency cycle',
    )
  })

  it('validates the regular-to-isolated phase barrier and isolated order', () => {
    expect(() => validateQualityLanePhases(qualityLanes)).not.toThrow()
    expect(() =>
      validateQualityLanePhases([
        { id: 'isolated', label: 'isolated', args: [], isolated: true },
        { id: 'regular', label: 'regular', args: [], after: ['isolated'] },
      ]),
    ).toThrow('regular quality lane regular cannot depend on isolated')
    expect(() =>
      validateQualityLanePhases([
        { id: 'later', label: 'later', args: [], isolated: true, after: ['earlier'] },
        { id: 'earlier', label: 'earlier', args: [], isolated: true },
      ]),
    ).toThrow('must appear after its isolated dependency')
  })

  it('keeps every local aggregate owner required by CI', () => {
    const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
    const ciOwners = new Map([
      ['frontend-routing', ['frontend-routing', 'pnpm check:test-inventories']],
      ['server-check', ['check-server', 'pnpm check:server']],
      ['frontend-tests', ['frontend', 'pnpm test:frontend:run']],
      ['server-tests', ['server', 'pnpm test:server']],
      ['browser-smoke', ['smoke', 'pnpm test:smoke']],
      ['frontend-check', ['check', 'pnpm check']],
      ['ui-coverage', ['ui-coverage', 'pnpm coverage:ui-map']],
      ['format', ['format', 'pnpm format:check']],
      ['performance-gates', ['gates-perf', 'pnpm test:gates:perf --no-file-parallelism --maxWorkers=1']],
    ] as const)
    const verifySection = workflow.slice(workflow.indexOf('\n  verify:'))

    expect(new Set(ciOwners.keys())).toEqual(new Set(qualityLanes.map((lane) => lane.id)))
    for (const [lane, [job, command]] of ciOwners) {
      expect(workflow, `${lane} command`).toContain(`- run: ${command}`)
      expect(verifySection, `${job} verify dependency`).toContain(`- ${job}`)
    }
    expect(verifySection).toContain('- initial-preload')
    const smokeUpload = workflow.slice(
      workflow.indexOf('name: playwright-test-results'),
      workflow.indexOf('\n\n  verify:'),
    )
    expect(smokeUpload).toContain('fast-bootstrap-results/phase7-integration.*')
    expect(smokeUpload).toContain('if-no-files-found: error')
    const uiUpload = workflow.slice(workflow.indexOf('name: ui-coverage'), workflow.indexOf('\n\n  server:'))
    expect(uiUpload).toContain('if-no-files-found: error')
  })

  it('excludes every checked UI test harness from coverage denominators', () => {
    const support = JSON.parse(
      readFileSync('docs/plan/test-suite-effectiveness-audit/support-artifacts.json', 'utf8'),
    ) as { groups: Array<{ role: string; files: string[] }> }
    const uiRoots = /^(?:src\/lib\/(?:ChatScreens|Others|SideBars)|src\/ts\/server)\//
    const expected = support.groups
      .find((group) => group.role === 'shared-helper-harness')!
      .files.filter((file) => uiRoots.test(file))
      .sort()

    expect([...uiCoverageSupportFiles].sort()).toEqual(expected)
  })
})
