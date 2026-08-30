import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8')
}

describe('model-role shared-core ownership', () => {
  it('keeps every production consumer on the shared leaf', () => {
    const sharedImport = "from '@risuai/shared-core/model-roles'"
    for (const consumer of [
      'server/fastify/src/commands/modelProfiles.ts',
      'server/fastify/src/commands/presets.ts',
      'server/fastify/src/commands/splitPresets.ts',
      'server/fastify/src/databaseDefaults.ts',
      'server/fastify/src/ollamaCloudToolProxy.ts',
      'server/fastify/src/prompt/luaRuntime.ts',
      'server/fastify/src/routes/commands.ts',
      'server/fastify/src/routes/generation.ts',
      'src/lib/ChatScreens/Suggestion.svelte',
      'src/lib/Others/AllSeperateParameters.svelte',
      'src/lib/Others/IrisModal.svelte',
      'src/lib/Others/ProTools/EasyPanel.svelte',
      'src/lib/Playground/PlaygroundSubtitle.svelte',
      'src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte',
      'src/lib/Setting/Pages/Model/ModelPresetList.svelte',
      'src/lib/Setting/Pages/Model/ModelProfileList.svelte',
      'src/lib/Setting/Pages/Model/ModelProfileRoleList.svelte',
      'src/lib/Setting/Pages/Model/ModelRoleEditor.svelte',
      'src/lib/Setting/Pages/Model/ModelRoleList.svelte',
      'src/lib/Setting/Pages/Model/ModelSettingsShell.svelte',
      'src/ts/model/modelProfileMutations.ts',
      'src/ts/model/modelProfileUiState.ts',
      'src/ts/process/__fixtures__/mocks/serverCompletionFetch.ts',
      'src/ts/process/request/shared.ts',
      'src/ts/server/commands.ts',
      'src/ts/storage/database.svelte.ts',
    ]) {
      expect(source(consumer), consumer).toContain(sharedImport)
    }
    const resolverSource = source('packages/shared-core/src/modelProfileResolver.ts')
    expect(resolverSource).toContain("from './modelRoles.js'")
    expect(fs.existsSync(new URL('src/ts/model/modelRoles.ts', `file://${repoRoot}/`))).toBe(false)
  })
})
