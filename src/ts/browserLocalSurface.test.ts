import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readWorkspaceFile(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('Fastify-only browser local surface policy', () => {
  it('does not ship service-worker share or file-handler entry points', () => {
    const manifest = JSON.parse(readWorkspaceFile('public/manifest.json')) as Record<string, unknown>

    expect(existsSync(path.join(root, 'public/sw.js'))).toBe(false)
    expect(manifest).not.toHaveProperty('share_target')
    expect(manifest).not.toHaveProperty('file_handlers')
    expect(manifest.display).toBe('browser')
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

  it('does not keep standalone persistence or browser-local backup runtime paths', () => {
    const bootstrap = readWorkspaceFile('src/ts/bootstrap.ts')
    const platform = readWorkspaceFile('src/ts/platform.ts')
    const backup = readWorkspaceFile('src/ts/storage/backup.ts')
    const userSettings = readWorkspaceFile('src/lib/Setting/Pages/UserSettings.svelte')
    const globalApi = readWorkspaceFile('src/ts/globalApi.svelte.ts')

    expect(existsSync(path.join(root, 'src/ts/storage/persistant.ts'))).toBe(false)
    expect(bootstrap).not.toContain('display-mode: standalone')
    expect(bootstrap).not.toContain('navigator.storage.persist')
    expect(platform).not.toContain('isInStandaloneMode')
    expect(platform).not.toContain('android-app://')
    // The removed surfaces read/wrote browser-local persistence (forageStorage
    // and the Tauri filesystem). Those stay gone.
    expect(backup).not.toContain('SaveLocalBackup')
    expect(backup).not.toContain('SavePartialLocalBackup')
    expect(backup).not.toContain('LoadLocalBackup')
    expect(backup).not.toContain('LocalWriter')
    expect(backup).not.toContain('forageStorage')
    expect(backup).not.toContain('@tauri-apps')
    expect(userSettings).not.toContain('SavePartialLocalBackup')
    expect(userSettings).not.toContain('LoadLocalBackup')
    expect(globalApi).not.toContain("key.includes('dbbackup-')")
    expect(globalApi).not.toContain('Loaded backup')
  })

  it('restores Save/Load Backup Locally as a server-backed device backup', () => {
    // The user-facing "Save/Load Backup Locally" feature is restored as a
    // round-trip over server endpoints, not over removed browser-local
    // persistence. Save downloads the original Risu `.bin` format; the ZIP
    // bundle remains available as an explicit fallback.
    const backup = readWorkspaceFile('src/ts/storage/backup.ts')
    const userSettings = readWorkspaceFile('src/lib/Setting/Pages/UserSettings.svelte')

    expect(backup).toContain('exportServerLocalBackup')
    expect(backup).toContain('exportServerBundle')
    expect(backup).toContain('importServerBundle')
    expect(userSettings).toContain('saveBackupToDevice')
    expect(userSettings).toContain('saveZipBackupToDevice')
    expect(userSettings).toContain('loadBackupFromDevice')
  })

  it('does not bind DevTool variable editors directly to server scriptstate', () => {
    const devTool = readWorkspaceFile('src/lib/SideBars/DevTool.svelte')

    expect(devTool).toContain('dispatchPatchChatScriptstate')
    expect(devTool).not.toMatch(/bind:value=\{[\s\S]{0,240}?scriptstate\[/)
  })

  it('routes DevTool Autopilot message appends through a command helper', () => {
    const devTool = readWorkspaceFile('src/lib/SideBars/DevTool.svelte')
    const autopilotSection = devTool.slice(devTool.indexOf("<Accordion styled name={'Autopilot'}>"))

    expect(autopilotSection).toContain('appendCurrentChatUserMessageForSend')
    expect(autopilotSection).not.toMatch(/\.message\.push\(/)
    expect(autopilotSection).not.toContain('setDatabase(')
  })
})
