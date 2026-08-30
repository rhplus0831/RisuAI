import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

function runtimeSources(root: string): string[] {
  return fs.readdirSync(path.join(repoRoot, root), { recursive: true, encoding: 'utf8' }).filter((file) => {
    return typeof file === 'string' && (file.endsWith('.ts') || file.endsWith('.svelte')) && !file.endsWith('.test.ts')
  })
}

describe('prompt role shared-core ownership', () => {
  it('publishes both exact package subpaths and root exports', () => {
    const manifest = JSON.parse(source('packages/shared-core/package.json')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports['./prompt-template-normalization']).toBe('./src/promptTemplateNormalization.ts')
    expect(manifest.exports['./prompt-block-role']).toBe('./src/promptBlockRole.ts')

    const rootExports = source('packages/shared-core/src/index.ts')
    expect(rootExports).toContain("export * from './promptTemplateNormalization.js'")
    expect(rootExports).toContain("export * from './promptBlockRole.js'")
  })

  it('keeps browser compatibility facades and Fastify consumers on the exact shared leaves', () => {
    const normalizationSubpath = '@risuai/shared-core/prompt-template-normalization'
    const blockRoleSubpath = '@risuai/shared-core/prompt-block-role'

    expect(source('src/ts/process/promptTemplateNormalization.ts')).toContain(normalizationSubpath)
    expect(source('src/ts/process/promptBlockRole.ts')).toContain(blockRoleSubpath)
    expect(source('server/fastify/src/commands/prompts.ts')).toContain(normalizationSubpath)
    expect(source('server/fastify/src/prompt/templates.ts')).toContain(blockRoleSubpath)
  })

  it('closes the old Fastify-to-browser implementation edges', () => {
    const forbidden = ['src/ts/process/promptTemplateNormalization', 'src/ts/process/promptBlockRole']
    for (const relativePath of runtimeSources('server/fastify/src')) {
      const contents = source(`server/fastify/src/${relativePath}`)
      for (const browserOwner of forbidden) expect(contents, relativePath).not.toContain(browserOwner)
    }
  })

  it('keeps each browser facade free of a second implementation', () => {
    const normalizationFacade = source('src/ts/process/promptTemplateNormalization.ts')
    const blockRoleFacade = source('src/ts/process/promptBlockRole.ts')
    expect(normalizationFacade).not.toContain('switch (item.type)')
    expect(normalizationFacade).not.toContain('safeStructuredClone')
    expect(blockRoleFacade).not.toContain('for (const row of rows)')
    expect(blockRoleFacade).not.toContain("normalized === 'bot'")
  })
})
