import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { language } from 'src/lang'
import ModelProfileEditorDrawer from './ModelProfileEditorDrawer.svelte'

vi.mock('src/ts/model/llmgateway', () => ({
  getLLMGatewayModels: vi.fn().mockResolvedValue([]),
  toModelGridItem: (model: { id: string; name: string }) => ({
    id: model.id,
    displayName: model.name,
    providerName: 'LLM Gateway',
    description: '',
    context_length: 0,
    sortPrice: 0,
    prices: [],
  }),
}))

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

describe('ModelProfileEditorDrawer credentials', () => {
  it('saves a credential reference without placing a secret in the profile row', async () => {
    const onSave = vi.fn()
    const profile = {
      id: 'profile-a',
      name: 'Profile A',
      providerId: 'openai',
      modelId: 'gpt-5',
      providerOptions: { credentialId: 'credential-api' },
    }
    component = mount(ModelProfileEditorDrawer, {
      target,
      props: {
        mode: 'edit',
        profile,
        profiles: [profile],
        credentials: [
          {
            id: 'credential-api',
            name: 'OpenAI',
            type: 'apiKey',
            apiKey: '__RISU_SECRET_MASKED__',
          },
        ],
        usedByRoles: [],
        statusText: 'Ready',
        onSave,
        onCancel: vi.fn(),
        onManageCredentials: vi.fn(),
      },
    })
    await tick()

    const name = target.querySelector<HTMLInputElement>('input:not([type="password"])')
    if (!name) throw new Error('Profile name input not found')
    name.value = 'Profile A renamed'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const save = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(language.modelProfiles.save),
    )
    expect(save?.disabled).toBe(false)
    save?.click()
    await tick()

    expect(onSave).toHaveBeenCalledWith({
      id: 'profile-a',
      name: 'Profile A renamed',
      providerId: 'openai',
      modelId: 'gpt-5',
      providerOptions: { credentialId: 'credential-api' },
    })
    expect(JSON.stringify(onSave.mock.calls)).not.toContain('__RISU_SECRET_MASKED__')
  })

  it('preserves LLM Gateway request parameter selections when saving a profile', async () => {
    const onSave = vi.fn()
    const profile = {
      id: 'gateway-profile',
      name: 'Gateway Profile',
      providerId: 'llmgateway',
      modelId: 'openai/gpt-5',
      providerOptions: {
        credentialId: 'credential-api',
        llmGateway: {
          reasoningEffort: 'max' as const,
          verbosity: 'high' as const,
          serviceTier: 'priority' as const,
        },
      },
    }
    component = mount(ModelProfileEditorDrawer, {
      target,
      props: {
        mode: 'edit',
        profile,
        profiles: [profile],
        credentials: [
          {
            id: 'credential-api',
            name: 'LLM Gateway',
            type: 'apiKey',
            apiKey: '__RISU_SECRET_MASKED__',
          },
        ],
        usedByRoles: [],
        statusText: 'Ready',
        onSave,
        onCancel: vi.fn(),
        onManageCredentials: vi.fn(),
      },
    })
    await tick()

    expect(target.querySelector<HTMLSelectElement>('[data-llm-gateway-reasoning-effort]')?.value).toBe('max')
    expect(target.querySelector<HTMLSelectElement>('[data-llm-gateway-verbosity]')?.value).toBe('high')
    expect(target.querySelector<HTMLSelectElement>('[data-llm-gateway-service-tier]')?.value).toBe('priority')

    const name = target.querySelector<HTMLInputElement>('input:not([type="password"])')
    if (!name) throw new Error('Profile name input not found')
    name.value = 'Gateway Profile renamed'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    const save = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(language.modelProfiles.save),
    )
    save?.click()
    await tick()

    expect(onSave).toHaveBeenCalledWith({
      ...profile,
      name: 'Gateway Profile renamed',
    })
  })
})
