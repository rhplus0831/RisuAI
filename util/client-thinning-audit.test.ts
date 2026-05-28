import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const auditScript = path.join(repoRoot, 'util/client-thinning-audit.ts')
const tsxBin = path.join(repoRoot, 'node_modules/.bin/tsx')
const fixturesRoot = path.join(repoRoot, 'util/client-thinning-audit-fixtures')

interface AuditResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

function runAuditFixture(fixtureName: string, checkId: string): Promise<AuditResult> {
  const cwd = path.join(fixturesRoot, fixtureName)
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [auditScript], {
      cwd,
      env: {
        ...process.env,
        CLIENT_THINNING_AUDIT_CHECK_IDS: checkId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr })
    })
  })
}

describe('client-thinning audit fixtures', () => {
  const saveAssetCheck = 'A4R-saveasset filename classification'

  it('fails a fixture with an unclassified saveAsset call', async () => {
    const result = await runAuditFixture(
      'saveasset-filename-classification/failing',
      saveAssetCheck,
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${saveAssetCheck}]`)
    expect(result.stderr).toContain('calls saveAsset(bytes) without a filename')
  })

  it('allows a documented image-default saveAsset call', async () => {
    const result = await runAuditFixture(
      'saveasset-filename-classification/image-default-bypass',
      saveAssetCheck,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })
})
