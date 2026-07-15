import {
  captureSettingsPatchProjectionEpochs,
  getResourceDatabase as getDatabase,
} from 'src/ts/server/resourceState.svelte'
import { MCPClient, type JsonRPC, type MCPRefreshTokenSource, type MCPTool, type RPCToolCallContent } from './mcplib'
import { getModuleMcps } from '../modules'
import {
  canUseServerCommands,
  patchServerBackedSettings,
  type PatchServerBackedSettingsInput,
} from '../../server/commands'
import { withTrustedResourceWrite } from '../../server/resourceWriteGuard.svelte'
import { alertError, alertInput, alertNormal } from 'src/ts/alert'
import { v4 } from 'uuid'
import type { MCPClientLike } from './internalmcp'
import localforage from 'localforage'
import { sleep } from 'src/ts/util'
import {
  registeredCustomPluginMCPs,
  setCustomPluginMCPRegistryReconciler,
  type CustomPluginMCPRegistryChange,
} from './pluginmcp'
import { applyAttemptedFieldRollback } from '../../server/staleStateGuards'
import { isMaskedProviderSecret } from '../../providerSecretMask'
import { requestStoredMcpOAuthRefresh } from '../../server/mcpOAuthRefresh'

export type MCPToolWithURL = MCPTool & {
  mcpURL: string
}

export const MCPs: Record<string, MCPClient | MCPClientLike> = {}
export const callOnlyMCPs: Record<string, MCPClient | MCPClientLike> = {}
const callOnlyMCPUrls = ['internal:risuai']

type MCPRegistryClient = MCPClient | MCPClientLike
type MCPToolDispatchTarget = {
  mcpURL: string
  client: MCPRegistryClient
}

let initializedMCPInputSignature: string | null = null
let mcpToolClientIndex: Map<string, MCPToolDispatchTarget> | null = null
let mcpToolClientIndexBuild: Promise<Map<string, MCPToolDispatchTarget>> | null = null
let mcpToolClientIndexGeneration = 0
let mcpInitializationDepth = 0
let mcpInitializationIdleWaiters: Array<() => void> = []
const mcpClientInitializationBuilds = new Map<string, Promise<void>>()

setCustomPluginMCPRegistryReconciler(reconcileCustomPluginMCPRegistryChange)

type MCPRefreshToken = {
  clientId: string
  clientSecret: string
  refreshToken: string
  tokenUrl: string
}

type StoredMCPRefreshToken = MCPRefreshToken & {
  url: string
}

type PendingMCPRefreshTokenPersistence = {
  attempted: StoredMCPRefreshToken[]
  attemptedToken: StoredMCPRefreshToken
  commandInput: PatchServerBackedSettingsInput
  previous: StoredMCPRefreshToken[]
  sequence: number
}

const pendingMCPRefreshTokenPersistences: PendingMCPRefreshTokenPersistence[] = []
let nextMCPRefreshTokenPersistenceSequence = 0

export async function initializeMCPs(additionalMCPs?: string[]) {
  beginMCPInitialization()
  try {
    const db = getDatabase()
    const mcpUrls = getModuleMcps()
    if (additionalMCPs && additionalMCPs.length > 0) {
      for (const mcp of additionalMCPs) {
        if (!mcpUrls.includes(mcp)) {
          mcpUrls.push(mcp)
        }
      }
    }
    const callOnlyMCPUrlsThatIsNotInDefault: string[] = []
    for (const mcp of callOnlyMCPUrls) {
      if (!mcpUrls.includes(mcp)) {
        mcpUrls.push(mcp)
        callOnlyMCPUrlsThatIsNotInDefault.push(mcp)
      }
    }
    const inputSignature = JSON.stringify(mcpUrls)
    if (inputSignature !== initializedMCPInputSignature) {
      initializedMCPInputSignature = inputSignature
      invalidateMCPToolClientIndex()
    }
    for (const mcp of mcpUrls) {
      reconcileCustomPluginMCPClientForKey(mcp)
      let attemptedPluginClient = mcp.startsWith('plugin:') ? registeredCustomPluginMCPs.get(mcp) : undefined
      const isCallOnlyDefault = callOnlyMCPUrlsThatIsNotInDefault.includes(mcp)
      if (isCallOnlyDefault && callOnlyMCPs[mcp]) {
        continue
      }

      if (!MCPs[mcp] && callOnlyMCPs[mcp]) {
        MCPs[mcp] = callOnlyMCPs[mcp]
        delete callOnlyMCPs[mcp]
        invalidateMCPToolClientIndex()
      }

      if (!MCPs[mcp]) {
        await initializeMCPClientForKey(mcp)
      }

      while (mcp.startsWith('plugin:')) {
        const currentPluginClient = registeredCustomPluginMCPs.get(mcp)
        if (!currentPluginClient || MCPs[mcp] === currentPluginClient) break
        if (currentPluginClient === attemptedPluginClient) break

        attemptedPluginClient = currentPluginClient
        reconcileCustomPluginMCPClientForKey(mcp)
        await initializeMCPClientForKey(mcp)
      }
    }

    for (const key of Object.keys(MCPs)) {
      if (!mcpUrls.includes(key)) {
        MCPs[key].destroy()
        delete MCPs[key]
        invalidateMCPToolClientIndex()
      }
    }

    for (const mcp of callOnlyMCPUrlsThatIsNotInDefault) {
      if (MCPs[mcp]) {
        callOnlyMCPs[mcp] = MCPs[mcp]
        delete MCPs[mcp]
        invalidateMCPToolClientIndex()
      }
    }
  } finally {
    finishMCPInitialization()
  }
}

async function initializeMCPClientForKey(mcp: string): Promise<void> {
  if (MCPs[mcp]) return

  const existingBuild = mcpClientInitializationBuilds.get(mcp)
  if (existingBuild) {
    await existingBuild
    return
  }

  const build = constructMCPClientForKey(mcp).finally(() => {
    if (mcpClientInitializationBuilds.get(mcp) === build) {
      mcpClientInitializationBuilds.delete(mcp)
    }
  })
  mcpClientInitializationBuilds.set(mcp, build)
  await build
}

async function constructMCPClientForKey(mcp: string): Promise<void> {
  if (MCPs[mcp]) return

  let mcpUrl = mcp

  if (mcp.startsWith('internal:')) {
    switch (mcp) {
      case 'internal:fs': {
        const { FileSystemClient } = await import('./filesystemclient')
        MCPs[mcp] = new FileSystemClient()
        break
      }
      case 'internal:risuai': {
        const { RisuAccessClient } = await import('./risuaccess')
        MCPs[mcp] = new RisuAccessClient()
        break
      }
      case 'internal:aiaccess': {
        const { AIAccessClient } = await import('./aiaccess')
        MCPs[mcp] = new AIAccessClient()
        break
      }
      case 'internal:googlesearch': {
        const { GoogleSearchClient } = await import('./googlesearchclient')
        MCPs[mcp] = new GoogleSearchClient()
        break
      }
      case 'internal:graphmem': {
        const { GraphMemClient } = await import('./graphmem')
        MCPs[mcp] = new GraphMemClient()
        break
      }
      case 'internal:dice': {
        const { DiceClient } = await import('./dice')
        MCPs[mcp] = new DiceClient()
        break
      }
    }

    if (MCPs[mcp]) {
      invalidateMCPToolClientIndex()
      await checkHandshakeOrRemoveClient(mcp)
    }
    return
  }

  if (mcp.startsWith('plugin:')) {
    const customMCP = registeredCustomPluginMCPs.get(mcp)
    if (customMCP) {
      MCPs[mcp] = customMCP
      invalidateMCPToolClientIndex()
      await checkHandshakeOrRemoveClient(mcp)
      return
    }
    return
  }

  if (mcp.startsWith('stdio:')) {
    const MCPJSON = mcp.slice('stdio:'.length)
    try {
      const MCPData = JSON.parse(MCPJSON)
      if (MCPData.url) {
        mcpUrl = MCPData.url
      } else if (MCPData.command && MCPData.args) {
        throw new Error('Command-based stdio MCPs are not supported')
      } else {
        throw new Error('MCP JSON does not contain a valid URL')
      }
    } catch (error) {
      throw new Error(`Failed to parse MCP JSON: ${error}`)
    }
  }

  const registerRefresh: typeof MCPClient.prototype.registerRefreshToken = (arg) => {
    persistMCPRefreshToken(mcp, arg)
  }

  const getRefresh: typeof MCPClient.prototype.getRefreshToken = async () => {
    return resolveMCPRefreshTokenSource(mcp)
  }

  try {
    if (!mcpUrl.startsWith('https://') && !mcpUrl.startsWith('http://')) {
      throw new Error('Invalid MCP URL')
    }

    const mcpClient = new MCPClient(mcpUrl)
    mcpClient.registerRefreshToken = registerRefresh
    mcpClient.getRefreshToken = getRefresh
    mcpClient.refreshStoredAccessToken = async (signal) => await requestStoredMcpOAuthRefresh(mcp, { signal })
    await mcpClient.checkHandshake()
    MCPs[mcp] = mcpClient
    invalidateMCPToolClientIndex()
  } catch (error) {
    console.error(`MCP: Failed to initialize MCP at ${mcp}:`, error)
  }
}

export function resolveMCPRefreshTokenSource(mcp: string): MCPRefreshTokenSource | null {
  const matches = (getDatabase().authRefreshes ?? []).filter((refresh) => refresh.url === mcp)
  if (matches.length !== 1) return null
  const refresh = matches[0]
  if (isMaskedProviderSecret(refresh.refreshToken) || isMaskedProviderSecret(refresh.clientSecret)) {
    return { source: 'stored' }
  }
  if (
    typeof refresh.tokenUrl !== 'string' ||
    refresh.tokenUrl.trim().length === 0 ||
    typeof refresh.clientId !== 'string' ||
    refresh.clientId.trim().length === 0 ||
    typeof refresh.clientSecret !== 'string' ||
    typeof refresh.refreshToken !== 'string' ||
    refresh.refreshToken.trim().length === 0
  ) {
    return null
  }
  return {
    source: 'provided',
    clientId: refresh.clientId,
    clientSecret: refresh.clientSecret,
    refreshToken: refresh.refreshToken,
    tokenUrl: refresh.tokenUrl,
  }
}

async function checkHandshakeOrRemoveClient(mcp: string): Promise<boolean> {
  const client = MCPs[mcp]
  if (!client) return false
  try {
    await client.checkHandshake()
    return true
  } catch (error) {
    console.error(`MCP: Failed to initialize MCP at ${mcp}:`, error)
    client.destroy()
    if (MCPs[mcp] === client) {
      delete MCPs[mcp]
      invalidateMCPToolClientIndex()
    }
    return false
  }
}

function beginMCPInitialization() {
  mcpInitializationDepth += 1
}

function finishMCPInitialization() {
  mcpInitializationDepth -= 1
  if (mcpInitializationDepth > 0) return

  const waiters = mcpInitializationIdleWaiters
  mcpInitializationIdleWaiters = []
  for (const resolve of waiters) {
    resolve()
  }
}

async function waitForMCPInitializationIdle() {
  if (mcpInitializationDepth === 0) return

  await new Promise<void>((resolve) => {
    mcpInitializationIdleWaiters.push(resolve)
  })
}

function invalidateMCPToolClientIndex() {
  mcpToolClientIndexGeneration += 1
  mcpToolClientIndex = null
  mcpToolClientIndexBuild = null
}

function reconcileCustomPluginMCPRegistryChange(change: CustomPluginMCPRegistryChange): void {
  const destroyedClients = new Set<MCPRegistryClient>()
  for (const registry of [MCPs, callOnlyMCPs]) {
    const registeredClient = registry[change.identifier]
    if (!registeredClient || registeredClient === change.current) continue

    registeredClient.destroy()
    destroyedClients.add(registeredClient)
    delete registry[change.identifier]
  }

  if (change.previous && change.previous !== change.current && !destroyedClients.has(change.previous)) {
    change.previous.destroy()
  }
  invalidateMCPToolClientIndex()
}

function reconcileCustomPluginMCPClientForKey(mcp: string): void {
  if (!mcp.startsWith('plugin:')) return

  const registeredClient = registeredCustomPluginMCPs.get(mcp)
  const initializedClient = MCPs[mcp]
  if (!initializedClient || initializedClient === registeredClient) return

  initializedClient.destroy()
  delete MCPs[mcp]
  invalidateMCPToolClientIndex()
}

async function getMCPToolClientIndex(): Promise<Map<string, MCPToolDispatchTarget>> {
  if (mcpInitializationDepth > 0) {
    await waitForMCPInitializationIdle()
  }

  if (mcpToolClientIndex) return mcpToolClientIndex

  if (!mcpToolClientIndexBuild) {
    const buildGeneration = mcpToolClientIndexGeneration
    mcpToolClientIndexBuild = buildMCPToolClientIndex()
      .then(async (index) => {
        if (buildGeneration !== mcpToolClientIndexGeneration) {
          await waitForMCPInitializationIdle()
          return await getMCPToolClientIndex()
        }
        mcpToolClientIndex = index
        return index
      })
      .finally(() => {
        if (buildGeneration === mcpToolClientIndexGeneration) {
          mcpToolClientIndexBuild = null
        }
      })
  }

  return await mcpToolClientIndexBuild
}

async function buildMCPToolClientIndex(): Promise<Map<string, MCPToolDispatchTarget>> {
  const index = new Map<string, MCPToolDispatchTarget>()
  const combinedMCPs: Record<string, MCPRegistryClient> = { ...MCPs, ...callOnlyMCPs }

  for (const key of Object.keys(combinedMCPs)) {
    const client = combinedMCPs[key]
    const tools = await client.getToolList()
    for (const tool of tools) {
      if (!index.has(tool.name)) {
        index.set(tool.name, {
          mcpURL: key,
          client,
        })
      }
    }
  }

  return index
}

export function persistMCPRefreshToken(mcp: string, arg: MCPRefreshToken): void {
  const previous = cloneJsonValue(getDatabase().authRefreshes ?? []) as StoredMCPRefreshToken[]
  const attemptedToken: StoredMCPRefreshToken = cloneJsonValue({
    url: mcp,
    ...arg,
  })
  const attemptedNext = upsertMCPRefreshToken(previous, attemptedToken)
  // The optimistic local write must run inside a trusted write scope so it
  // does not throw against the read-only server projection in Fastify mode.
  withTrustedResourceWrite(() => {
    getDatabase().authRefreshes = cloneJsonValue(attemptedNext)
  })

  if (!canUseServerCommands()) return

  const patch = { authRefreshes: attemptedNext }
  const commandInput: PatchServerBackedSettingsInput = {
    patch,
    acknowledgeOptimistic: true,
    optimisticProjectionEpochs: captureSettingsPatchProjectionEpochs(patch),
  }
  const attempt: PendingMCPRefreshTokenPersistence = {
    attempted: attemptedNext,
    attemptedToken,
    commandInput,
    previous,
    sequence: ++nextMCPRefreshTokenPersistenceSequence,
  }
  commandInput.rollback = () => rollbackMCPRefreshTokenPersistence(attempt)
  pendingMCPRefreshTokenPersistences.push(attempt)

  const persistence = patchServerBackedSettings(commandInput)
  void persistence.then(
    () => finishMCPRefreshTokenPersistence(attempt),
    () => finishMCPRefreshTokenPersistence(attempt),
  )
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function upsertMCPRefreshToken(
  snapshot: StoredMCPRefreshToken[],
  attemptedToken: StoredMCPRefreshToken,
): StoredMCPRefreshToken[] {
  const firstMatchIndex = snapshot.findIndex((token) => token.url === attemptedToken.url)
  const next = snapshot.filter((token) => token.url !== attemptedToken.url).map(cloneJsonValue)
  const insertionIndex =
    firstMatchIndex === -1
      ? next.length
      : snapshot.slice(0, firstMatchIndex).filter((token) => token.url !== attemptedToken.url).length
  next.splice(insertionIndex, 0, cloneJsonValue(attemptedToken))
  return next
}

function rollbackMCPRefreshTokenPersistence(attempt: PendingMCPRefreshTokenPersistence): void {
  withTrustedResourceWrite(() => {
    const rolledBack = applyAttemptedFieldRollback({
      target: getDatabase() as unknown as Record<string, unknown>,
      previous: { authRefreshes: attempt.previous },
      attempted: { authRefreshes: attempt.attempted },
    })
    if (rolledBack.includes('authRefreshes')) return

    const liveAuthRefreshes = getDatabase().authRefreshes
    if (!Array.isArray(liveAuthRefreshes)) return
    revertMCPRefreshTokenInSnapshot(liveAuthRefreshes, attempt)
  })

  rebaseLaterMCPRefreshTokenPersistences(attempt)
}

function rebaseLaterMCPRefreshTokenPersistences(failed: PendingMCPRefreshTokenPersistence): void {
  for (const later of pendingMCPRefreshTokenPersistences) {
    if (later.sequence <= failed.sequence) continue

    revertMCPRefreshTokenInSnapshot(later.previous, failed)
    revertMCPRefreshTokenInSnapshot(later.attempted, failed)
    later.commandInput.optimisticProjectionEpochs = captureSettingsPatchProjectionEpochs(later.commandInput.patch)
  }
}

function revertMCPRefreshTokenInSnapshot(
  snapshot: StoredMCPRefreshToken[],
  attempt: PendingMCPRefreshTokenPersistence,
): boolean {
  const index = snapshot.findIndex(
    (token) => token.url === attempt.attemptedToken.url && sameJsonValue(token, attempt.attemptedToken),
  )
  if (index === -1) return false
  const previousMatches = attempt.previous
    .filter((token) => token.url === attempt.attemptedToken.url)
    .map(cloneJsonValue)
  snapshot.splice(index, 1, ...previousMatches)
  return true
}

function finishMCPRefreshTokenPersistence(attempt: PendingMCPRefreshTokenPersistence): void {
  const index = pendingMCPRefreshTokenPersistences.findIndex((candidate) => candidate.sequence === attempt.sequence)
  if (index !== -1) pendingMCPRefreshTokenPersistences.splice(index, 1)
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function getMCPTools(additionalMCPs?: string[]) {
  await initializeMCPs(additionalMCPs)
  const tools: MCPToolWithURL[] = []
  for (const key of Object.keys(MCPs)) {
    const t = (await MCPs[key].getToolList()).map((tool) => {
      return {
        ...tool,
        mcpURL: key,
      }
    })

    tools.push(...t)
  }
  return tools
}

export async function getMCPMeta(additionalMCPs?: string[]) {
  await initializeMCPs(additionalMCPs)
  const meta: Record<string, typeof MCPClient.prototype.serverInfo> = {}
  for (const key of Object.keys(MCPs)) {
    meta[key] = MCPs[key].serverInfo
  }
  return meta
}

export async function callMCPTool(methodName: string, args: any): Promise<RPCToolCallContent[]> {
  await initializeMCPs()
  const toolTarget = (await getMCPToolClientIndex()).get(methodName)
  if (toolTarget) {
    return await toolTarget.client.callTool(methodName, args)
  }
  return [
    {
      type: 'text',
      text: `Tool ${methodName} not found on any MCP`,
    },
  ]
}

export async function callMCPToolFrom(mcpURL: string, methodName: string, args: any): Promise<RPCToolCallContent[]> {
  await initializeMCPs()
  const client = MCPs[mcpURL]
  if (client) {
    const tools = await client.getToolList()
    if (tools.some((tool) => tool.name === methodName)) {
      return await client.callTool(methodName, args)
    }
  }
  return [
    {
      type: 'text',
      text: `Tool ${methodName} not found on MCP ${mcpURL}`,
    },
  ]
}

// Tool registry entrypoint.
export async function getTools() {
  return await getMCPTools()
}

// Tool call entrypoint.
export async function callTool(methodName: string, args: any) {
  return await callMCPTool(methodName, args)
}

export async function importMCPModule() {
  if (canUseServerCommands()) {
    alertError('MCP module import is not supported in Fastify server-backed mode yet')
    return
  }

  const x = await alertInput('Please enter the URL of the MCP module to import:', [
    ['internal:aiaccess', 'LLM Call Client (internal:aiaccess)'],
    ['internal:risuai', 'Risu Access Client (internal:risuai)'],
    ['internal:fs', 'File System Client (internal:fs)'],
    ['internal:googlesearch', 'Google Search Client (internal:googlesearch)'],
    ['internal:dice', 'Dice Tool Client (internal:dice)'],
    ['internal:graphmem', 'Graph Memory Client (internal:graphmem)'],
    ['https://mcp.paypal.com/sse', 'PayPal MCP (https://mcp.paypal.com/sse)'],
    ['https://mcp.linear.app/sse', 'Linear MCP (https://mcp.linear.app/sse)'],
    ['https://rag-mcp-2.whatsmcp.workers.dev/sse', 'OneContext MCP (https://rag-mcp-2.whatsmcp.workers.dev/sse)'],
    ['https://browser.mcp.cloudflare.com/sse', 'Cloudflare Browser MCP (https://browser.mcp.cloudflare.com/sse)'],
    ['https://mcp.deepwiki.com/mcp', 'DeepWiki MCP (https://mcp.deepwiki.com/mcp)'],
  ])

  if (
    !x.startsWith('http://localhost') &&
    !x.startsWith('http://127') &&
    !x.startsWith('https:') &&
    !x.startsWith('internal:') &&
    !x.startsWith('stdio:') &&
    !x.startsWith('plugin:')
  ) {
    alertError('Invalid URL')
    return
  }
  try {
    const metas = await getMCPMeta([x])
    const meta = metas[x]
    if (!meta) {
      alertError('MCP module not found or invalid URL')
      return
    }
    const db = getDatabase()
    db.modules.push({
      name: meta.serverInfo.name,
      description: 'MCP from ' + x,
      mcp: {
        url: x,
      },
      id: v4(),
      lorebook: [
        {
          comment: 'MCP Info',
          content: `@@mcp\n\n<MCP Info>Name:${meta.serverInfo.name}\nVersion:${meta.serverInfo.version}\nInst:${meta.instructions ?? 'None'}</MCP Info>`,
          key: '',
          alwaysActive: true,
          secondkey: '',
          insertorder: 0,
          mode: 'normal',
          selective: false,
        },
      ],
    })
    alertNormal(`MCP module imported successfully!\nName: ${meta.serverInfo.name}`)
  } catch (error) {
    alertError(error)
  }
}

export type toolCallData = {
  call: {
    id: string
    name: string
    arg: any
  }
  response: RPCToolCallContent[]
}

const inst = localforage.createInstance({
  name: 'mcp-tool-calls',
  storeName: 'mcp-tool-calls',
})

export async function encodeToolCall(call: toolCallData) {
  call.call.id = call.call.id || v4()
  await inst.setItem(call.call.id, call)
  return `<tool_call>${call.call.id}\uf100${call.call.name}</tool_call>\n\n`
}

export async function decodeToolCall(text: string): Promise<toolCallData | undefined> {
  text = text.trim()
  if (text.startsWith('<tool_call>')) {
    text = text.slice('<tool_call>'.length, 0).trim()
  }
  if (text.endsWith('</tool_call>')) {
    text = text.slice(0, -'</tool_call>'.length).trim()
  }
  const [callId, callName] = text.split('\uf100')
  if (!callId) {
    return undefined
  }
  const call = await inst.getItem<toolCallData>(callId)
  if (!call) {
    return undefined
  }
  return call
}
