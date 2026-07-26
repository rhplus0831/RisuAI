import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ModelRuntimeOptionsEditor from './ModelRuntimeOptionsEditor.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('ModelRuntimeOptionsEditor tokenizer selection', () => {
  it('offers and selects every Fastify-supported tokenizer override', async () => {
    component = mount(ModelRuntimeOptionsEditor, { target, props: { value: {} } })
    await tick()

    const picker = target.querySelector<HTMLSelectElement>('[data-runtime-tokenizer-picker]')
    expect(Array.from(picker?.options ?? []).map((option) => option.value)).toEqual([
      '',
      'tik',
      'cl100k_base',
      'o200k_base',
      'mistral',
      'llama',
      'novelai',
      'claude',
      'novellist',
      'llama3',
      'gemma',
      'cohere',
      'deepseek',
      'deepseek-v4',
      'glm4',
      'glm5',
    ])

    if (!picker) throw new Error('Tokenizer picker was not rendered')
    picker.value = 'deepseek-v4'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(picker.value).toBe('deepseek-v4')
  })
})
