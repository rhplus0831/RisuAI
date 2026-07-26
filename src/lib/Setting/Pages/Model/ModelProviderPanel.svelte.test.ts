import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { language } from 'src/lang'
import ModelProviderPanel from './ModelProviderPanel.svelte'

const llmGatewayCatalog = vi.hoisted(() => ({
  getModels: vi.fn(),
}))

vi.mock('src/ts/model/llmgateway', () => ({
  getLLMGatewayModels: llmGatewayCatalog.getModels,
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
    llmGatewayReasoningEffort: '' as const,
    llmGatewayVerbosity: '' as const,
    llmGatewayServiceTier: '' as const,
    llmGatewayRouting: '' as const,
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
  llmGatewayCatalog.getModels.mockReset()
  llmGatewayCatalog.getModels.mockResolvedValue([])
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

  it('offers every Fastify-portable tokenizer for Custom API profiles', async () => {
    component = mount(ModelProviderPanel, { target, props: props('custom-api') })
    await tick()

    const picker = target.querySelector<HTMLSelectElement>('[data-custom-tokenizer-picker]')
    expect(Array.from(picker?.options ?? []).map((option) => option.value)).toEqual([
      '',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '11',
      '13',
      '14',
      '15',
      '16',
    ])

    if (!picker) throw new Error('Tokenizer picker was not rendered')
    picker.value = '6'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(picker.value).toBe('6')
  })

  it('loads and selects models from the LLM Gateway catalog', async () => {
    llmGatewayCatalog.getModels.mockResolvedValueOnce([{ id: 'gpt-4o-mini', name: 'Gateway Model' }])
    component = mount(ModelProviderPanel, { target, props: props('llmgateway') })

    await vi.waitFor(() => {
      expect(target.textContent).toContain('Gateway Model')
    })
    expect(llmGatewayCatalog.getModels).toHaveBeenCalledTimes(1)

    const modelButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Gateway Model'),
    )
    modelButton?.click()
    await tick()

    const modelInput = Array.from(target.querySelectorAll<HTMLInputElement>('input')).find(
      (input) => input.value === 'gpt-4o-mini',
    )
    expect(modelInput).toBeDefined()
  })

  it('offers every documented LLM Gateway request parameter value', async () => {
    component = mount(ModelProviderPanel, { target, props: props('llmgateway') })
    await tick()

    const values = (selector: string): string[] =>
      Array.from(target.querySelectorAll<HTMLOptionElement>(`${selector} option`)).map((option) => option.value)

    expect(values('[data-llm-gateway-reasoning-effort]')).toEqual([
      '',
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(values('[data-llm-gateway-verbosity]')).toEqual(['', 'low', 'medium', 'high'])
    expect(values('[data-llm-gateway-service-tier]')).toEqual(['', 'auto', 'default', 'flex', 'priority'])
    expect(values('[data-llm-gateway-routing]')).toEqual(['', 'auto', 'price', 'throughput', 'latency'])
  })
})
