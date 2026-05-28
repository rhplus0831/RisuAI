// EC5 fixture: buildApp wiring. The active-writer guard must be registered
// after bootstrap (so the latest writer session is known) and before any
// server-owned mutation route registrar. The registrars are imported (not
// defined here) so the `(`-suffixed needles only match the ordered calls below.
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
