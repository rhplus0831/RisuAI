import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { DatabaseSync } from 'node:sqlite'
import type { Chat, Database, Message, character, customscript } from '../../../src/ts/storage/database.svelte'
import type { CbsConditions } from '../../../src/ts/parser/risuChatParserHelpers'
import { resolvePromptPresetRegexField } from '../../../src/ts/presetSplit.js'
import {
  DISPLAY_SOURCE_PROTOCOL_VERSION,
  DISPLAY_SOURCE_TRANSFORM_VERSION,
  displaySourceNamespaceJson,
  stableDisplayDependencyJson,
  type DisplaySourceRequest,
  type DisplaySourceResponse,
  type DisplaySourceResponseEntry,
  type DisplaySourceTarget,
} from '@risuai/protocol/display-source'
import { getSchemaState } from './db.js'
import { getDatabaseLineage, getDatabaseWriterMetadata } from './databaseLineage.js'
import { loadPersistedForDisplaySource } from './repository.js'
import { ValidationError } from './repository.js'
import { createLuaExecBudget, runLuaEditTrigger } from './prompt/luaRuntime.js'
import { createTriggerVarEngine } from './prompt/triggerVars.js'
import { getChatDefaultVariables } from './prompt/chatVarDefaults.js'
import { getActiveModules, getModuleAssets, getModuleTriggers } from './prompt/modules.js'
import { createTriggerExecutionBudget, runTrigger } from './prompt/triggers.js'
import { processScriptAsync } from './prompt/scripts.js'
import { isBoundedRegexError } from './prompt/boundedRegex.js'
import { emitProtocolMetric, protocolDurationMs, protocolNowMs } from './protocolMetrics.js'
import { DisplaySourceCache } from './displaySourceCache.js'

interface DisplaySourceServiceOptions {
  db: DatabaseSync
  dataDir: string
  cache?: DisplaySourceCache
}

interface DisplayScope {
  database: Database
  character: character
  chat: Chat
  chatId: string
  selectedCharID: number
  chatPage: number
}

interface TransformOutcome {
  displaySource: string
  ephemeralStateChanged: boolean
  stageDurations: Record<string, number>
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Display source request aborted')
}

function cloneScriptstate(value: Chat['scriptstate']): Chat['scriptstate'] {
  return value === undefined ? undefined : structuredClone(value)
}

function installScriptstate(chat: Chat, value: Chat['scriptstate']): void {
  if (value === undefined || Object.keys(value).length === 0) {
    delete chat.scriptstate
    return
  }
  chat.scriptstate = structuredClone(value)
}

function activePromptPresetRegex(database: Database, chat: Chat): customscript[] {
  const promptPresetId = chat.generationSettings?.promptPresetId?.trim()
  if (!promptPresetId) return Array.isArray(database.presetRegex) ? database.presetRegex : []
  const preset = database.promptPresets?.find((candidate) => candidate?.id === promptPresetId)
  const resolved = resolvePromptPresetRegexField(preset)
  return resolved.present && Array.isArray(resolved.value) ? (resolved.value as customscript[]) : []
}

function displayScope(database: Database, characterId: string, chatId: string): DisplayScope | null {
  const selectedCharID = database.characters.findIndex((candidate) => candidate?.chaId === characterId)
  if (selectedCharID < 0) return null
  const character = database.characters[selectedCharID]
  const chatPage = character.chats?.findIndex((candidate) => candidate?.id === chatId) ?? -1
  if (chatPage < 0) return null
  const chat = character.chats[chatPage]
  database.presetRegex = structuredClone(activePromptPresetRegex(database, chat))
  return { database, character, chat, chatId, selectedCharID, chatPage }
}

function dynamicAssetFallbackRequired(scope: DisplayScope, modules: ReturnType<typeof getActiveModules>): boolean {
  if (!scope.database.dynamicAssets || !scope.database.dynamicAssetsEditDisplay) return false
  return (scope.character.additionalAssets?.length ?? 0) > 0 || getModuleAssets(modules).length > 0
}

function targetIsFresh(scope: DisplayScope, target: DisplaySourceTarget): boolean {
  if (target.index < 0) return true
  const message = scope.chat.message?.[target.index]
  if (!message) return false
  if (target.messageId && message.chatId !== target.messageId) return false
  if (target.role !== null && message.role !== target.role) return false
  return true
}

function sharedDependencyValue(
  scope: DisplayScope,
  modules: ReturnType<typeof getActiveModules>,
): Record<string, unknown> {
  return {
    character: {
      additionalAssets: scope.character.additionalAssets,
      chaId: scope.character.chaId,
      customscript: scope.character.customscript,
      defaultVariables: scope.character.defaultVariables,
      desc: scope.character.desc,
      firstMessage: scope.character.firstMessage,
      alternateGreetings: scope.character.alternateGreetings,
      emotionImages: scope.character.emotionImages,
      modules: scope.character.modules,
      name: scope.character.name,
      personality: scope.character.personality,
      scenario: scope.character.scenario,
      triggerscript: scope.character.triggerscript,
      type: scope.character.type,
    },
    chat: {
      generationSettings: scope.chat.generationSettings,
      id: scope.chat.id,
      fmIndex: scope.chat.fmIndex,
      message: scope.chat.message?.map((message) => ({
        chatId: message.chatId,
        data: message.data,
        name: message.name,
        role: message.role,
      })),
      modules: scope.chat.modules,
      scriptstate: scope.chat.scriptstate,
    },
    database: {
      dynamicAssets: scope.database.dynamicAssets,
      dynamicAssetsEditDisplay: scope.database.dynamicAssetsEditDisplay,
      enabledModules: scope.database.enabledModules,
      globalChatVariables: scope.database.globalChatVariables,
      globalscript: scope.database.globalscript,
      moduleIntergration: scope.database.moduleIntergration,
      presetRegex: scope.database.presetRegex,
      personaPrompt: scope.database.personaPrompt,
      templateDefaultVariables: scope.database.templateDefaultVariables,
      username: scope.database.username,
    },
    modules: modules.map((module) => ({
      assets: module.assets,
      id: module.id,
      customModuleToggle: module.customModuleToggle,
      lowLevelAccess: module.lowLevelAccess,
      namespace: module.namespace,
      regex: module.regex,
      trigger: module.trigger,
    })),
    transformVersion: DISPLAY_SOURCE_TRANSFORM_VERSION,
  }
}

function targetDependencyValue(
  sharedDependencyFingerprint: string,
  target: DisplaySourceTarget,
  sourceHash: string,
): Record<string, unknown> {
  return {
    cbsConditions: { firstmsg: target.firstMessage, chatRole: target.role },
    sharedDependencyFingerprint,
    sourceHash,
    target: {
      characterId: target.characterId,
      firstMessage: target.firstMessage,
      index: target.index,
      layer: target.layer,
      messageId: target.messageId,
      name: target.name,
      role: target.role,
      streaming: target.streaming,
    },
  }
}

function errorEntry(
  target: DisplaySourceTarget,
  status: 'client_fallback' | 'stale' | 'error',
  reason: string,
): DisplaySourceResponseEntry {
  return { requestKey: target.requestKey, status, sourceHash: target.sourceHash, reason }
}

export class DisplaySourceService {
  readonly cache: DisplaySourceCache

  private readonly db: DatabaseSync
  private readonly dataDir: string
  private exclusiveTail: Promise<void> = Promise.resolve()
  private queuedBatchCount = 0

  constructor(options: DisplaySourceServiceOptions) {
    this.db = options.db
    this.dataDir = options.dataDir
    this.cache = options.cache ?? new DisplaySourceCache()
  }

  currentRevision(): number {
    return getSchemaState(this.db).revision
  }

  transformBatch(chatId: string, request: DisplaySourceRequest, signal?: AbortSignal): Promise<DisplaySourceResponse> {
    const enqueuedAt = protocolNowMs()
    const queueDepth = this.queuedBatchCount
    this.queuedBatchCount += 1
    const run = this.exclusiveTail.then(() =>
      this.transformBatchExclusive(chatId, request, protocolDurationMs(enqueuedAt), queueDepth, signal),
    )
    this.exclusiveTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run.finally(() => {
      this.queuedBatchCount -= 1
    })
  }

  private async transformBatchExclusive(
    chatId: string,
    request: DisplaySourceRequest,
    queueWaitMs: number,
    queueDepth: number,
    signal?: AbortSignal,
  ): Promise<DisplaySourceResponse> {
    const startedAt = protocolNowMs()
    throwIfAborted(signal)
    const initialRevision = getSchemaState(this.db).revision
    if (request.baseRevision !== initialRevision) {
      throw new ValidationError(`Display source base revision is stale; current revision is ${initialRevision}`)
    }

    const databaseLineage = getDatabaseLineage(this.db)
    const activeWriterEpoch = getDatabaseWriterMetadata(this.db).epoch
    const namespaceJson = displaySourceNamespaceJson({
      databaseLineage,
      activeWriterEpoch,
      context: request.context,
    })
    const contextFingerprint = sha256(namespaceJson)
    this.cache.activate(contextFingerprint)

    const scopeLoadStartedAt = protocolNowMs()
    const database = this.loadScopeDatabase(chatId)
    const scopeLoadMs = protocolDurationMs(scopeLoadStartedAt)
    const primaryTarget = request.targets[0]
    const scope = primaryTarget ? displayScope(database, primaryTarget.characterId, chatId) : null
    if (!scope) throw new ValidationError('Display source chat or character was not found')
    const entries: DisplaySourceResponseEntry[] = []
    const luaExecBudget = createLuaExecBudget()
    const triggerBudget = createTriggerExecutionBudget()
    const modules = getActiveModules(scope.database, scope.character, scope.chat)
    const dynamicAssetFallback = dynamicAssetFallbackRequired(scope, modules)
    const sharedDependencyStartedAt = protocolNowMs()
    const sharedDependencyFingerprint = sha256(stableDisplayDependencyJson(sharedDependencyValue(scope, modules)))
    const sharedDependencyMs = protocolDurationMs(sharedDependencyStartedAt)
    let targetFingerprintMs = 0
    let batchCacheHitCount = 0
    let batchCacheMissCount = 0
    let batchInflightJoinCount = 0
    let streamingBypassCount = 0

    for (const target of request.targets) {
      throwIfAborted(signal)
      if (target.characterId !== scope.character.chaId || !targetIsFresh(scope, target)) {
        entries.push(errorEntry(target, 'stale', 'target_identity_changed'))
        continue
      }
      const actualSourceHash = sha256(target.source)
      if (actualSourceHash !== target.sourceHash) {
        entries.push(errorEntry(target, 'error', 'source_hash_mismatch'))
        continue
      }
      if (dynamicAssetFallback) {
        entries.push(errorEntry(target, 'client_fallback', 'dynamic_asset_similarity_required'))
        continue
      }

      const targetFingerprintStartedAt = protocolNowMs()
      const dependencyFingerprint = sha256(
        stableDisplayDependencyJson(targetDependencyValue(sharedDependencyFingerprint, target, actualSourceHash)),
      )
      targetFingerprintMs += protocolDurationMs(targetFingerprintStartedAt)
      try {
        const execute = async () => {
          const outcome = await this.transformTarget(
            scope,
            target,
            request.context,
            luaExecBudget,
            triggerBudget,
            modules,
            signal,
          )
          emitProtocolMetric('display_source_transform', {
            status: 'ok',
            characterId: target.characterId,
            chatId: scope.chat.id,
            durationMs: Object.values(outcome.stageDurations).reduce((sum, duration) => sum + duration, 0),
            outputBytes: Buffer.byteLength(outcome.displaySource, 'utf8'),
            ephemeralStateChanged: outcome.ephemeralStateChanged,
            ...outcome.stageDurations,
          })
          return {
            value: { displaySource: outcome.displaySource, dependencyFingerprint },
            cacheable: true,
          }
        }
        const result = target.streaming
          ? { ...(await execute()).value, cacheStatus: 'miss' as const }
          : await this.cache.resolve(contextFingerprint, dependencyFingerprint, execute)
        if (target.streaming) streamingBypassCount += 1
        else if (result.cacheStatus === 'hit') batchCacheHitCount += 1
        else if (result.cacheStatus === 'inflight_join') batchInflightJoinCount += 1
        else batchCacheMissCount += 1
        entries.push({
          requestKey: target.requestKey,
          status: 'ok',
          sourceHash: target.sourceHash,
          dependencyFingerprint: result.dependencyFingerprint,
          displaySource: result.displaySource,
        })
      } catch (error) {
        throwIfAborted(signal)
        const reason = isBoundedRegexError(error) ? 'bounded_regex_rejected' : 'transform_failed'
        entries.push(errorEntry(target, isBoundedRegexError(error) ? 'client_fallback' : 'error', reason))
      }
    }

    const revision = initialRevision
    if (getSchemaState(this.db).revision !== initialRevision) {
      return this.staleResponse(request, contextFingerprint, 'revision_changed_during_transform')
    }

    const currentLineage = getDatabaseLineage(this.db)
    const currentWriterEpoch = getDatabaseWriterMetadata(this.db).epoch
    if (currentLineage !== databaseLineage || currentWriterEpoch !== activeWriterEpoch) {
      const currentNamespace = sha256(
        displaySourceNamespaceJson({
          databaseLineage: currentLineage,
          activeWriterEpoch: currentWriterEpoch,
          context: request.context,
        }),
      )
      this.cache.activate(currentNamespace)
      return this.staleResponse(request, contextFingerprint, 'display_namespace_retired')
    }

    emitProtocolMetric('display_source_batch', {
      status: 'ok',
      targetCount: request.targets.length,
      okCount: entries.filter((entry) => entry.status === 'ok').length,
      fallbackCount: entries.filter((entry) => entry.status === 'client_fallback').length,
      durationMs: protocolDurationMs(startedAt),
      queueWaitMs,
      queueDepth,
      scopeLoadMs,
      sharedDependencyMs,
      targetFingerprintMs,
      transcriptMessageCount: scope.chat.message?.length ?? 0,
      batchCacheHitCount,
      batchCacheMissCount,
      batchInflightJoinCount,
      streamingBypassCount,
      revision,
      cache: this.cache.stats(),
    })
    return { protocolVersion: DISPLAY_SOURCE_PROTOCOL_VERSION, revision, contextFingerprint, entries }
  }

  private loadScopeDatabase(chatId: string): Database {
    const persisted = loadPersistedForDisplaySource(this.db, this.dataDir, chatId)
    if (!persisted.database || typeof persisted.database !== 'object') {
      throw new ValidationError('Server database is not initialized')
    }
    return persisted.database as Database
  }

  private async transformTarget(
    scope: DisplayScope,
    target: DisplaySourceTarget,
    clientContext: DisplaySourceRequest['context'],
    luaExecBudget: ReturnType<typeof createLuaExecBudget>,
    triggerBudget: ReturnType<typeof createTriggerExecutionBudget>,
    modules: ReturnType<typeof getActiveModules>,
    signal?: AbortSignal,
  ): Promise<TransformOutcome> {
    const beforeScriptstate = cloneScriptstate(scope.chat.scriptstate)
    const stageDurations: Record<string, number> = {}
    const measure = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => {
      const startedAt = protocolNowMs()
      try {
        return await operation()
      } finally {
        stageDurations[`${stage}Ms`] = protocolDurationMs(startedAt)
      }
    }
    let data = target.source
    const cbsConditions: CbsConditions = {
      firstmsg: target.firstMessage,
      ...(target.role === null ? {} : { chatRole: target.role }),
    }

    const varEngine = createTriggerVarEngine({
      chat: scope.chat,
      database: scope.database,
      selectedCharID: scope.selectedCharID,
      chatPage: scope.chatPage,
      defaultVariables: getChatDefaultVariables(scope.character, scope.database),
    })
    try {
      try {
        data = await measure('lua', () =>
          runLuaEditTrigger(
            scope.character,
            'editdisplay',
            data,
            { index: target.index },
            {
              chat: scope.chat,
              database: scope.database,
              selectedCharID: scope.selectedCharID,
              chatPage: scope.chatPage,
              varEngine,
              model: scope.database.aiModel,
              signal,
              execBudget: luaExecBudget,
              requestHistoryDb: this.db,
              assetDataDir: this.dataDir,
              moduleTriggers: getModuleTriggers(modules),
            },
          ),
        )
      } catch {
        throwIfAborted(signal)
        installScriptstate(scope.chat, beforeScriptstate)
        data = target.source
      }

      try {
        const triggerResult = await measure('trigger', () =>
          runTrigger(
            {
              modules,
              model: scope.database.aiModel,
              database: scope.database,
              selectedCharID: scope.selectedCharID,
              chatPage: scope.chatPage,
              signal,
              triggerBudget,
              clientContext,
            },
            scope.character,
            'display',
            {
              chat: scope.chat,
              displayMode: true,
              displayData: data,
              triggerBudget,
            },
          ),
        )
        if (!triggerResult?.aborted) data = triggerResult?.displayData ?? data
      } catch {
        throwIfAborted(signal)
        // The browser catches the display-trigger stage and continues.
      }

      const fakeInjectTarget = { role: target.role ?? 'char', data: target.source } as Message
      data = await measure('regex', () =>
        processScriptAsync(
          {
            database: scope.database,
            selectedCharID: scope.selectedCharID,
            chatPage: scope.chatPage,
            chara: scope.character,
            runVar: false,
            role: target.role ?? undefined,
            cbsConditions,
            signal,
            clientContext,
          },
          scope.character,
          data,
          'editdisplay',
          cbsConditions,
          target.index,
          scope.chat,
          { injectTarget: fakeInjectTarget },
        ),
      )
      const ephemeralStateChanged = !isDeepStrictEqual(beforeScriptstate, scope.chat.scriptstate)
      return {
        displaySource: data,
        ephemeralStateChanged,
        stageDurations,
      }
    } finally {
      // `editDisplay` is a render-time projection, so it may be retried, cached,
      // skipped, or evaluated out of transcript order. Lua chat-variable writes
      // stay visible to the remaining stages of this target, but every target
      // starts from the same authoritative snapshot: always discard its delta
      // before another target runs, and never persist display-time scriptstate.
      installScriptstate(scope.chat, beforeScriptstate)
    }
  }

  private staleResponse(
    request: DisplaySourceRequest,
    contextFingerprint: string,
    reason: string,
  ): DisplaySourceResponse {
    return {
      protocolVersion: DISPLAY_SOURCE_PROTOCOL_VERSION,
      revision: getSchemaState(this.db).revision,
      contextFingerprint,
      entries: request.targets.map((target) => errorEntry(target, 'stale', reason)),
    }
  }
}
