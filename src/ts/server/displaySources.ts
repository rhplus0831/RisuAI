import { sha256Hex } from '../sha256Fallback'
import { isPluginRuntimeReady, pluginV2 } from '../plugins/plugins.svelte'
import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse, isWriterAccessLost } from './activeWriterSession'
import {
  peekCachedServerCommandRevision,
  runExternalServerRevisionOperation,
  setCachedServerCommandRevision,
} from './commands'
import { readBrowserClientContext } from '../process/request/clientContext'
import {
  DISPLAY_SOURCE_LIMITS,
  DISPLAY_SOURCE_PROTOCOL_VERSION,
  displaySourceNamespaceJson,
  stableDisplayDependencyJson,
  type DisplayRequestContext,
  type DisplaySourceLayer,
  type DisplaySourceResponse,
  type DisplaySourceTarget,
} from '../process/displaySourceProtocol'

const SERVER_DATABASE_LINEAGE_HEADER = 'risu-database-lineage'

export interface ServerDisplaySourceInput {
  chatId: string
  character: { chaId: string; name?: string }
  messageId?: string
  index: number
  role: string | null
  firstMessage: boolean
  layer: DisplaySourceLayer
  source: string
  streaming?: boolean
  name?: string
}

export type ServerDisplaySourceResult =
  | { status: 'ok'; displaySource: string; dependencyFingerprint: string }
  | { status: 'fallback'; reason: string }

interface PendingDisplaySource {
  target: DisplaySourceTarget
  expectedContextFingerprint: string
  resolve: (result: ServerDisplaySourceResult) => void
}

let protocolVersion = 0
let databaseLineage: string | null = null
let activeWriterEpoch: number | null = null
let projectionEpoch = 0
const pendingByBatch = new Map<string, PendingDisplaySource[]>()
const scheduledBatches = new Set<string>()
const pageSessionId = createPageSessionId()

function createPageSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function createRequestKey(epoch: number, sourceHash: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${epoch}:${sourceHash.slice(0, 16)}:${random}`.slice(0, DISPLAY_SOURCE_LIMITS.maxRequestKeyLength)
}

export function configureDisplaySourceProtocol(
  protocol: { version: number } | undefined,
  lineage?: string,
  writerEpoch?: number,
): void {
  protocolVersion = protocol?.version === DISPLAY_SOURCE_PROTOCOL_VERSION ? DISPLAY_SOURCE_PROTOCOL_VERSION : 0
  databaseLineage = typeof lineage === 'string' && lineage.length > 0 ? lineage : null
  activeWriterEpoch = Number.isSafeInteger(writerEpoch) && (writerEpoch as number) >= 0 ? (writerEpoch as number) : null
}

export function canUseDisplaySourceProtocol(): boolean {
  return (
    protocolVersion === DISPLAY_SOURCE_PROTOCOL_VERSION &&
    databaseLineage !== null &&
    activeWriterEpoch !== null &&
    !isWriterAccessLost()
  )
}

export function resetDisplaySourceClientForTests(): void {
  protocolVersion = 0
  databaseLineage = null
  activeWriterEpoch = null
  projectionEpoch = 0
  for (const pending of pendingByBatch.values()) {
    for (const item of pending) item.resolve({ status: 'fallback', reason: 'client_reset' })
  }
  pendingByBatch.clear()
  scheduledBatches.clear()
}

export async function requestServerDisplaySource(input: ServerDisplaySourceInput): Promise<ServerDisplaySourceResult> {
  if (isPluginRuntimeReady() && pluginV2.editdisplay.size > 0) {
    return { status: 'fallback', reason: 'browser_editdisplay_plugin' }
  }
  if (!canUseDisplaySourceProtocol()) return { status: 'fallback', reason: 'protocol_unavailable' }
  if (!input.chatId || !input.character?.chaId) return { status: 'fallback', reason: 'target_unavailable' }
  if (new TextEncoder().encode(input.source).byteLength > DISPLAY_SOURCE_LIMITS.maxSourceBytes) {
    return { status: 'fallback', reason: 'source_oversize' }
  }

  const context: DisplayRequestContext = { pageSessionId, ...readBrowserClientContext() }
  const sourceHash = await sha256Hex(input.source)
  const epoch = ++projectionEpoch
  const target: DisplaySourceTarget = {
    requestKey: createRequestKey(epoch, sourceHash),
    characterId: input.character.chaId,
    ...(input.messageId ? { messageId: input.messageId } : {}),
    index: input.index,
    role: input.role,
    firstMessage: input.firstMessage,
    layer: input.layer,
    source: input.source,
    sourceHash,
    projectionEpoch: epoch,
    ...(input.streaming === true ? { streaming: true } : {}),
    ...(input.name ? { name: input.name } : {}),
  }
  const configuredLineage = databaseLineage!
  const configuredWriterEpoch = activeWriterEpoch!
  const expectedContextFingerprint = await sha256Hex(
    displaySourceNamespaceJson({
      databaseLineage: configuredLineage,
      activeWriterEpoch: configuredWriterEpoch,
      context,
    }),
  )
  const batchKey = stableDisplayDependencyJson({
    chatId: input.chatId,
    context,
    configuredLineage,
    configuredWriterEpoch,
  })

  return new Promise<ServerDisplaySourceResult>((resolve) => {
    const pending = pendingByBatch.get(batchKey) ?? []
    if (target.streaming) {
      const supersededIndex = pending.findIndex(
        (item) =>
          item.target.streaming === true &&
          item.target.characterId === target.characterId &&
          item.target.messageId === target.messageId &&
          item.target.index === target.index &&
          item.target.layer === target.layer,
      )
      if (supersededIndex >= 0) {
        const [superseded] = pending.splice(supersededIndex, 1)
        superseded.resolve({
          status: 'ok',
          displaySource: superseded.target.source,
          dependencyFingerprint: 'streaming_projection_superseded',
        })
      }
    }
    pending.push({ target, expectedContextFingerprint, resolve })
    pendingByBatch.set(batchKey, pending)
    if (scheduledBatches.has(batchKey)) return
    scheduledBatches.add(batchKey)
    setTimeout(() => {
      scheduledBatches.delete(batchKey)
      const batch = pendingByBatch.get(batchKey) ?? []
      pendingByBatch.delete(batchKey)
      void flushDisplaySourceBatch(input.chatId, context, configuredLineage, batch)
    }, 0)
  })
}

async function flushDisplaySourceBatch(
  chatId: string,
  context: DisplayRequestContext,
  configuredLineage: string,
  pending: PendingDisplaySource[],
): Promise<void> {
  if (pending.length === 0) return
  const ordered = [...pending].sort(
    (left, right) =>
      left.target.index - right.target.index ||
      left.target.layer.localeCompare(right.target.layer) ||
      left.target.requestKey.localeCompare(right.target.requestKey),
  )
  let executed = false
  try {
    const execution = await runExternalServerRevisionOperation(async () => {
      for (let offset = 0; offset < ordered.length; offset += DISPLAY_SOURCE_LIMITS.maxTargets) {
        await flushDisplaySourceChunk(
          chatId,
          context,
          configuredLineage,
          ordered.slice(offset, offset + DISPLAY_SOURCE_LIMITS.maxTargets),
        )
      }
    })
    executed = execution.status === 'executed'
  } catch {
    for (const item of ordered) item.resolve({ status: 'fallback', reason: 'network_error' })
    return
  }
  if (!executed) {
    for (const item of ordered) item.resolve({ status: 'fallback', reason: 'revision_unavailable' })
  }
}

async function flushDisplaySourceChunk(
  chatId: string,
  context: DisplayRequestContext,
  configuredLineage: string,
  pending: PendingDisplaySource[],
): Promise<void> {
  const fallbackAll = (reason: string) => {
    for (const item of pending) item.resolve({ status: 'fallback', reason })
  }
  if (!canUseDisplaySourceProtocol() || databaseLineage !== configuredLineage) {
    fallbackAll('display_namespace_changed')
    return
  }

  let auth: string
  try {
    auth = await getNodeServerProxyAuth()
  } catch {
    fallbackAll('auth_unavailable')
    return
  }

  const baseRevision = peekCachedServerCommandRevision()
  if (baseRevision === null) {
    fallbackAll('revision_unavailable')
    return
  }

  let response: Response
  try {
    response = await fetch(`/api/v1/chats/${encodeURIComponent(chatId)}/display-sources`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'risu-auth': auth,
        [SERVER_DATABASE_LINEAGE_HEADER]: configuredLineage,
        ...activeWriterSessionHeader(),
      },
      body: JSON.stringify({
        protocolVersion: DISPLAY_SOURCE_PROTOCOL_VERSION,
        baseRevision,
        context,
        targets: pending.map((item) => item.target),
      }),
    })
  } catch {
    fallbackAll('network_error')
    return
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    handleActiveWriterStaleResponse(response, body)
    if (
      response.status === 409 &&
      body &&
      typeof body === 'object' &&
      Number.isSafeInteger((body as { currentRevision?: unknown }).currentRevision)
    ) {
      setCachedServerCommandRevision((body as { currentRevision: number }).currentRevision)
    }
    fallbackAll(response.status === 409 ? 'revision_conflict' : `http_${response.status}`)
    return
  }
  if (!isDisplaySourceResponse(body)) {
    fallbackAll('invalid_response')
    return
  }
  setCachedServerCommandRevision(body.revision)

  const entries = new Map(body.entries.map((entry) => [entry.requestKey, entry]))
  for (const item of pending) {
    const entry = entries.get(item.target.requestKey)
    if (
      body.contextFingerprint !== item.expectedContextFingerprint ||
      !entry ||
      entry.sourceHash !== item.target.sourceHash
    ) {
      item.resolve({ status: 'fallback', reason: 'stale_response' })
      continue
    }
    if (entry.status !== 'ok') {
      item.resolve({ status: 'fallback', reason: entry.reason })
      continue
    }
    item.resolve({
      status: 'ok',
      displaySource: entry.displaySource,
      dependencyFingerprint: entry.dependencyFingerprint,
    })
  }
}

function isDisplaySourceResponse(value: unknown): value is DisplaySourceResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (
    record.protocolVersion !== DISPLAY_SOURCE_PROTOCOL_VERSION ||
    !Number.isSafeInteger(record.revision) ||
    (record.revision as number) < 0 ||
    typeof record.contextFingerprint !== 'string' ||
    !Array.isArray(record.entries)
  ) {
    return false
  }
  return record.entries.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const row = entry as Record<string, unknown>
    if (typeof row.requestKey !== 'string' || typeof row.sourceHash !== 'string' || typeof row.status !== 'string') {
      return false
    }
    return row.status === 'ok'
      ? typeof row.displaySource === 'string' && typeof row.dependencyFingerprint === 'string'
      : (row.status === 'client_fallback' || row.status === 'stale' || row.status === 'error') &&
          typeof row.reason === 'string'
  })
}
