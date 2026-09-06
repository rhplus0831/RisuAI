import type { FastifyBrowserSmokeHook } from '@risuai/shared-core/browser-smoke'
import type {
  StartupCoordinatorSnapshot,
  StartupMilestone,
  StartupReadinessSnapshot,
} from '@risuai/protocol/startup-telemetry'

declare global {
  interface Window {
    __RISU_FASTIFY_BROWSER_SMOKE__?: FastifyBrowserSmokeHook<
      StartupCoordinatorSnapshot,
      StartupReadinessSnapshot,
      StartupMilestone
    >
  }
}

export {}
