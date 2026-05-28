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
  const backupInventoryCheck = 'A4R-backup data dir inventory'
  const boundedAccumulatorCheck = 'A4R-bounded process-lifetime accumulators'
  const assetUrlGateCheck = 'A4R7 asset URL gate'
  const saveAssetCheck = 'A4R-saveasset filename classification'

  it('fails a fixture with a data dir child omitted from backup and restore', async () => {
    const result = await runAuditFixture(
      'backup-data-dir-inventory/failing',
      backupInventoryCheck,
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${backupInventoryCheck}]`)
    expect(result.stderr).toContain(
      'createBackup must reference "secrets" (declared in KNOWN_DATA_DIR_CHILDREN).',
    )
    expect(result.stderr).toContain(
      'restoreBackup must reference "secrets" (declared in KNOWN_DATA_DIR_CHILDREN).',
    )
  })

  it('fails a fixture with an unclassified exported process-lifetime accumulator', async () => {
    const result = await runAuditFixture(
      'bounded-process-lifetime-accumulators/failing',
      boundedAccumulatorCheck,
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${boundedAccumulatorCheck}]`)
    expect(result.stderr).toContain(
      'Top-level Map pendingRequestState in server/fastify/src/routes/sessionCache.ts is a process-lifetime accumulator',
    )
  })

  it('allows a documented bounded process-lifetime accumulator', async () => {
    const result = await runAuditFixture(
      'bounded-process-lifetime-accumulators/bounded-bypass',
      boundedAccumulatorCheck,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })

  it('fails a fixture that fetches arbitrary asset loc values with server auth', async () => {
    const result = await runAuditFixture(
      'asset-url-gate/failing-authenticated-loc-fetch',
      assetUrlGateCheck,
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${assetUrlGateCheck}]`)
    expect(result.stderr).toContain(
      'readServerAssetBytes in src/ts/server/assets.ts falls back to fetching arbitrary loc values while attaching risu-auth.',
    )
  })

  it('fails a fixture that returns unknown asset URL shapes in Fastify mode', async () => {
    const result = await runAuditFixture(
      'asset-url-gate/failing-fastify-url-fallback',
      assetUrlGateCheck,
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${assetUrlGateCheck}]`)
    expect(result.stderr).toContain(
      "getFileSrc in src/ts/globalApi.svelte.ts falls back to `?? loc` for unknown asset shapes",
    )
  })

  it('allows documented Fastify asset URL shapes with an explicit unknown default', async () => {
    const result = await runAuditFixture('asset-url-gate/documented-shapes', assetUrlGateCheck)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })

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
