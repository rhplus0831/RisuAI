import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const selectMocks = vi.hoisted(() => ({
  currentValue: undefined as unknown,
  setSettingValue: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/setting/utils', () => ({
  UNINITIALIZED: Symbol('UNINITIALIZED'),
  getLabel: (item: { fallbackLabel?: string; id: string }) => item.fallbackLabel ?? item.id,
  getSettingValue: () => selectMocks.currentValue,
  setSettingValue: (item: SettingItem, value: unknown, ctx: SettingContext) => {
    selectMocks.currentValue = value
    selectMocks.setSettingValue(item, value, ctx)
    item.onChange?.(value, ctx)
  },
}))

import SettingSelect from './SettingSelect.svelte'
import SettingConditionalOptionsTestHost from './SettingConditionalOptions.testHost.svelte'
import { languageSettingsItems } from 'src/ts/setting/languageSettingsData.svelte'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'

type MountedComponent = Parameters<typeof unmount>[0]
type MountedConditionalOptionsHost = MountedComponent & {
  replaceContext: (nextContext: SettingContext) => void
}

let target: HTMLElement
let component: MountedComponent | undefined

const ctx: SettingContext = {
  db: {} as any,
  modelInfo: {} as any,
  subModelInfo: {} as any,
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  selectMocks.currentValue = undefined
  selectMocks.setSettingValue.mockClear()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
})

describe('SettingSelect initial values', () => {
  it('renders and preserves the supported Spanish UI language', async () => {
    const action = vi.fn()
    const item = {
      ...languageSettingsItems.find((candidate) => candidate.id === 'lang.uiLanguage')!,
      onChange: action,
    }
    selectMocks.currentValue = 'es'

    component = mount(SettingSelect, { target, props: { item, ctx } })
    await tick()

    const select = target.querySelector('select')
    expect(select).toBeTruthy()
    expect(Array.from(select!.options).map((option) => [option.value, option.textContent])).toContainEqual([
      'es',
      'Español',
    ])
    expect(select!.value).toBe('es')
    expect(selectMocks.currentValue).toBe('es')
    expect(selectMocks.setSettingValue).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })

  it('does not rewrite an unknown persisted value to a trailing action option on mount', async () => {
    const action = vi.fn()
    const item: SettingItem = {
      id: 'test.language',
      type: 'select',
      fallbackLabel: 'Language',
      getValue: () => selectMocks.currentValue,
      setValue: (_db, value) => {
        selectMocks.currentValue = value
      },
      onChange: action,
      options: {
        selectOptions: [
          { value: 'en', label: 'English' },
          { value: 'action', label: 'Run language action' },
        ],
      },
    }
    selectMocks.currentValue = 'newer-language'

    component = mount(SettingSelect, { target, props: { item, ctx } })
    await tick()

    expect(selectMocks.currentValue).toBe('newer-language')
    expect(selectMocks.setSettingValue).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })

  it('does not rewrite a conditionally excluded persisted value on mount', async () => {
    const action = vi.fn()
    const item: SettingItem = {
      id: 'test.conditional-language',
      type: 'select',
      fallbackLabel: 'Conditional language',
      getValue: () => selectMocks.currentValue,
      setValue: (_db, value) => {
        selectMocks.currentValue = value
      },
      onChange: action,
      options: {
        selectOptions: [
          { value: 'en', label: 'English' },
          { value: 'temporarily-hidden', label: 'Temporarily hidden', condition: () => false },
          { value: 'action', label: 'Run language action' },
        ],
      },
    }
    selectMocks.currentValue = 'temporarily-hidden'

    component = mount(SettingSelect, { target, props: { item, ctx } })
    await tick()

    expect(selectMocks.currentValue).toBe('temporarily-hidden')
    expect(selectMocks.setSettingValue).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })

  it('coerces hidden values only after the semantic option set changes', async () => {
    const action = vi.fn()
    const item: SettingItem = {
      id: 'test.semantic-options',
      type: 'select',
      fallbackLabel: 'Semantic options',
      onChange: action,
      options: {
        selectOptions: [
          { value: 'standard', label: 'Standard' },
          { value: 'hidden', label: 'Hidden', condition: () => false },
          {
            value: 'advanced',
            label: 'Advanced',
            condition: (context) => Boolean((context.db as unknown as { advanced?: boolean }).advanced),
          },
        ],
      },
    }
    selectMocks.currentValue = 'hidden'
    const initialContext = { ...ctx, db: { advanced: false } as any }

    component = mount(SettingConditionalOptionsTestHost, {
      target,
      props: { initialContext, item, kind: 'select' },
    }) as MountedConditionalOptionsHost
    await tick()

    component.replaceContext({ ...ctx, db: { advanced: false } as any })
    await tick()
    expect(selectMocks.currentValue).toBe('hidden')
    expect(selectMocks.setSettingValue).not.toHaveBeenCalled()

    component.replaceContext({ ...ctx, db: { advanced: true } as any })
    await tick()
    await tick()
    expect(selectMocks.currentValue).toBe('advanced')
    expect(selectMocks.setSettingValue).toHaveBeenCalledOnce()
    expect(action).toHaveBeenCalledOnce()
  })

  it.each(['zh-TW', 'fa'])('preserves the hidden Google translation target %s on mount', async (value) => {
    const action = vi.fn()
    const item = {
      ...languageSettingsItems.find((candidate) => candidate.id === 'lang.translatorLang')!,
      onChange: action,
    }
    const nonGoogleContext: SettingContext = {
      ...ctx,
      db: { translatorType: 'deepl' } as any,
    }
    selectMocks.currentValue = value

    component = mount(SettingSelect, { target, props: { item, ctx: nonGoogleContext } })
    await tick()

    expect(Array.from(target.querySelector('select')!.options).map((option) => option.value)).not.toContain(value)
    expect(selectMocks.currentValue).toBe(value)
    expect(selectMocks.setSettingValue).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['invalid', 'unsupported-target'],
  ])('uses the explicit disabled fallback for a %s translation target', async (_case, value) => {
    const action = vi.fn()
    const item = {
      ...languageSettingsItems.find((candidate) => candidate.id === 'lang.translatorLang')!,
      onChange: action,
    }
    selectMocks.currentValue = value

    component = mount(SettingSelect, { target, props: { item, ctx } })
    await tick()

    const select = target.querySelector('select')
    expect(select?.value).toBe('')
    expect(select?.value).not.toBe('uk')
    expect(selectMocks.currentValue).toBe('')
    expect(selectMocks.setSettingValue).toHaveBeenCalledOnce()
    expect(selectMocks.setSettingValue).toHaveBeenCalledWith(item, '', ctx)
    expect(action).toHaveBeenCalledOnce()
    expect(action).toHaveBeenCalledWith('', ctx)
  })

  it('preserves a valid configured translation target', async () => {
    const action = vi.fn()
    const item = {
      ...languageSettingsItems.find((candidate) => candidate.id === 'lang.translatorLang')!,
      onChange: action,
    }
    selectMocks.currentValue = 'ko'

    component = mount(SettingSelect, { target, props: { item, ctx } })
    await tick()

    expect(target.querySelector('select')?.value).toBe('ko')
    expect(selectMocks.currentValue).toBe('ko')
    expect(selectMocks.setSettingValue).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })
})
