import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mcpMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertMd: vi.fn(),
  callMCPToolFrom: vi.fn(),
  getMCPMeta: vi.fn(),
  getMCPTools: vi.fn(),
  initializeMCPs: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/process/mcp/mcp', () => ({
  callMCPToolFrom: mcpMocks.callMCPToolFrom,
  getMCPMeta: mcpMocks.getMCPMeta,
  getMCPTools: mcpMocks.getMCPTools,
  initializeMCPs: mcpMocks.initializeMCPs,
}))

vi.mock('src/ts/alert', () => ({
  alertError: mcpMocks.alertError,
  alertMd: mcpMocks.alertMd,
}))

import PlaygroundMCP from './PlaygroundMCP.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  mcpMocks.alertError.mockReset()
  mcpMocks.alertMd.mockReset().mockResolvedValue(undefined)
  mcpMocks.callMCPToolFrom.mockReset().mockResolvedValue([{ type: 'text', text: 'ok' }])
  mcpMocks.getMCPMeta.mockReset().mockResolvedValue({})
  mcpMocks.getMCPTools.mockReset().mockResolvedValue([
    {
      mcpURL: 'plugin:first',
      name: 'shared_tool',
      description: 'First tool',
      inputSchema: {},
    },
    {
      mcpURL: 'plugin:second',
      name: 'shared_tool',
      description: 'Second tool',
      inputSchema: {},
    },
  ])
  mcpMocks.initializeMCPs.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

function buttonsNamed(name: string): HTMLButtonElement[] {
  return Array.from(target.querySelectorAll('button')).filter(
    (button) =>
      button.textContent?.trim() === name || button.querySelector('[aria-hidden="true"]')?.textContent?.trim() === name,
  )
}

describe('PlaygroundMCP tool execution', () => {
  it('gives metadata and duplicate-name server tools distinct control names', async () => {
    component = mount(PlaygroundMCP, { target })

    expect(target.querySelector('textarea')?.getAttribute('aria-label')).toBe(language.playground.mcpMetadata)
    buttonsNamed('Refresh')[0].click()
    await vi.waitFor(() => expect(buttonsNamed('Execute shared_tool')).toHaveLength(2))

    expect(Array.from(target.querySelectorAll('textarea'), (input) => input.getAttribute('aria-label'))).toEqual([
      language.playground.mcpMetadata,
      language.playground.mcpToolInput('shared_tool', 'plugin:first'),
      language.playground.mcpToolInput('shared_tool', 'plugin:second'),
    ])
    expect(buttonsNamed('Execute shared_tool').map((button) => button.querySelector('.sr-only')?.textContent)).toEqual([
      language.playground.mcpExecuteTool('shared_tool', 'plugin:first'),
      language.playground.mcpExecuteTool('shared_tool', 'plugin:second'),
    ])
  })

  it('serializes refreshes and recovers after a refresh failure', async () => {
    const initialization = deferred<void>()
    mcpMocks.initializeMCPs.mockReturnValueOnce(initialization.promise)
    component = mount(PlaygroundMCP, { target })

    const refresh = buttonsNamed('Refresh')[0]
    refresh.click()
    refresh.click()
    await tick()

    expect(mcpMocks.initializeMCPs).toHaveBeenCalledOnce()
    expect(refresh.disabled).toBe(true)

    initialization.resolve()
    await vi.waitFor(() => expect(refresh.disabled).toBe(false))

    mcpMocks.initializeMCPs.mockRejectedValueOnce(new Error('MCP refresh failed'))
    refresh.click()
    await vi.waitFor(() => expect(mcpMocks.alertError).toHaveBeenCalledWith('MCP refresh failed'))
    expect(refresh.disabled).toBe(false)
  })

  it('keeps duplicate-name inputs separate and executes the selected server tool', async () => {
    component = mount(PlaygroundMCP, { target })

    buttonsNamed('Refresh')[0].click()
    await vi.waitFor(() => expect(buttonsNamed('Execute shared_tool')).toHaveLength(2))

    const toolCards = Array.from(target.querySelectorAll('div')).filter((element) =>
      element.classList.contains('border-gray-300'),
    )
    expect(toolCards).toHaveLength(2)
    const secondInput = toolCards[1].querySelector('textarea')
    if (!(secondInput instanceof HTMLTextAreaElement)) throw new Error('Second tool input not found')
    secondInput.value = '{"target":"second"}'
    secondInput.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    buttonsNamed('Execute shared_tool')[1].click()
    await vi.waitFor(() => {
      expect(mcpMocks.callMCPToolFrom).toHaveBeenCalledWith('plugin:second', 'shared_tool', {
        target: 'second',
      })
    })

    buttonsNamed('Execute shared_tool')[0].click()
    await vi.waitFor(() => {
      expect(mcpMocks.callMCPToolFrom).toHaveBeenCalledWith('plugin:first', 'shared_tool', {})
    })
    expect(mcpMocks.alertError).not.toHaveBeenCalled()
  })

  it('disables a pending tool and ignores duplicate activation', async () => {
    const execution = deferred<Array<{ type: string; text: string }>>()
    mcpMocks.callMCPToolFrom.mockReturnValueOnce(execution.promise)
    component = mount(PlaygroundMCP, { target })

    buttonsNamed('Refresh')[0].click()
    await vi.waitFor(() => expect(buttonsNamed('Execute shared_tool')).toHaveLength(2))
    const execute = buttonsNamed('Execute shared_tool')[0]

    execute.click()
    execute.click()
    await tick()

    expect(mcpMocks.callMCPToolFrom).toHaveBeenCalledOnce()
    expect(execute.disabled).toBe(true)

    execution.resolve([{ type: 'text', text: 'ok' }])
    await vi.waitFor(() => expect(mcpMocks.alertMd).toHaveBeenCalledOnce())
    await tick()
    expect(execute.disabled).toBe(false)
  })
})
