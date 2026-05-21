import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { type AppConfig, loadConfig } from './config.js'
import { createAuthState } from './auth.js'
import { openDatabase } from './db.js'
import { registerAssetsRoutes } from './routes/assets.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerBackupRoutes } from './routes/backups.js'
import { registerBootstrapRoutes } from './routes/bootstrap.js'
import { registerGenerationRoutes } from './routes/generation.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerHubRoutes } from './routes/hub.js'
import { registerLegacyStorageRoutes } from './routes/legacyStorage.js'
import { registerProxyRoutes } from './routes/proxy.js'
import { registerSaveRoutes } from './routes/save.js'
import { registerStreamJobRoutes } from './routes/streamJobs.js'
import { SUPPORTED_ASSET_CONTENT_TYPES } from './repository.js'
import { JobRegistry, PROXY_STREAM_GC_INTERVAL_MS } from './streamJobs.js'

export interface BuildAppOptions {
  config?: AppConfig
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

  app.addContentTypeParser(
    SUPPORTED_ASSET_CONTENT_TYPES,
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    },
  )

  await app.register(fastifyWebsocket)

  const db = openDatabase(config.dataDir)
  const authState = createAuthState(config.dataDir)
  const streamJobRegistry = new JobRegistry()
  const gcTimer = setInterval(() => {
    streamJobRegistry.tickGc()
  }, PROXY_STREAM_GC_INTERVAL_MS)
  gcTimer.unref()

  app.addHook('onClose', async () => {
    clearInterval(gcTimer)
    for (const job of streamJobRegistry.list()) {
      streamJobRegistry.deleteJob(job.id)
    }
    db.close()
  })

  registerHealthRoutes(app, db)
  registerAuthRoutes(app, authState)
  registerBootstrapRoutes(app, db, authState, config.dataDir)
  registerSaveRoutes(app, db, authState, config.dataDir)
  registerAssetsRoutes(app, db, authState, config.dataDir)
  registerBackupRoutes(app, db, authState, config.dataDir)
  registerProxyRoutes(app, authState)
  registerStreamJobRoutes(app, authState, streamJobRegistry)
  registerHubRoutes(app, authState, config.hubUrl)
  registerLegacyStorageRoutes(app, authState, config.dataDir)
  registerGenerationRoutes(app, authState)

  if (config.staticRoot && fs.existsSync(config.staticRoot)) {
    const indexPath = path.join(config.staticRoot, 'index.html')
    let cachedIndex: string | null = null
    const indexHtml = (): string => {
      if (cachedIndex !== null) return cachedIndex
      const raw = fs.readFileSync(indexPath, 'utf-8')
      // __NODE__ activates every self-host gate in the SPA (NodeStorage,
      // save flow, prefer-remote saves); __FASTIFY__ disambiguates the
      // server family so URL builders can prefer /api/v1/* routes.
      const tag =
        '<script>globalThis.__NODE__ = true; globalThis.__FASTIFY__ = true;</script>'
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
