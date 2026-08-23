import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createInitialPreloadReport,
  formatInitialPreloadReport,
  type InitialPreloadBudgets,
} from './initial-preload-report.js'

let distDir: string

function write(relativePath: string, contents: string | Buffer): void {
  const target = path.join(distDir, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}

function html(head: string): string {
  return `<!doctype html><html><head>${head}</head><body></body></html>`
}

beforeEach(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-initial-preload-report-'))
})

afterEach(() => {
  fs.rmSync(distDir, { recursive: true, force: true })
})

describe('initial preload report', () => {
  it('deduplicates preloads and reports exact raw and gzip totals', () => {
    const entry = 'export const entry = "entry"\n'
    const chunk = 'export const chunk = "chunk"\n'.repeat(4)
    write(
      'index.html',
      html(
        '<script type="module" src="/assets/entry.js"></script><link rel="modulepreload" href="/assets/chunk.js"><link href="/assets/chunk.js" rel="modulepreload">',
      ),
    )
    write('assets/entry.js', entry)
    write('assets/chunk.js', chunk)

    const report = createInitialPreloadReport(distDir)

    expect(report.fileCount).toBe(2)
    expect(report.rawBytes).toBe(Buffer.byteLength(entry) + Buffer.byteLength(chunk))
    expect(report.gzipBytes).toBe(gzipSync(entry, { level: 9 }).byteLength + gzipSync(chunk, { level: 9 }).byteLength)
    expect(report.files.map((file) => [file.role, file.path])).toEqual([
      ['entry', 'assets/entry.js'],
      ['modulepreload', 'assets/chunk.js'],
    ])
  })

  it('resolves encoded and nested path segments within dist', () => {
    write(
      'index.html',
      html(
        '<script type="module" src="/assets/entry.js"></script><link rel="modulepreload" href="/assets/nested%20dir/chunk.js">',
      ),
    )
    write('assets/entry.js', 'entry')
    write('assets/nested dir/chunk.js', 'nested')

    expect(createInitialPreloadReport(distDir).files.map((file) => file.path)).toEqual([
      'assets/entry.js',
      'assets/nested dir/chunk.js',
    ])
  })

  it('fails deterministically for missing and escaping files', () => {
    write('index.html', html('<script type="module" src="/assets/missing.js"></script>'))
    expect(() => createInitialPreloadReport(distDir)).toThrow('Missing initial JavaScript file: assets/missing.js')

    write('index.html', html('<script type="module" src="/%2e%2e/outside.js"></script>'))
    expect(() => createInitialPreloadReport(distDir)).toThrow('Initial JavaScript path escapes dist')
  })

  it('reports regression ceilings separately from milestone targets', () => {
    write('index.html', html('<script type="module" src="/entry.js"></script>'))
    write('entry.js', 'large enough to gzip')
    const gzipBytes = gzipSync('large enough to gzip', { level: 9 }).byteLength
    const budgets: InitialPreloadBudgets = {
      schemaVersion: 1,
      regressionCeilings: { totalGzipBytes: gzipBytes, largestChunkGzipBytes: gzipBytes },
      milestoneTargets: { totalGzipBytes: gzipBytes - 1, largestChunkGzipBytes: gzipBytes - 1 },
    }

    const report = createInitialPreloadReport(distDir, budgets)

    expect(report.budgets).toEqual({
      regressionCeilings: { ...budgets.regressionCeilings, passes: true },
      milestoneTargets: { ...budgets.milestoneTargets, passes: false },
    })
    expect(formatInitialPreloadReport(report)).toContain('Regression ceilings: PASS')
    expect(formatInitialPreloadReport(report)).toContain('Milestone targets: NOT YET')
  })
})
