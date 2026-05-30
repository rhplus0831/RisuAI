// Invariant: buildApp registers the active-writer guard after bootstrap and
// before server-owned mutation routes.
import { registerBootstrapRoutes } from './routes/bootstrap.js'
import { registerActiveWriterGuard } from './activeWriter.js'
import {
  registerAssetsRoutes,
  registerBackupRoutes,
  registerCommandRoutes,
  registerGenerationChatRoutes,
  registerLegacyStorageRoutes,
  registerMemoryJobRoutes,
  registerSaveRoutes,
} from './routes/index.js'

export function buildApp(app: unknown, activeWriterState: unknown): void {
  registerBootstrapRoutes(app)
  registerActiveWriterGuard(app, activeWriterState)
  registerCommandRoutes(app)
  registerSaveRoutes(app)
  registerAssetsRoutes(app)
  registerBackupRoutes(app)
  registerLegacyStorageRoutes(app)
  registerGenerationChatRoutes(app)
  registerMemoryJobRoutes(app)
}
