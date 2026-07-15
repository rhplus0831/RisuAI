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

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

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
  return Array.from(target.querySelectorAll('button')).filter((button) => button.textContent?.trim() === name)
}

describe('PlaygroundMCP tool execution', () => {
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
})
