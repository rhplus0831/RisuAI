import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { type AppConfig, loadConfig } from './config.js'
import { createAuthState } from './auth.js'
import { openDatabase } from './db.js'
import { registerAssetsRoutes } from './routes/assets.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerBackupRoutes } from './routes/backups.js'
import { registerBootstrapRoutes } from './routes/bootstrap.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerSaveRoutes } from './routes/save.js'
import { SUPPORTED_ASSET_CONTENT_TYPES } from './repository.js'

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

  const db = openDatabase(config.dataDir)
  const authState = createAuthState(config.dataDir)

  app.addHook('onClose', async () => {
    db.close()
  })

  registerHealthRoutes(app, db)
  registerAuthRoutes(app, authState)
  registerBootstrapRoutes(app, db, authState, config.dataDir)
  registerSaveRoutes(app, db, authState, config.dataDir)
  registerAssetsRoutes(app, db, authState, config.dataDir)
  registerBackupRoutes(app, db, authState, config.dataDir)

  return { app, config }
}
