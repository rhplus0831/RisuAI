import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyMultipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { createActiveWriterState, registerActiveWriterGuard } from './activeWriter.js'
import { type AppConfig, loadConfig } from './config.js'
import { createAuthState } from './auth.js'
import { createCommandEventSink, type CommandEventSink } from './commands/events.js'
import { openDatabase } from './db.js'
import { registerAssetsRoutes } from './routes/assets.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerBackupRoutes } from './routes/backups.js'
import { registerBootstrapRoutes } from './routes/bootstrap.js'
import { registerCommandRoutes } from './routes/commands.js'
import { registerEventsRoutes } from './routes/events.js'
import { registerGenerationRoutes } from './routes/generation.js'
import {
  registerGenerationChatRoutes,
  type GenerationChatRouteOptions,
} from './routes/generationChat.js'
import { bootPromptVariables } from './prompt/promptVariablesBoot.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerHubRoutes } from './routes/hub.js'
import { registerLegacyStorageRoutes } from './routes/legacyStorage.js'
import { registerMemoryJobRoutes } from './routes/memoryJobs.js'
import { registerMemoryReadRoutes } from './routes/memoryReads.js'
import { registerProxyRoutes } from './routes/proxy.js'
import { registerSaveRoutes } from './routes/save.js'
import { registerStreamJobRoutes } from './routes/streamJobs.js'
import { SUPPORTED_ASSET_CONTENT_TYPES, loadPersisted } from './repository.js'
import { JobRegistry, PROXY_STREAM_GC_INTERVAL_MS } from './streamJobs.js'
import {
  createMemoryEventBus,
  emitMemoryEventSafely,
  type MemoryEventSink,
} from './memoryEvents.js'
import { backfillLegacyHypaV3MemoryRows } from './memoryLegacyImport.js'
import { MemoryWorker, type MemoryWorkerOptions } from './memoryWorker.js'
import {
  createEmbedMemoryJobBatchHandler,
  createEmbedMemoryJobHandler,
} from './memoryEmbedJobHandler.js'
import {
  createSummarizeMemoryJobBatchHandler,
  createSummarizeMemoryJobHandler,
} from './memorySummarizeJobHandler.js'

export interface BuildAppOptions {
  config?: AppConfig
  generationChat?: GenerationChatRouteOptions
  memoryWorker?: false | Omit<MemoryWorkerOptions, 'db'>
  memoryEvents?: MemoryEventSink
  commandEvents?: CommandEventSink
}

export interface BuiltApp {
  app: FastifyInstance
  config: AppConfig
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<BuiltApp> {
  const config = opts.config ?? loadConfig()
  const app = Fastify({
    logger: process.env.LOG_LEVEL === 'silent' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: config.bodyLimit,
    trustProxy: config.trustProxy,
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

  app.addContentTypeParser(
    SUPPORTED_ASSET_CONTENT_TYPES,
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    },
  )

  await app.register(fastifyWebsocket)

  const db = openDatabase(config.dataDir)
  const activeWriterState = createActiveWriterState()
  backfillLegacyHypaV3MemoryRows(db, loadPersisted(config.dataDir).database)
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
  const authState = createAuthState(config.dataDir)
  const commandEventSink = opts.commandEvents ?? createCommandEventSink()
  const streamJobRegistry = new JobRegistry()
  const gcTimer = setInterval(() => {
    streamJobRegistry.tickGc()
  }, PROXY_STREAM_GC_INTERVAL_MS)
  gcTimer.unref()

  app.addHook('onClose', async () => {
    await memoryWorker?.stop()
    clearInterval(gcTimer)
    for (const job of streamJobRegistry.list()) {
      streamJobRegistry.deleteJob(job.id)
    }
    db.close()
  })

  registerHealthRoutes(app, db)
  registerAuthRoutes(app, authState)
  registerBootstrapRoutes(app, db, authState, config.dataDir, activeWriterState)
  registerActiveWriterGuard(app, activeWriterState)
  registerSaveRoutes(app, db, authState, config.dataDir, commandEventSink)
  registerCommandRoutes(app, db, authState, config.dataDir, commandEventSink)
  registerEventsRoutes(app, authState, commandEventSink, memoryEventBus)
  registerAssetsRoutes(app, db, authState, config.dataDir, commandEventSink)
  registerBackupRoutes(app, db, authState, config.dataDir, commandEventSink)
  registerProxyRoutes(app, authState)
  registerStreamJobRoutes(app, authState, streamJobRegistry)
  registerHubRoutes(app, authState, config.hubUrl)
  registerLegacyStorageRoutes(app, authState, config.dataDir)
  registerGenerationRoutes(app, authState)
  registerGenerationChatRoutes(
    app,
    db,
    authState,
    config.dataDir,
    commandEventSink,
    opts.generationChat,
  )
  registerMemoryJobRoutes(app, db, authState, { onEvent: emitMemoryEvent })
  registerMemoryReadRoutes(app, db, authState)
  bootPromptVariables()

  if (config.staticRoot && fs.existsSync(config.staticRoot)) {
    const indexPath = path.join(config.staticRoot, 'index.html')
    let cachedIndex: string | null = null
    const indexHtml = (): string => {
      if (cachedIndex !== null) return cachedIndex
      const raw = fs.readFileSync(indexPath, 'utf-8')
      const tag = '<script>globalThis.__FASTIFY__ = true;</script>'
      const headMatch = /<head(?:\s[^>]*)?>/i.exec(raw)
      cachedIndex = headMatch
        ? `${raw.slice(0, headMatch.index + headMatch[0].length)}\n${tag}${raw.slice(headMatch.index + headMatch[0].length)}`
        : `${tag}\n${raw}`
      return cachedIndex
    }

    await app.register(fastifyStatic, {
      root: config.staticRoot,
      prefix: '/',
      wildcard: false,
      index: false,
    })

    app.get('/', async (_req, reply) => {
      reply.type('text/html').send(indexHtml())
    })

    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'not found' })
        return
      }
      reply.type('text/html').send(indexHtml())
    })
  }

  return { app, config }
}
