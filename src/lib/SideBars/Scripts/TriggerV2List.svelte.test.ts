import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: <T>(_key: string, fallback: T) => ({ value: fallback }),
}))

vi.mock('src/ts/process/triggers', () => ({
  displayAllowList: [],
  requestAllowList: [],
}))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', async () => {
  const mock = await import('../AuthorNoteEditor.testTextArea.svelte')
  return { default: mock.default }
})

vi.mock('src/lib/Others/Help.svelte', async () => {
  const mock = await import('../AuthorNoteEditor.testHelp.svelte')
  return { default: mock.default }
})

import TriggerV2ListHarness from './TriggerV2List.testHarness.svelte'
import type { triggerscript } from 'src/ts/process/triggers'

type MountedComponent = Parameters<typeof unmount>[0] & {
  setEffectField: (triggerIndex: number, effectIndex: number, field: string, nextValue: string) => void
}
type XssTestGlobal = typeof globalThis & { triggerV2Xss?: boolean }

let target: HTMLElement
let component: MountedComponent | undefined

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await tick()
    await Promise.resolve()
  }
}

beforeEach(() => {
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
})
