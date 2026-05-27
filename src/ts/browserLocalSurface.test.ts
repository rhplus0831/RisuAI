import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readWorkspaceFile(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('Fastify-only browser local surface policy', () => {
  it('does not ship service-worker share or file-handler entry points', () => {
    const manifest = JSON.parse(readWorkspaceFile('public/manifest.json')) as Record<
      string,
      unknown
    >

    expect(existsSync(path.join(root, 'public/sw.js'))).toBe(false)
    expect(manifest).not.toHaveProperty('share_target')
    expect(manifest).not.toHaveProperty('file_handlers')
    expect(existsSync(path.join(root, 'src/preload.ts'))).toBe(false)
  })

  it('does not keep client handlers for removed service-worker share routes', () => {
    const characterCards = readWorkspaceFile('src/ts/characterCards.ts')
    const globalApi = readWorkspaceFile('src/ts/globalApi.svelte.ts')

    expect(characterCards).not.toContain('#share_')
    expect(characterCards).not.toContain('/sw/share/')
    expect(characterCards).not.toContain('launchQueue')
    expect(globalApi).not.toContain('/sw/check/')
    expect(globalApi).not.toContain('/sw/register/')
    expect(globalApi).not.toContain('/sw/img/')
    expect(globalApi).not.toContain('setUsingSw')
  })
})
