import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { language } from 'src/lang'
import ModelProviderPanel from './ModelProviderPanel.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

const credentials = [
  { id: 'credential-api', name: 'API credential', type: 'apiKey' as const, apiKey: '__RISU_SECRET_MASKED__' },
  {
    id: 'credential-vertex',
    name: 'Vertex credential',
    type: 'vertexServiceAccount' as const,
    vertex: { clientEmail: 'vertex@example.com', privateKey: '__RISU_SECRET_MASKED__' },
  },
]

function props(providerId: string) {
  return {
    providerId,
    modelId: providerId === 'vertex' ? 'gemini-2.5-pro-vertex' : 'gpt-5',
    requestModel: '',
    credentialId: providerId === 'vertex' ? 'credential-vertex' : 'credential-api',
    credentials,
    onCreateCredential: vi.fn(),
    baseUrl: '',
    extraHeadersRows: [],
    additionalParamRows: [],
    ollamaRequestFormat: '',
    ollamaModelSource: '',
    ollamaThinkingMode: '',
    vertexProjectId: 'project-a',
    vertexRegion: 'us-central1',
    customTokenizer: '',
    customFlags: [],
  }
}

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

describe('ModelProviderPanel credential selection', () => {
  it('shows only API-key credentials for API-key providers and exposes the create affordance', async () => {
    const input = props('openai')
    component = mount(ModelProviderPanel, { target, props: input })
    await tick()

    const picker = target.querySelector<HTMLSelectElement>('[data-provider-credential-picker] select')
    expect(Array.from(picker?.options ?? []).map((option) => option.value)).toEqual(['', 'credential-api'])
    expect(target.querySelector('[data-secret-saved-state]')).toBeNull()

    const create = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(language.modelProfiles.createNewCredential),
    )
    create?.click()
    expect(input.onCreateCredential).toHaveBeenCalledWith('apiKey')
  })

  it('shows Vertex service-account credentials while keeping only deployment fields in the profile', async () => {
    component = mount(ModelProviderPanel, { target, props: props('vertex') })
    await tick()

    const picker = target.querySelector<HTMLSelectElement>('[data-provider-credential-picker] select')
    expect(Array.from(picker?.options ?? []).map((option) => option.value)).toEqual(['', 'credential-vertex'])
    expect(target.textContent).toContain(language.modelProfiles.vertexProjectId)
    expect(target.textContent).toContain(language.modelProfiles.vertexRegion)
    expect(target.textContent).not.toContain(language.modelProfiles.vertexClientEmail)
    expect(target.textContent).not.toContain(language.modelProfiles.vertexPrivateKey)
  })
})
