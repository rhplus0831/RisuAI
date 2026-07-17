import type { FastifyBrowserSmokeHook } from '../../../src/ts/server/browserSmoke.js'

declare global {
  interface Window {
    __RISU_FASTIFY_BROWSER_SMOKE__?: FastifyBrowserSmokeHook
  }
}

export {}
