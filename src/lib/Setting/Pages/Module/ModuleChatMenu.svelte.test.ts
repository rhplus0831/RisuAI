import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const moduleMenuDatabase = vi.hoisted(() => ({
  characters: [
    {
      chatPage: 0,
      chats: [{ modules: [] as string[] }] as Array<{
        modules: string[]
        generationSettings?: { personaId?: string; promptPresetId?: string; agentPresetId?: string }
        bindedPersona?: string
      }>,
      modules: [] as string[],
    },
  ],
  enabledModules: [] as string[],
  moduleIntergration: '',
  modules: [] as Array<{ id: string; name: string; namespace?: string; mcp?: unknown }>,
  personas: [] as Array<{ id: string; modules?: string[] }>,
  promptPresets: [] as Array<{ id: string; moduleIntergration?: string }>,
  agentPresets: [] as Array<{ id: string; enabled?: boolean; moduleIntergration?: string }>,
  agentPresetDefaultId: undefined as string | undefined,
  selectedPersona: 0,
}))

const moduleMenuMocks = vi.hoisted(() => ({
  toggleSelectedCharacterModule: vi.fn(),
  toggleSelectedChatModule: vi.fn(),
}))

const moduleMenuAlertMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
}))

const moduleMenuStores = vi.hoisted(() => {
  function writable<T>(initial: T) {
    let value = initial
    const subscribers = new Set<(next: T) => void>()
    return {
      set(next: T) {
        value = next
        for (const subscriber of subscribers) subscriber(value)
      },
      subscribe(subscriber: (next: T) => void) {
        subscribers.add(subscriber)
        subscriber(value)
        return () => subscribers.delete(subscriber)
      },
    }
  }

  return {
    selectedCharID: writable(0),
    SettingsMenuIndex: writable(0),
    settingsOpen: writable(false),
  }
})

vi.mock('src/ts/moduleCommands', () => moduleMenuMocks)
vi.mock('src/ts/alert', () => moduleMenuAlertMocks)
vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => moduleMenuDatabase,
}))
vi.mock('src/ts/stores.svelte', () => moduleMenuStores)

import { language } from 'src/lang'
import ModuleChatMenu from './ModuleChatMenu.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let opener: HTMLButtonElement
let target: HTMLElement

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

beforeEach(() => {
  moduleMenuDatabase.characters[0].chatPage = 0
  moduleMenuDatabase.characters[0].chats = [{ modules: [] }]
  moduleMenuDatabase.characters[0].modules = []
  moduleMenuDatabase.modules = []
  moduleMenuDatabase.enabledModules = []
  moduleMenuDatabase.moduleIntergration = ''
  moduleMenuDatabase.personas = []
  moduleMenuDatabase.promptPresets = []
  moduleMenuDatabase.agentPresets = []
  moduleMenuDatabase.agentPresetDefaultId = undefined
  moduleMenuDatabase.selectedPersona = 0
  moduleMenuMocks.toggleSelectedCharacterModule.mockReset()
  moduleMenuMocks.toggleSelectedChatModule.mockReset()
  moduleMenuMocks.toggleSelectedCharacterModule.mockResolvedValue({ status: 'accepted', result: null })
  moduleMenuMocks.toggleSelectedChatModule.mockResolvedValue({ status: 'accepted', result: null })
  moduleMenuAlertMocks.alertError.mockReset()
  moduleMenuAlertMocks.alertNormal.mockReset()
  opener = document.createElement('button')
  opener.textContent = 'Open modules'
  target = document.createElement('div')
  document.body.append(opener, target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  document.body.innerHTML = ''
})

describe('ModuleChatMenu modal behavior', () => {
  it('names the per-chat module toggle and removes the globally enabled placeholder button', async () => {
    moduleMenuDatabase.modules = [{ id: 'module-a', name: 'Module A' }]
    component = mount(ModuleChatMenu, { target, props: { close: vi.fn() } })
    await settle()

    const toggle = target.querySelector<HTMLButtonElement>('button[aria-label="Module: Module A"]')
    expect(toggle).toBeTruthy()
    expect(toggle!.getAttribute('aria-pressed')).toBe('false')

    unmount(component)
    component = undefined
    moduleMenuDatabase.enabledModules = ['module-a']
    component = mount(ModuleChatMenu, { target, props: { close: vi.fn() } })
    await settle()

    expect(target.querySelector('[aria-labelledby="disabled"]')).toBeNull()
    expect(target.querySelector('button[aria-label="Module: Module A"]')).toBeNull()
  })

  it('does not expose unsupported chat or character toggles for MCP modules', async () => {
    moduleMenuDatabase.modules = [{ id: 'mcp-a', name: 'MCP A', mcp: { url: 'internal:risuai' } }]
    component = mount(ModuleChatMenu, { target, props: { close: vi.fn() } })
    await settle()

    expect(target.textContent).toContain('MCP A')
    expect(target.querySelector('button[aria-label="Module: MCP A"]')).toBeNull()
    expect(moduleMenuMocks.toggleSelectedChatModule).not.toHaveBeenCalled()
    expect(moduleMenuMocks.toggleSelectedCharacterModule).not.toHaveBeenCalled()
  })

  it('shows Persona-linked modules as active without exposing a chat toggle', async () => {
    moduleMenuDatabase.modules = [{ id: 'module-a', name: 'Module A' }]
    moduleMenuDatabase.personas = [{ id: 'persona-a', modules: ['module-a'] }]
    moduleMenuDatabase.characters[0].chats = [{ modules: [], generationSettings: { personaId: 'persona-a' } }]
    component = mount(ModuleChatMenu, { target, props: { close: vi.fn() } })
    await settle()

    expect(target.textContent).toContain(language.personaModuleLinkActive)
    expect(target.querySelector('button[aria-label="Module: Module A"]')).toBeNull()
    expect(moduleMenuMocks.toggleSelectedChatModule).not.toHaveBeenCalled()
  })

  it('shows modules activated by the selected Prompt Preset namespace integration as active', async () => {
    moduleMenuDatabase.modules = [{ id: 'codex-module', name: 'Codex Module', namespace: 'Codex' }]
    moduleMenuDatabase.promptPresets = [{ id: 'gpt-preset', moduleIntergration: 'Codex' }]
    moduleMenuDatabase.characters[0].chats = [{ modules: [], generationSettings: { promptPresetId: 'gpt-preset' } }]
    component = mount(ModuleChatMenu, { target, props: { close: vi.fn() } })
    await settle()

    expect(target.querySelector('[data-module-activation-source="promptPresetIntegration"]')?.textContent).toContain(
      language.promptPresetModuleIntegrationActive,
    )
    expect(target.querySelector('button[aria-label="Module: Codex Module"]')).toBeNull()
    expect(moduleMenuMocks.toggleSelectedChatModule).not.toHaveBeenCalled()
  })

  it('shows pending and failed state when a chat-scoped toggle is rejected', async () => {
    moduleMenuDatabase.modules = [{ id: 'module-a', name: 'Module A' }]
    const dispatch = createDeferred<{
      status: 'failed'
      result: { status: 'conflict'; currentRevision: number }
    }>()
    moduleMenuMocks.toggleSelectedChatModule.mockReturnValueOnce(dispatch.promise)
    component = mount(ModuleChatMenu, { target, props: { close: vi.fn() } })
    await settle()

    const toggle = target.querySelector<HTMLButtonElement>('button[aria-label="Module: Module A"]')
    if (!toggle) throw new Error('Chat module toggle not found')
    toggle.click()
    await settle()

    expect(toggle.disabled).toBe(true)
    expect(target.querySelector('[data-module-mutation-status="module-a"]')).toBeNull()

    dispatch.resolve({ status: 'failed', result: { status: 'conflict', currentRevision: 12 } })
    await vi.waitFor(() =>
      expect(target.querySelector('[data-module-mutation-status="module-a"]')?.textContent).toContain(
        language.moduleSave.commandConflict,
      ),
    )
    expect(toggle.disabled).toBe(false)
    expect(moduleMenuAlertMocks.alertError).toHaveBeenCalledWith(language.moduleSave.commandConflict)
  })

  it('keeps a character-scoped toggle queued and reports a later replay failure', async () => {
    moduleMenuDatabase.modules = [{ id: 'module-a', name: 'Module A' }]
    const settlement = createDeferred<{
      status: 'failed'
      result: { status: 'unavailable' }
    }>()
    moduleMenuMocks.toggleSelectedCharacterModule.mockResolvedValueOnce({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationIds: ['mutation-a'],
      settlement: settlement.promise,
    })
    component = mount(ModuleChatMenu, { target, props: { close: vi.fn() } })
    await settle()

    const toggle = target.querySelector<HTMLButtonElement>('button[aria-label="Module: Module A"]')
    if (!toggle) throw new Error('Character module toggle not found')
    toggle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => expect(moduleMenuAlertMocks.alertNormal).toHaveBeenCalledWith(language.moduleSave.queued))
    expect(target.querySelector('[data-module-mutation-status="module-a"]')).toBeNull()
    expect(toggle.disabled).toBe(true)
    expect(moduleMenuAlertMocks.alertNormal).toHaveBeenCalledWith(language.moduleSave.queued)

    settlement.resolve({ status: 'failed', result: { status: 'unavailable' } })
    await vi.waitFor(() =>
      expect(target.querySelector('[data-module-mutation-status="module-a"]')?.textContent).toContain(
        language.moduleSave.commandUnavailable,
      ),
    )
    expect(toggle.disabled).toBe(false)
    expect(moduleMenuAlertMocks.alertError).toHaveBeenCalledWith(language.moduleSave.commandUnavailable)
  })

  it('contains focus, owns Escape, and restores the opener', async () => {
    const close = vi.fn()
    opener.focus()
    component = mount(ModuleChatMenu, { target, props: { close } })
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.closest<HTMLElement>('[data-modal-root]')
    const initialFocus = dialog?.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    if (!dialog || !backdrop || !initialFocus) throw new Error('Module chat menu dialog not found')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('risu-module-chat-menu-title')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(initialFocus)

    const last = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')).at(
      -1,
    )
    if (!last) throw new Error('Module chat menu focus target not found')
    last.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(initialFocus)

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    initialFocus.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith('')

    unmount(component)
    component = undefined
    await settle()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('closes only from the backdrop surface and keeps alert selection values', async () => {
    moduleMenuDatabase.modules = [{ id: 'module-a', name: 'Module A' }]
    const close = vi.fn()
    component = mount(ModuleChatMenu, { target, props: { alertMode: true, close } })
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.closest<HTMLElement>('[data-modal-root]')
    if (!dialog || !backdrop) throw new Error('Module chat menu dialog not found')

    dialog.click()
    expect(close).not.toHaveBeenCalled()
    backdrop.click()
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenLastCalledWith('')

    close.mockClear()
    const select = dialog.querySelector<HTMLButtonElement>('[aria-label$="Module A"]')
    if (!select) throw new Error('Alert-mode module selection not found')
    select.click()
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith('module-a')
  })
})
