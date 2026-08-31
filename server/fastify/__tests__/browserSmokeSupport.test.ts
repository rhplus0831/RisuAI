import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { browserSmokeEnglish } from '../browser-smoke/englishFixture.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function literalPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('browser-smoke support boundaries', () => {
  it('keeps English smoke labels parity-checked against the source language pack', () => {
    const languageSource = source('src/lang/en.ts')
    const fixtureSource = source('server/fastify/browser-smoke/englishFixture.ts')
    const fixture = browserSmokeEnglish

    for (const [key, value] of Object.entries(fixture)) {
      expect(languageSource).toMatch(new RegExp(`\\b${key}:\\s*'${literalPattern(value)}'`))
      expect(fixtureSource).toContain(`${key}:`)
    }
  })

  it('keeps smoke-only imports on test fixtures and protocol snapshots', () => {
    const lazyFirstOpen = source('server/fastify/browser-smoke/lazyFirstOpen.spec.ts')
    expect(lazyFirstOpen).not.toContain('../../../src/lang/en.js')
    expect(lazyFirstOpen).toContain('./englishFixture.js')

    for (const smokeSpec of [
      'server/fastify/browser-smoke/startupCachePopulationMatrix.spec.ts',
      'server/fastify/browser-smoke/startupRecoveryIntegrationMatrix.spec.ts',
    ]) {
      const smokeSource = source(smokeSpec)
      expect(smokeSource).not.toContain('../../../src/ts/startupReadiness.js')
      expect(smokeSource).toContain('@risuai/protocol/startup-telemetry')
    }
  })

  it('keeps the browser-smoke hook, route, and resource contracts on neutral owners', () => {
    const globals = source('server/fastify/browser-smoke/globals.d.ts')
    expect(globals).not.toContain('../../../src/')
    expect(globals).toContain('@risuai/shared-core/browser-smoke')

    const phase7DirectLinks = source('server/fastify/browser-smoke/phase7DirectLinks.ts')
    const startupDirectLinks = source('server/fastify/browser-smoke/startupDirectLinks.spec.ts')
    expect(phase7DirectLinks).not.toContain('../../../src/')
    expect(phase7DirectLinks).toContain('@risuai/shared-core/router-route')
    expect(phase7DirectLinks).toContain('@risuai/shared-core/resource-manifest')
    expect(startupDirectLinks).not.toContain('../../../src/')
    expect(startupDirectLinks).toContain('./phase7DirectLinks.js')

    expect(source('src/ts/routerRoute.ts').trim()).toBe("export * from '@risuai/shared-core/router-route'")
    expect(source('src/ts/server/resourceManifest.ts').trim()).toBe(
      "export * from '@risuai/shared-core/resource-manifest'",
    )
  })
})
