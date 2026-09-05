import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createLocaleChunkUrlsPlugin } from './locale-chunk-urls'

function loadOwner(id = '/workspace/project/src/lang/localeChunkUrls.ts') {
  const plugin = createLocaleChunkUrlsPlugin('/workspace/project')
  let reference = 0
  const emitFile = vi.fn((_chunk: { type: string; id: string }) => `locale${++reference}`)
  if (typeof plugin.load !== 'function') throw new Error('Expected a load hook')
  const source = plugin.load.call({ emitFile } as never, id)
  return { plugin, emitFile, source }
}

describe('build-owned locale retry URLs', () => {
  it('emits only the six deferred pack chunks and refers to their exact build references', () => {
    const { plugin, emitFile, source } = loadOwner()
    expect(plugin.apply).toBe('build')
    expect(emitFile.mock.calls.map(([chunk]) => chunk)).toEqual(
      ['cn', 'de', 'es', 'ko', 'vi', 'zh-Hant'].map((code) => ({
        type: 'chunk',
        id: path.resolve('/workspace/project', `src/lang/${code}.ts`),
      })),
    )
    for (let index = 1; index <= 6; index++) {
      expect(source).toContain(`import.meta.ROLLUP_FILE_URL_locale${index}`)
    }
    expect(source).not.toContain('/assets/')
    expect(source).not.toContain('/src/')
    expect(source).not.toContain('import(')
    // URL reference resolution stays with the bundler, so '/' and './' bases
    // use the containing chunk URL rather than a deployment-root assumption.
    expect(source).not.toContain('window.location')
  })

  it('does not rewrite another module or invent entries for English', () => {
    const { emitFile, source } = loadOwner('/workspace/project/src/lang/en.ts')
    expect(source).toBeUndefined()
    expect(emitFile).not.toHaveBeenCalled()
  })
})
