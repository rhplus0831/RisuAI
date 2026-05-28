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
  const compositeFanoutCheck = 'A4R-fanout composite command race'
  const resolverNormalizeCheck = 'A4R4 globally-addressed resolver normalize'
  const parserParityCheck = 'A4R5 asset reference parser parity'
  const wildcardSecretCheck = 'A4R6 wildcard secret row identity'
  const idMintingCheck = 'A4R3 transitive command-path id minting'
  const conflictReplayCheck = 'A4R2 conflict replay outside central wrapper'
  const passiveRefreshCheck = 'A4R1 passive refresh writer ownership'
  const assetWalkerCheck = 'EC6 asset walker validator drift'
  const activeWriterGuardCheck = 'EC5 active-writer guard'

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

  it('fails a fixture that fans out two mutating dispatches in one scope', async () => {
    const result = await runAuditFixture(
      'composite-command-fanout/failing',
      compositeFanoutCheck,
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${compositeFanoutCheck}]`)
    expect(result.stderr).toContain(
      'src/ts/process/triggers.ts function applyTriggerEdits dispatches 2 mutating commands (dispatchAppendMessage, dispatchUpdateMessage) without serialization.',
    )
  })

  it('allows fan-out routed through a sequencer or an awaited dispatch chain', async () => {
    const result = await runAuditFixture(
      'composite-command-fanout/serialized-bypass',
      compositeFanoutCheck,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })

  it('fails a fixture that resolves a global location before normalizing ids', async () => {
    const result = await runAuditFixture('resolver-normalize/failing', resolverNormalizeCheck)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${resolverNormalizeCheck}]`)
    expect(result.stderr).toContain(
      'server/fastify/src/commands/chats.ts renameChatByGlobalId calls requireChatLocation() without first calling normalizeAllCharacterChats() in the same scope.',
    )
    expect(result.stderr).toContain(
      'server/fastify/src/commands/messages.ts editMessageByGlobalId calls requireMessageLocation() without first calling normalizeAllChatMessages() in the same scope.',
    )
  })

  it('allows normalize-then-resolve order in the same scope', async () => {
    const result = await runAuditFixture(
      'resolver-normalize/normalize-first-bypass',
      resolverNormalizeCheck,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })

  it('fails a fixture where the walker regex drifts from the client parser', async () => {
    const result = await runAuditFixture('asset-reference-parser-parity/failing', parserParityCheck)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${parserParityCheck}]`)
    expect(result.stderr).toContain(
      'Walker addReference does not contain a regex literal equal to client LOCAL_ASSET_PATH_RE',
    )
  })

  it('allows a walker regex literal identical to the client parser', async () => {
    const result = await runAuditFixture(
      'asset-reference-parser-parity/parity-bypass',
      parserParityCheck,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })

  it('fails a fixture with a wildcard object-array secret missing a row identity key', async () => {
    const result = await runAuditFixture('wildcard-secret-row-identity/failing', wildcardSecretCheck)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${wildcardSecretCheck}]`)
    expect(result.stderr).toContain(
      'Wildcard array secret customModels in SECRET_PATHS has no entry in ARRAY_ROW_IDENTITY_KEYS.',
    )
  })

  it('allows wildcard array secrets that all declare a stable row identity', async () => {
    const result = await runAuditFixture(
      'wildcard-secret-row-identity/classified-bypass',
      wildcardSecretCheck,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })

  it('fails a fixture that mints command-path ids directly and transitively', async () => {
    const result = await runAuditFixture('transitive-command-id-minting/failing', idMintingCheck)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${idMintingCheck}]`)
    expect(result.stderr).toContain(
      'POST /api/v1/commands/messages mints durable ids directly in the route handler.',
    )
    expect(result.stderr).toContain(
      'POST /api/v1/commands/chats calls createChatRecord() which transitively reaches a propagating mint',
    )
  })

  it('allows command routes that take ids from validated params with normalize-on-read', async () => {
    const result = await runAuditFixture(
      'transitive-command-id-minting/validated-id-bypass',
      idMintingCheck,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })

  it('fails a fixture that replays a conflict outside the central wrapper', async () => {
    const result = await runAuditFixture('conflict-replay/failing', conflictReplayCheck)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${conflictReplayCheck}]`)
    expect(result.stderr).toContain(
      "src/ts/chatCommands.ts function applyMessageEdit branches on result.status === 'conflict' and resends a mutating command.",
    )
  })

  it('allows surfacing a conflict and exempts the central command wrapper', async () => {
    const result = await runAuditFixture(
      'conflict-replay/surface-conflict-bypass',
      conflictReplayCheck,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })

  it('fails a fixture where a passive refresh path calls the writer bootstrap helper', async () => {
    const result = await runAuditFixture(
      'passive-refresh-writer-ownership/failing-passive-caller',
      passiveRefreshCheck,
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${passiveRefreshCheck}]`)
    expect(result.stderr).toContain(
      'src/ts/server/commands.ts calls writer-mode bootstrap helper fetchServerBootstrapProjection;',
    )
  })

  it('fails a fixture where a read-only bootstrap helper attaches the writer header', async () => {
    const result = await runAuditFixture(
      'passive-refresh-writer-ownership/failing-readonly-header',
      passiveRefreshCheck,
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${passiveRefreshCheck}]`)
    expect(result.stderr).toContain(
      'refreshServerProjection is a non-writer bootstrap helper but still attaches activeWriterSessionHeader().',
    )
  })

  it('allows the writer helper when only the page-load entrypoint calls it', async () => {
    const result = await runAuditFixture(
      'passive-refresh-writer-ownership/writer-intent-bypass',
      passiveRefreshCheck,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })

  it('fails a fixture with an asset walker field that lacks validator ownership', async () => {
    const result = await runAuditFixture(
      'asset-walker-validator-drift/failing-missing-owner',
      assetWalkerCheck,
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${assetWalkerCheck}]`)
    expect(result.stderr).toContain(
      'Asset walker fields lack validator ownership: addReference root.legacyAvatar -> database.legacyAvatar.',
    )
  })

  it('allows a walker whose fields all map to an owned validator with its needles', async () => {
    const result = await runAuditFixture('asset-walker-validator-drift/owned-bypass', assetWalkerCheck)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })

  it('fails a fixture with an unclassified mutating Fastify route', async () => {
    const result = await runAuditFixture(
      'active-writer-guard/failing-unclassified-route',
      activeWriterGuardCheck,
    )

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`[${activeWriterGuardCheck}]`)
    expect(result.stderr).toContain('Unclassified mutating Fastify route: POST /api/v1/widgets.')
  })

  it('allows a fully classified mutating route surface with the guard wired in order', async () => {
    const result = await runAuditFixture(
      'active-writer-guard/classified-bypass',
      activeWriterGuardCheck,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Client-thinning audit passed.')
    expect(result.stderr).toBe('')
  })
})
