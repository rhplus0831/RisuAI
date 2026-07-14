import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, 'public/manifest.json'), 'utf8')) as Record<string, unknown>
}

describe('Fastify-only browser manifest surface', () => {
  it('does not advertise removed share or file-handler entry points', () => {
    const manifest = readManifest()

    expect(existsSync(path.join(root, 'public/sw.js'))).toBe(false)
    expect(existsSync(path.join(root, 'public/service-worker.js'))).toBe(true)
    expect(manifest).not.toHaveProperty('share_target')
    expect(manifest).not.toHaveProperty('file_handlers')
    expect(manifest.display).toBe('standalone')
    expect(existsSync(path.join(root, 'src/preload.ts'))).toBe(false)
  })
})
