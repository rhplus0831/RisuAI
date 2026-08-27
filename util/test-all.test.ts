import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { uiCoverageTestFiles } from '../vitest.ui-coverage-tests.js'
import { parseTestAllJobs, qualityLanes, runLanePool, type QualityLane, type QualityLaneResult } from './test-all.js'

describe('test:all orchestration', () => {
  it('uses bounded concurrency and validates the jobs override', () => {
    expect(parseTestAllJobs(undefined)).toBe(2)
    expect(parseTestAllJobs('4')).toBe(4)
    expect(() => parseTestAllJobs('0')).toThrow('positive integer')
  })

  it('keeps dist and duplicate-test conflicts ordered and performance gates isolated', () => {
    const byId = new Map(qualityLanes.map((lane) => [lane.id, lane]))

    expect(byId.get('browser-smoke')).toMatchObject({ after: ['server-check'], isolated: true })
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
})
