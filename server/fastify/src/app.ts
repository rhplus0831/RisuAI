import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCompress from '@fastify/compress'
import fastifyMultipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { createActiveWriterState, registerActiveWriterGuard } from './activeWriter.js'
import { type AppConfig, loadConfig } from './config.js'
import { createAuthState } from './auth.js'
import { createCommandEventSink, type CommandEventSink } from './commands/events.js'
import { openDatabase } from './db.js'
import { ASSET_BULK_BINARY_CONTENT_TYPE, registerAssetsRoutes } from './routes/assets.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerBackupRoutes } from './routes/backups.js'
import { registerBootstrapRoutes } from './routes/bootstrap.js'
import { registerCommandRoutes } from './routes/commands.js'
import { registerProjectionRoutes } from './routes/projection.js'
import { registerEventsRoutes } from './routes/events.js'
import { registerGenerationRoutes } from './routes/generation.js'
import {
  registerGenerationChatRoutes,
  retryQueuedGenerationFinalizations,
  type GenerationChatRouteOptions,
} from './routes/generationChat.js'
import { pruneTerminalGenerationFinalizationRetries } from './generationFinalizationRetry.js'
import { bootPromptVariables } from './prompt/promptVariablesBoot.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerHubRoutes } from './routes/hub.js'
import { registerLegacyStorageRoutes } from './routes/legacyStorage.js'
import { registerMemoryJobRoutes } from './routes/memoryJobs.js'
import { registerMemoryReadRoutes } from './routes/memoryReads.js'
import { registerProxyRoutes } from './routes/proxy.js'
import { registerRealmImportRoutes } from './routes/realmImport.js'
import { registerSaveRoutes } from './routes/save.js'
import { registerStreamJobRoutes } from './routes/streamJobs.js'
import { SUPPORTED_ASSET_CONTENT_TYPES, ensureDbJsonImported, loadPersistedWithMessages } from './repository.js'
import { ASSET_GC_INTERVAL_MS, type AssetGcOptions, runAssetGc } from './assetGc.js'
import { JobRegistry, PROXY_STREAM_GC_INTERVAL_MS } from './streamJobs.js'
import { GenerationJobRegistry } from './generationJobs.js'
import { MessageTranslationJobRegistry } from './messageTranslationJobs.js'
import { createMemoryEventBus, emitMemoryEventSafely, type MemoryEventSink } from './memoryEvents.js'
import { backfillLegacyHypaV3MemoryRows } from './memoryLegacyImport.js'
import { MemoryWorker, type MemoryWorkerOptions } from './memoryWorker.js'
import { createEmbedMemoryJobBatchHandler, createEmbedMemoryJobHandler } from './memoryEmbedJobHandler.js'
import { createSummarizeMemoryJobBatchHandler, createSummarizeMemoryJobHandler } from './memorySummarizeJobHandler.js'
import { registerRequestTrace } from './requestTrace.js'

/**
 * Node `server.requestTimeout` backstop the wall-clock bound for
 * receiving one request. Mirrors the durable generation path's 600s
 * `deadlineAt` reference instead of Node's implicit 300s default.
 */
export const REQUEST_RECEIVE_TIMEOUT_MS = 600_000
export const STATIC_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const STATIC_REVALIDATE_CACHE_CONTROL = 'public, max-age=0'

export interface BuildAppOptions {
  config?: AppConfig
  generationChat?: GenerationChatRouteOptions
  realmImport?: {
    deadlineMs?: number
    maxDynamicJsonBytes?: number
    maxFetchedAssetBytes?: number
    maxFetchedAssetTotalBytes?: number
  }
  memoryWorker?: false | Omit<MemoryWorkerOptions, 'db'>
  memoryEvents?: MemoryEventSink
  commandEvents?: CommandEventSink
  /**
   * Periodic server-side asset GC. `false` disables the timer (tests that do
   * not exercise GC). An options object tunes the grace window / interval.
   */
  assetGc?: false | (AssetGcOptions & { intervalMs?: number })
}

export interface BuiltApp {
  app: FastifyInstance
  config: AppConfig
}

function isPathWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<BuiltApp> {
  const config = opts.config ?? loadConfig()
  const app = Fastify({
    logger: process.env.LOG_LEVEL === 'silent' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: config.bodyLimit,
    trustProxy: config.trustProxy,
    // Generous explicit backstop for receiving a request, aligned
    // with the durable path's 600s deadline. Bounds only the request-receive
    // phase (Node clears it once the body has arrived), so long SSE responses
    // and slow generations are unaffected; multi-GB backup uploads on a LAN
    // still fit comfortably.
    requestTimeout: REQUEST_RECEIVE_TIMEOUT_MS,
  })

  if (config.requestTrace) {
    registerRequestTrace(app, { dataDir: config.dataDir, ...config.requestTrace })
  }

  await app.register(fastifyCompress, {
    global: true,
    globalDecompression: false,
    threshold: 1024,
  })

  await app.register(rateLimit, {
    global: false,
    max: 2000,
    timeWindow: '1 minute',
  })

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.bodyLimit,
      files: 1,
    },
  })

  app.addContentTypeParser(SUPPORTED_ASSET_CONTENT_TYPES, { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body)
  })
  app.addContentTypeParser(ASSET_BULK_BINARY_CONTENT_TYPE, { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body)
  })

  await app.register(fastifyWebsocket, {
    options: {
      perMessageDeflate: true,
    },
  })

  const db = openDatabase(config.dataDir)
  const activeWriterState = createActiveWriterState()
  // Legacy memory backfill reads chat.message[]; hydrate from the table (or the
  // still-embedded db.json on a first v3→v4 boot) so it sees the real history.
  backfillLegacyHypaV3MemoryRows(db, loadPersistedWithMessages(db, config.dataDir).database)
  // Proactively import any legacy db.json into SQLite and retire the file.
  // No-op once converged. Must run after the backfill above, which needs the
  // embedded messages on the first upgrade boot.
  ensureDbJsonImported(db, config.dataDir)
  const memoryEventBus = createMemoryEventBus()
  const emitMemoryEvent: MemoryEventSink = (event) => {
    if (opts.memoryEvents) {
      emitMemoryEventSafely(opts.memoryEvents, event)
    }
    memoryEventBus.emit(event)
  }
  const defaultSummarizeOptions = { db, dataDir: config.dataDir }
  const defaultEmbedOptions = { db, dataDir: config.dataDir }
  const defaultMemoryHandlers = {
    embed: createEmbedMemoryJobHandler(defaultEmbedOptions),
    summarize: createSummarizeMemoryJobHandler(defaultSummarizeOptions),
  }
  const memoryWorkerOptions = opts.memoryWorker === false ? null : (opts.memoryWorker ?? {})
  const defaultMemoryBatchHandlers = {
    ...(memoryWorkerOptions?.handlers?.embed === undefined
      ? { embed: createEmbedMemoryJobBatchHandler(defaultEmbedOptions) }
      : {}),
    ...(memoryWorkerOptions?.handlers?.summarize === undefined
      ? { summarize: createSummarizeMemoryJobBatchHandler(defaultSummarizeOptions) }
      : {}),
  }
  const memoryWorker =
    memoryWorkerOptions === null
      ? null
      : new MemoryWorker({
          db,
          onEvent: emitMemoryEvent,
          ...memoryWorkerOptions,
          handlers: {
            ...defaultMemoryHandlers,
            ...memoryWorkerOptions.handlers,
          },
          batchHandlers: {
            ...defaultMemoryBatchHandlers,
            ...memoryWorkerOptions.batchHandlers,
          },
        })
  memoryWorker?.start()
  const authState = createAuthState(config.dataDir, {
    agentDevAuthBypass: config.agentDevAuthBypass === true,
  })
  const commandEventSink = opts.commandEvents ?? createCommandEventSink()
  const streamJobRegistry = new JobRegistry()
  // Separately GC-ticked registry for detached chat generations and their
  // transient chatId→jobId submission lock.
  const generationJobRegistry = new GenerationJobRegistry()
  const messageTranslationJobRegistry = new MessageTranslationJobRegistry()
  const gcTimer = setInterval(() => {
    streamJobRegistry.tickGc()
    generationJobRegistry.tickGc()
  }, PROXY_STREAM_GC_INTERVAL_MS)
  gcTimer.unref()

  // Periodic, reference-counted reclamation of orphaned content-addressed
  // assets. Runs off the request hot path; a grace window protects bytes that
  // were just uploaded and are about to be referenced.
  const assetGcOptions = opts.assetGc === false ? null : (opts.assetGc ?? {})
  const assetGcTimer =
    assetGcOptions === null
      ? null
      : setInterval(() => {
          try {
            runAssetGc(config.dataDir, { ...assetGcOptions, db })
          } catch (err) {
            app.log.error({ err }, 'asset GC sweep failed')
          }
        }, assetGcOptions.intervalMs ?? ASSET_GC_INTERVAL_MS)
  assetGcTimer?.unref()
  let generationFinalizationRetryTimer: ReturnType<typeof setInterval> | null = null

  app.addHook('onClose', async () => {
    await memoryWorker?.stop()
    clearInterval(gcTimer)
    if (assetGcTimer) clearInterval(assetGcTimer)
    if (generationFinalizationRetryTimer) clearInterval(generationFinalizationRetryTimer)
    for (const job of streamJobRegistry.list()) {
      streamJobRegistry.deleteJob(job.id)
    }
    for (const job of generationJobRegistry.registry.list()) {
      generationJobRegistry.registry.deleteJob(job.id)
    }
    // Detached generation runners were just aborted; wait for them to settle
    // (their cancel path persists the streamed-so-far text) BEFORE closing the
    // SQLite handle, so no runner ever touches a closed database.
    await generationJobRegistry.settleRunners()
    db.close()
  })

  registerHealthRoutes(app, db)
  registerAuthRoutes(app, authState)
  registerBootstrapRoutes(
    app,
    db,
    authState,
    config.dataDir,
    activeWriterState,
    generationJobRegistry,
    messageTranslationJobRegistry,
  )
  registerActiveWriterGuard(app, activeWriterState)
  registerProjectionRoutes(app, db, authState, config.dataDir)
  registerSaveRoutes(app, db, authState, config.dataDir, commandEventSink, {
    maxExpandedImportBytes: config.bodyLimit,
    importMaxBytes: config.importMaxBytes,
  })
  registerRealmImportRoutes(app, db, authState, config.dataDir, commandEventSink, {
    hubUrl: config.hubUrl,
    realmUrl: config.realmUrl,
    maxExpandedImportBytes: config.bodyLimit,
    ...opts.realmImport,
  })
  registerCommandRoutes(app, db, authState, config.dataDir, commandEventSink, messageTranslationJobRegistry)
  registerEventsRoutes(app, db, authState, commandEventSink, memoryEventBus)
  registerAssetsRoutes(app, db, authState, config.dataDir, commandEventSink, activeWriterState)
  registerBackupRoutes(app, db, authState, config.dataDir, commandEventSink)
  registerProxyRoutes(app, authState)
  registerStreamJobRoutes(app, authState, streamJobRegistry)
  registerHubRoutes(app, authState, config.hubUrl)
  registerLegacyStorageRoutes(app, authState, config.dataDir)
  registerGenerationRoutes(app, db, authState, config.dataDir)
  registerGenerationChatRoutes(
    app,
    db,
    authState,
    config.dataDir,
    commandEventSink,
    generationJobRegistry,
    opts.generationChat,
  )
  const finalizationRetryRaw = opts.generationChat?.finalizationRetry
  const finalizationRetryOptions = finalizationRetryRaw === false ? false : (finalizationRetryRaw ?? {})
  const runGenerationFinalizationRetrySweep = (): void => {
    try {
      retryQueuedGenerationFinalizations({
        db,
        dataDir: config.dataDir,
        eventSink: commandEventSink,
        logger: app.log,
        maxPerSweep: finalizationRetryOptions !== false ? finalizationRetryOptions.maxPerSweep : undefined,
      })
    } catch (err) {
      app.log.error({ err }, 'generation finalization retry sweep failed')
    }
    try {
      pruneTerminalGenerationFinalizationRetries(db, {
        retentionMs: finalizationRetryOptions !== false ? finalizationRetryOptions.terminalRetentionMs : undefined,
        maxPerSweep:
          finalizationRetryOptions !== false ? finalizationRetryOptions.terminalRetentionMaxPerSweep : undefined,
      })
    } catch (err) {
      app.log.error({ err }, 'generation finalization retry retention sweep failed')
    }
  }
  if (finalizationRetryOptions !== false) {
    runGenerationFinalizationRetrySweep()
  }
  generationFinalizationRetryTimer =
    finalizationRetryOptions === false
      ? null
      : setInterval(runGenerationFinalizationRetrySweep, finalizationRetryOptions.intervalMs ?? 5000)
  generationFinalizationRetryTimer?.unref()
  registerMemoryJobRoutes(app, db, authState, { onEvent: emitMemoryEvent })
  registerMemoryReadRoutes(app, db, authState)
  bootPromptVariables()

  if (config.staticRoot && fs.existsSync(config.staticRoot)) {
    const staticAssetsRoot = path.join(config.staticRoot, 'assets')

    await app.register(fastifyStatic, {
      root: config.staticRoot,
      prefix: '/',
      wildcard: false,
      index: false,
      cacheControl: false,
      setHeaders: (res, filePath) => {
        res.setHeader(
          'Cache-Control',
          isPathWithin(staticAssetsRoot, filePath) ? STATIC_ASSET_CACHE_CONTROL : STATIC_REVALIDATE_CACHE_CONTROL,
        )
      },
    })

    app.get('/', async (_req, reply) => {
      return reply.sendFile('index.html')
    })

    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'not found' })
        return
      }
      return reply.sendFile('index.html')
    })
  }

  return { app, config }
}
