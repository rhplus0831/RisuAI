import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: <T>(_key: string, fallback: T) => ({ value: fallback }),
}))

vi.mock('src/ts/process/triggers', () => ({
  displayAllowList: [],
  requestAllowList: [],
}))

vi.mock('src/ts/alert', () => ({
  alertError: vi.fn(),
}))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', async () => {
  const mock = await import('../AuthorNoteEditor.testTextArea.svelte')
  return { default: mock.default }
})

vi.mock('src/lib/Others/Help.svelte', async () => {
  const mock = await import('../AuthorNoteEditor.testHelp.svelte')
  return { default: mock.default }
})

vi.mock('src/lib/UI/GUI/Portal.svelte', async () => {
  const mock = await import('./TriggerV2List.testPortal.svelte')
  return { default: mock.default }
})

import TriggerV2ListHarness from './TriggerV2List.testHarness.svelte'
import type { triggerscript } from 'src/ts/process/triggers'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0] & {
  getValue: () => triggerscript[]
  setEffectField: (triggerIndex: number, effectIndex: number, field: string, nextValue: string) => void
  replaceOwner: (ownerKey: string, value: triggerscript[]) => void
}
type XssTestGlobal = typeof globalThis & { triggerV2Xss?: boolean }

let target: HTMLElement
let component: MountedComponent | undefined
const defaultInnerWidth = window.innerWidth

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await tick()
    await Promise.resolve()
  }
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

function triggerButton(name: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll<HTMLButtonElement>('button.trigger-item')).find(
    (candidate) => candidate.textContent?.trim() === name,
  )
  if (!button) throw new Error(`Trigger button not found: ${name}`)
  return button
}

function createDragDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => {
      values.set(type, value)
    },
    setDragImage: vi.fn(),
  } as unknown as DataTransfer
}

function dispatchDragEvent(element: Element, type: 'dragstart' | 'drop', dataTransfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  element.dispatchEvent(event)
  return event
}

async function openEditor(): Promise<void> {
  target.querySelector<HTMLButtonElement>('button')?.click()
  await settle()
}

beforeEach(() => {
  setViewportWidth(1024)
  delete (globalThis as XssTestGlobal).triggerV2Xss
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  document.body.innerHTML = ''
  setViewportWidth(defaultInnerWidth)
  delete (globalThis as XssTestGlobal).triggerV2Xss
  vi.clearAllMocks()
})

describe('TriggerV2List effect display', () => {
  it('renders imported and edited effect text literally without creating executable elements', async () => {
    const commentPayload = '</span><img data-trigger-v2-comment-xss src=x onerror="globalThis.triggerV2Xss = true">'
    const variablePayload = '</span><svg data-trigger-v2-field-xss onload="globalThis.triggerV2Xss = true"></svg>'
    const value: triggerscript[] = [
      {
        comment: 'Header',
        type: 'manual',
        conditions: [],
        effect: [],
      },
      {
        comment: 'Imported trigger',
        type: 'manual',
        conditions: [],
        effect: [
          { type: 'v2Comment', value: commentPayload, indent: 0 },
          {
            type: 'v2SetVar',
            operator: '=',
            var: 'safeVariable',
            value: commentPayload,
            valueType: 'value',
            indent: 1,
          },
        ],
      },
    ]

    component = mount(TriggerV2ListHarness, {
      target,
      props: { initialValue: value },
    }) as MountedComponent
    await settle()

    const editButton = target.querySelector<HTMLButtonElement>('button')
    expect(editButton).toBeTruthy()
    editButton!.click()
    await settle()

    const displays = Array.from(document.querySelectorAll<HTMLElement>('[data-risu-trigger-effect-display="true"]'))
    expect(displays).toHaveLength(2)
    expect(displays[0].textContent).toBe(`// ${commentPayload}`)
    expect(displays[0].querySelector('.text-gray-400')?.textContent).toBe(commentPayload)
    expect(document.querySelector('[data-trigger-v2-comment-xss]')).toBeNull()

    component.setEffectField(1, 1, 'var', variablePayload)
    await settle()

    expect(displays[1].textContent).toBe(`Set Variable ${variablePayload} = "${commentPayload}"`)
    expect(displays[1].querySelector('.text-yellow-500')?.textContent).toBe(variablePayload)
    expect(displays[1].style.marginLeft).toBe('1rem')

    expect(document.querySelector('[data-trigger-v2-field-xss]')).toBeNull()
    expect((globalThis as XssTestGlobal).triggerV2Xss).toBeUndefined()
  })

  it('names icon actions and exposes trigger, effect, and category selection', async () => {
    const value: triggerscript[] = [
      { comment: 'Header', type: 'manual', conditions: [], effect: [] },
      {
        comment: 'Alpha',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'v2Comment', value: 'Alpha effect', indent: 0 }],
      },
      { comment: 'Beta', type: 'manual', conditions: [], effect: [] },
    ]
    component = mount(TriggerV2ListHarness, {
      target,
      props: { initialValue: value },
    }) as MountedComponent
    await settle()

    target.querySelector<HTMLButtonElement>('button')?.click()
    await settle()

    const buttonByText = (text: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === text,
      )
    const alpha = buttonByText('Alpha')
    const beta = buttonByText('Beta')
    expect(alpha?.getAttribute('aria-pressed')).toBe('true')
    expect(beta?.getAttribute('aria-pressed')).toBe('false')
    beta?.click()
    await settle()
    expect(alpha?.getAttribute('aria-pressed')).toBe('false')
    expect(beta?.getAttribute('aria-pressed')).toBe('true')

    alpha?.click()
    await settle()
    const effect = document.querySelector<HTMLElement>('[data-risu-trigger-effect-display="true"]')?.closest('button')
    expect(effect?.getAttribute('aria-pressed')).toBe('false')
    effect?.click()
    await settle()
    expect(effect?.getAttribute('aria-pressed')).toBe('true')

    expect(document.querySelector(`[aria-label="${language.add}: ${language.trigger}"]`)).toBeTruthy()
    expect(document.querySelector(`[aria-label="${language.export}: ${language.trigger}"]`)).toBeTruthy()
    expect(document.querySelector(`[aria-label="${language.import}: ${language.trigger}"]`)).toBeTruthy()

    const addEffect = document.querySelector<HTMLButtonElement>(`[aria-label="${language.add}: ${language.effect}"]`)
    expect(addEffect).toBeTruthy()
    addEffect?.click()
    addEffect?.click()
    await settle()

    expect(document.querySelector(`[aria-label="${language.goback}"]`)).toBeTruthy()
    expect(buttonByText(language.triggerCategories.Control)?.getAttribute('aria-pressed')).toBe('true')
  })

  it('clears a multi-selection when the trigger owner changes', async () => {
    component = mount(TriggerV2ListHarness, {
      target,
      props: {
        initialValue: [
          { comment: 'Header A', type: 'manual', conditions: [], effect: [] },
          { comment: 'Alpha A', type: 'manual', conditions: [], effect: [] },
          { comment: 'Beta A', type: 'manual', conditions: [], effect: [] },
        ],
      },
    }) as MountedComponent
    await settle()
    target.querySelector<HTMLButtonElement>('button')?.click()
    await settle()

    const buttonByText = (text: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === text,
      )
    buttonByText('Alpha A')?.click()
    buttonByText('Beta A')?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    await settle()
    expect(buttonByText('Alpha A')?.getAttribute('aria-pressed')).toBe('true')
    expect(buttonByText('Beta A')?.getAttribute('aria-pressed')).toBe('true')

    component.replaceOwner('owner-b', [
      { comment: 'Header B', type: 'manual', conditions: [], effect: [] },
      { comment: 'Alpha B', type: 'manual', conditions: [], effect: [] },
      { comment: 'Beta B', type: 'manual', conditions: [], effect: [] },
    ])
    await settle()

    expect(buttonByText('Alpha A')).toBeUndefined()
    expect(buttonByText('Beta A')).toBeUndefined()
    expect(buttonByText('Alpha B')).toBeUndefined()
    expect(buttonByText('Beta B')).toBeUndefined()
    expect(target.textContent).toContain(language.edit)
  })

  it('renders array insertion fields without null or malformed placeholders', async () => {
    const value: triggerscript[] = [
      { comment: 'Header', type: 'manual', conditions: [], effect: [] },
      {
        comment: 'Array edits',
        type: 'manual',
        conditions: [],
        effect: [
          {
            type: 'v2UnshiftArrayVar',
            var: 'queue',
            value: 'first',
            valueType: 'value',
            indent: 0,
          },
          {
            type: 'v2SpliceArrayVar',
            var: 'queue',
            start: '2',
            startType: 'value',
            item: 'middle',
            itemType: 'value',
            indent: 0,
          },
        ],
      },
    ]
    component = mount(TriggerV2ListHarness, { target, props: { initialValue: value } }) as MountedComponent
    await settle()

    target.querySelector<HTMLButtonElement>('button')?.click()
    await settle()

    const summaries = Array.from(
      document.querySelectorAll<HTMLElement>('[data-risu-trigger-effect-display="true"]'),
      (display) => display.textContent ?? '',
    )
    expect(summaries).toEqual([
      'Add "first" as first value of Array Variable queue',
      'Add "middle" as "2" value of Array Variable queue',
    ])
    expect(summaries.join(' ')).not.toMatch(/null|{{|}}/)
  })

  it('leaves native editable-control shortcuts untouched', async () => {
    component = mount(TriggerV2ListHarness, {
      target,
      props: {
        initialValue: [
          { comment: 'Header', type: 'manual', conditions: [], effect: [] },
          { comment: 'Alpha', type: 'manual', conditions: [], effect: [] },
          { comment: 'Beta', type: 'manual', conditions: [], effect: [] },
        ],
      },
    }) as MountedComponent
    await settle()
    await openEditor()

    const nameInput = target.querySelector<HTMLInputElement>('input[type="text"]')
    const triggerTypeSelect = target.querySelector<HTMLSelectElement>('select')
    expect(nameInput).toBeTruthy()
    expect(triggerTypeSelect).toBeTruthy()

    const textarea = document.createElement('textarea')
    const contenteditable = document.createElement('div')
    contenteditable.setAttribute('contenteditable', 'true')
    target.append(textarea, contenteditable)

    for (const editable of [nameInput!, triggerTypeSelect!, textarea, contenteditable]) {
      editable.focus()
      const paste = new KeyboardEvent('keydown', {
        key: 'v',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      editable.dispatchEvent(paste)
      expect(paste.defaultPrevented).toBe(false)

      const arrow = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        altKey: true,
        bubbles: true,
        cancelable: true,
      })
      editable.dispatchEvent(arrow)
      expect(arrow.defaultPrevented).toBe(false)
    }

    expect(component.getValue().map((trigger) => trigger.comment)).toEqual(['Header', 'Alpha', 'Beta'])
  })

  it('keeps a selected trigger identity when an unselected row is dragged across it', async () => {
    component = mount(TriggerV2ListHarness, {
      target,
      props: {
        initialValue: [
          { comment: 'Header', type: 'manual', conditions: [], effect: [] },
          { comment: 'Alpha', type: 'manual', conditions: [], effect: [] },
          { comment: 'Beta', type: 'manual', conditions: [], effect: [] },
          { comment: 'Gamma', type: 'manual', conditions: [], effect: [] },
        ],
      },
    }) as MountedComponent
    await settle()
    await openEditor()

    triggerButton('Alpha').click()
    const dataTransfer = createDragDataTransfer()
    dispatchDragEvent(triggerButton('Gamma'), 'dragstart', dataTransfer)
    const firstDropTarget = target.querySelector<HTMLElement>('[role="listitem"]')
    expect(firstDropTarget).toBeTruthy()
    dispatchDragEvent(firstDropTarget!, 'drop', dataTransfer)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await settle()

    expect(component.getValue().map((trigger) => trigger.comment)).toEqual(['Header', 'Gamma', 'Alpha', 'Beta'])
    expect(triggerButton('Alpha').getAttribute('aria-pressed')).toBe('true')
    expect(triggerButton('Gamma').getAttribute('aria-pressed')).toBe('false')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }))
    await settle()

    expect(component.getValue().map((trigger) => trigger.comment)).toEqual([
      'Header',
      'Gamma',
      'Alpha',
      'Alpha',
      'Beta',
    ])
  })

  it('rebases a multi-selection and its shift-selection anchor after an unselected drag', async () => {
    component = mount(TriggerV2ListHarness, {
      target,
      props: {
        initialValue: [
          { comment: 'Header', type: 'manual', conditions: [], effect: [] },
          { comment: 'Alpha', type: 'manual', conditions: [], effect: [] },
          { comment: 'Beta', type: 'manual', conditions: [], effect: [] },
          { comment: 'Gamma', type: 'manual', conditions: [], effect: [] },
          { comment: 'Delta', type: 'manual', conditions: [], effect: [] },
        ],
      },
    }) as MountedComponent
    await settle()
    await openEditor()

    triggerButton('Alpha').click()
    triggerButton('Beta').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))

    const dataTransfer = createDragDataTransfer()
    dispatchDragEvent(triggerButton('Gamma'), 'dragstart', dataTransfer)
    dispatchDragEvent(target.querySelector<HTMLElement>('[role="listitem"]')!, 'drop', dataTransfer)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await settle()

    expect(triggerButton('Gamma').getAttribute('aria-pressed')).toBe('false')
    expect(triggerButton('Alpha').getAttribute('aria-pressed')).toBe('true')
    expect(triggerButton('Beta').getAttribute('aria-pressed')).toBe('true')

    triggerButton('Delta').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    await settle()

    expect(triggerButton('Gamma').getAttribute('aria-pressed')).toBe('false')
    expect(triggerButton('Alpha').getAttribute('aria-pressed')).toBe('true')
    expect(triggerButton('Beta').getAttribute('aria-pressed')).toBe('true')
    expect(triggerButton('Delta').getAttribute('aria-pressed')).toBe('true')
  })

  it('provides operable mobile move controls for triggers and their effects', async () => {
    setViewportWidth(767)
    component = mount(TriggerV2ListHarness, {
      target,
      props: {
        initialValue: [
          { comment: 'Header', type: 'manual', conditions: [], effect: [] },
          {
            comment: 'Alpha',
            type: 'manual',
            conditions: [],
            effect: [
              { type: 'v2Comment', value: 'One', indent: 0 },
              { type: 'v2Comment', value: 'Two', indent: 0 },
            ],
          },
          { comment: 'Beta', type: 'manual', conditions: [], effect: [] },
        ],
      },
    }) as MountedComponent
    await settle()
    await openEditor()

    const alphaUp = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moveUp}: Alpha"]`)
    const alphaDown = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moveDown}: Alpha"]`)
    const betaDown = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moveDown}: Beta"]`)
    expect(alphaUp?.disabled).toBe(true)
    expect(alphaDown?.disabled).toBe(false)
    expect(betaDown?.disabled).toBe(true)

    alphaDown?.click()
    await settle()
    expect(component.getValue().map((trigger) => trigger.comment)).toEqual(['Header', 'Beta', 'Alpha'])

    const firstEffectUp = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moveUp}: // One"]`)
    const firstEffectDown = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moveDown}: // One"]`)
    const lastEffectDown = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moveDown}: // Two"]`)
    expect(firstEffectUp?.disabled).toBe(true)
    expect(firstEffectDown?.disabled).toBe(false)
    expect(lastEffectDown?.disabled).toBe(true)

    firstEffectDown?.click()
    await settle()
    expect(component.getValue()[2].effect.map((effect) => (effect as { value?: string }).value)).toEqual(['Two', 'One'])
  })
})
