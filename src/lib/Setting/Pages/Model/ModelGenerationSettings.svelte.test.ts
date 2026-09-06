import { mount, tick, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { language } from 'src/lang'
import { resolveModelRuntimeDefaults } from 'src/ts/model/modelProfileResolver'
import type { ModelProfileRecordRuntimeOptions } from 'src/ts/model/modelProfileRecords'
import ModelGenerationSettings from './ModelGenerationSettings.svelte'

let target: HTMLElement
let component: Parameters<typeof unmount>[0] | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
})

describe('common model generation settings', () => {
  it('displays effective defaults without copying them into the model and can restore inheritance', async () => {
    let value: ModelProfileRecordRuntimeOptions = { temperature: 70, stripCoT: true }
    const state = new SvelteMap([['value', value]])
    component = mount(ModelGenerationSettings, {
      target,
      props: {
        get value() {
          return state.get('value')!
        },
        set value(next) {
          value = next
          state.set('value', next)
        },
        defaults: { maxResponse: 4096, maxContext: 32768, useStreaming: true, halfStreaming: false },
      },
    })
    await tick()
    const response = target.querySelector<HTMLInputElement>('[data-runtime-field="maxResponse"]')!
    const inherited = target.querySelector<HTMLInputElement>('[data-runtime-default="maxResponse"]')!
    expect(response.value).toBe('4096')
    expect(response.disabled).toBe(true)
    expect(target.querySelector<HTMLInputElement>('[data-runtime-field="maxContext"]')?.value).toBe('32768')
    expect(value).toEqual({ temperature: 70, stripCoT: true })

    inherited.click()
    await tick()
    expect(response.disabled).toBe(false)
    expect(value).toEqual({ temperature: 70, stripCoT: true, maxResponse: 4096 })
    response.value = '8192'
    response.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    expect(value.maxResponse).toBe(8192)

    inherited.click()
    await tick()
    expect(response.value).toBe('4096')
    expect(response.disabled).toBe(true)
    expect(value).toEqual({ temperature: 70, stripCoT: true })
  })

  it('preserves explicit false overrides and lets both streaming modes inherit independently', async () => {
    let value: ModelProfileRecordRuntimeOptions = { useStreaming: false, halfStreaming: true, topP: 0.9 }
    const state = new SvelteMap([['value', value]])
    component = mount(ModelGenerationSettings, {
      target,
      props: {
        get value() {
          return state.get('value')!
        },
        set value(next) {
          value = next
          state.set('value', next)
        },
        defaults: { useStreaming: true, halfStreaming: false },
      },
    })
    await tick()
    const streaming = target.querySelector<HTMLSelectElement>('[data-runtime-field="useStreaming"]')!
    const halfStreaming = target.querySelector<HTMLSelectElement>('[data-runtime-field="halfStreaming"]')!
    expect(streaming.value).toBe('false')
    expect(halfStreaming.value).toBe('true')
    expect(streaming.options[0].textContent).toContain(language.modelProfiles.runtimeOn)
    expect(halfStreaming.options[0].textContent).toContain(language.modelProfiles.runtimeOff)
    halfStreaming.value = ''
    halfStreaming.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(value).toEqual({ useStreaming: false, topP: 0.9 })
    streaming.value = ''
    streaming.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(value).toEqual({ topP: 0.9 })
  })

  it('uses the canonical built-in defaults when editing global defaults', async () => {
    component = mount(ModelGenerationSettings, {
      target,
      props: { value: {}, scope: 'defaults', defaults: { maxResponse: 9999 } },
    })
    await tick()
    expect(target.querySelector<HTMLInputElement>('[data-runtime-field="maxResponse"]')?.value).toBe('500')
    expect(target.querySelector<HTMLInputElement>('[data-runtime-field="maxContext"]')?.value).toBe('4000')
    expect(target.textContent).toContain(language.modelProfiles.useBuiltInDefault)
    const defaults = resolveModelRuntimeDefaults({ maxResponse: 8000, useStreaming: false, temperature: 80 })
    expect(defaults).toMatchObject({ maxResponse: 8000, maxContext: 4000, useStreaming: false, temperature: 80 })
    defaults.modelTools!.push('changed')
    expect(resolveModelRuntimeDefaults().modelTools).toEqual([])
  })
})
