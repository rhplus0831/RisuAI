import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rendererMocks = vi.hoisted(() => ({
  checkCondition: vi.fn((item, ctx) => !item.condition || item.condition(ctx)),
  DBState: { db: {} as Record<string, unknown> },
  getModelInfo: vi.fn(() => ({
    id: 'renderer-model',
    name: 'Renderer Model',
    shortName: 'Renderer',
    fullName: 'Renderer Model',
    internalID: 'renderer-model',
    provider: 0,
    format: 0,
    flags: [],
    parameters: [],
    tokenizer: 0,
  })),
}))

vi.mock('src/ts/model/modellist', () => ({
  getModelInfo: rendererMocks.getModelInfo,
}))

vi.mock('src/ts/stores.svelte', () => ({
  DBState: rendererMocks.DBState,
}))

vi.mock('src/ts/setting/utils', () => ({
  checkCondition: rendererMocks.checkCondition,
}))

vi.mock('src/ts/setting/settingRegistry', async () => {
  const { default: HarnessWrapper } = await import('src/lib/Setting/testHarness/SettingRendererHarnessWrapper.svelte')
  return {
    settingRegistry: {
      check: HarnessWrapper,
      header: HarnessWrapper,
      select: HarnessWrapper,
      text: HarnessWrapper,
    },
  }
})

import SettingRenderer from './SettingRenderer.svelte'
import { DBState } from 'src/ts/stores.svelte'
import type { SettingItem } from 'src/ts/setting/types'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function rendererValue<T>(key: string): T {
  return (DBState.db as unknown as Record<string, T>)[key]
}

function setRendererValue(key: string, value: unknown): void {
  ;(DBState.db as unknown as Record<string, unknown>)[key] = value
}

async function changeTextInput(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await tick()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  rendererMocks.checkCondition.mockClear()
  rendererMocks.getModelInfo.mockClear()
  DBState.db = {
    aiModel: '',
    rendererChoice: 'alpha',
    rendererEnabled: false,
    rendererText: 'initial value',
    showHiddenRendererItem: false,
    subModel: '',
  } as any
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  DBState.db = {} as any
})

describe('SettingRenderer rendered behavior', () => {
  it('renders matching wrappers, filters hidden items, and writes user changes through item accessors', async () => {
    const items: SettingItem[] = [
      {
        id: 'renderer.heading',
        type: 'header',
        fallbackLabel: 'Renderer Harness',
        options: { level: 'h2' },
      },
      {
        id: 'renderer.enabled',
        type: 'check',
        fallbackLabel: 'Renderer Enabled',
        getValue: () => rendererValue<boolean>('rendererEnabled'),
        setValue: (_db, value) => setRendererValue('rendererEnabled', value),
      },
      {
        id: 'renderer.text',
        type: 'text',
        fallbackLabel: 'Renderer Text',
        getValue: () => rendererValue<string>('rendererText'),
        setValue: (_db, value) => setRendererValue('rendererText', value),
        options: { placeholder: 'Renderer text input' },
      },
      {
        id: 'renderer.choice',
        type: 'select',
        fallbackLabel: 'Renderer Choice',
        getValue: () => rendererValue<string>('rendererChoice'),
        setValue: (_db, value) => setRendererValue('rendererChoice', value),
        options: {
          selectOptions: [
            { value: 'alpha', label: 'Alpha choice' },
            { value: 'beta', label: 'Beta choice' },
            {
              value: 'hidden',
              label: 'Hidden choice',
              condition: (ctx) => Boolean((ctx.db as any).showHiddenRendererItem),
            },
          ],
        },
      },
      {
        id: 'renderer.hidden',
        type: 'header',
        fallbackLabel: 'Hidden Renderer Row',
        condition: (ctx) => Boolean((ctx.db as any).showHiddenRendererItem),
      },
      {
        id: 'renderer.unknown',
        type: 'unknown-renderer-type',
      } as unknown as SettingItem,
    ]

    component = mount(SettingRenderer, { target, props: { items } })
    await tick()

    expect(target.textContent).toContain('Renderer Harness')
    expect(target.textContent).toContain('Renderer Enabled')
    expect(target.textContent).toContain('Renderer Text')
    expect(target.textContent).toContain('Renderer Choice')
    expect(target.textContent).not.toContain('Hidden Renderer Row')
    expect(target.textContent).not.toContain('Hidden choice')
    expect(target.textContent).toContain('Unknown setting type: unknown-renderer-type')

    target.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click()
    await tick()
    expect(rendererValue<boolean>('rendererEnabled')).toBe(true)

    const textInput = target.querySelector<HTMLInputElement>('input[placeholder="Renderer text input"]')
    expect(textInput).toBeTruthy()
    await changeTextInput(textInput!, 'changed value')
    expect(rendererValue<string>('rendererText')).toBe('changed value')

    const select = target.querySelector<HTMLSelectElement>('select')
    expect(select).toBeTruthy()
    await changeSelect(select!, 'beta')
    expect(rendererValue<string>('rendererChoice')).toBe('beta')
  })

  it('passes renderer context to item conditions and wrappers', async () => {
    const items: SettingItem[] = [
      {
        id: 'renderer.prompt-context',
        type: 'header',
        fallbackLabel: 'Prompt override renderer row',
        condition: (ctx) => ctx.presetMirrorTarget === 'promptModelOverrides',
      },
    ]

    component = mount(SettingRenderer, {
      target,
      props: {
        items,
        presetMirrorTarget: 'promptModelOverrides',
      },
    })
    await tick()

    expect(rendererMocks.checkCondition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'renderer.prompt-context' }),
      expect.objectContaining({ presetMirrorTarget: 'promptModelOverrides' }),
    )
    expect(target.querySelector('[data-harness-setting="renderer.prompt-context"]')).toBeTruthy()
    expect(target.textContent).toContain('Prompt override renderer row')
  })
})
