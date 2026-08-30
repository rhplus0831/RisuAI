import * as fflate from 'fflate'
import type {
  DallEImageGenerationRequest,
  FalImageGenerationRequest,
  ImageGenerationCredential,
  ImageGenerationRequest,
  ImagenImageGenerationRequest,
  KeiImageGenerationRequest,
  NovelAiImageGenerationRequest,
  OpenAiCompatibleImageGenerationRequest,
  StabilityImageGenerationRequest,
  WaveSpeedImageGenerationRequest,
} from '@risuai/protocol/image-generation-operation'
import { readBoundedBodyJson } from './generation/body.js'
import { MASKED_PROVIDER_SECRET } from './providerSecrets.js'
import { createTimeoutController } from './proxy.js'

export const IMAGE_GENERATION_TIMEOUT_MS = 10 * 60 * 1000
export const IMAGE_GENERATION_MAX_REQUEST_BYTES = 24 * 1024 * 1024
export const IMAGE_GENERATION_MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const IMAGE_GENERATION_MAX_UPSTREAM_BYTES = 32 * 1024 * 1024
export const IMAGE_GENERATION_MAX_REFERENCE_BYTES = 12 * 1024 * 1024
export const IMAGE_GENERATION_MAX_PROMPT_LENGTH = 100_000
export const IMAGE_GENERATION_MAX_API_KEY_LENGTH = 16 * 1024
export const WAVESPEED_MAX_POLL_ATTEMPTS = 200
export const WAVESPEED_POLL_INTERVAL_MS = 3_000

const MAX_DIMENSION = 2048
const MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION
const MAX_URL_LENGTH = 4_096
const MAX_NOVEL_ARCHIVE_ENTRIES = 64
const MAX_NOVEL_EXPANDED_BYTES = 32 * 1024 * 1024
const NOVEL_ZIP_PUSH_BYTES = 4_096

const NOVEL_PARAMETER_KEYS = [
  'params_version',
  'add_original_image',
  'cfg_rescale',
  'controlnet_strength',
  'dynamic_thresholding',
  'n_samples',
  'width',
  'height',
  'sampler',
  'steps',
  'scale',
  'negative_prompt',
  'sm',
  'sm_dyn',
  'noise_schedule',
  'normalize_reference_strength_multiple',
  'ucPreset',
  'uncond_scale',
  'qualityToggle',
  'legacy_v3_extend',
  'legacy',
  'autoSmea',
  'use_coords',
  'legacy_uc',
  'v4_prompt',
  'v4_negative_prompt',
  'reference_image_multiple',
  'reference_strength_multiple',
  'image',
  'strength',
  'noise',
  'seed',
  'extra_noise_seed',
  'prefer_brownian',
  'deliberate_euler_ancestral_bug',
  'skip_cfg_above_sigma',
  'director_reference_images',
  'director_reference_descriptions',
  'director_reference_information_extracted',
  'director_reference_strength_values',
] as const

const STABILITY_MODELS = new Set(['core', 'ultra', 'sd3-large', 'sd3-medium'])
const STABILITY_STYLES = new Set([
  '',
  '3d-model',
  'analog-film',
  'anime',
  'cinematic',
  'comic-book',
  'digital-art',
  'enhance',
  'fantasy-art',
  'isometric',
  'line-art',
  'low-poly',
  'modeling-compound',
  'neon-punk',
  'origami',
  'photographic',
  'pixel-art',
  'tile-texture',
])
const FAL_MODELS = new Set(['fal-ai/flux/dev', 'fal-ai/flux-lora', 'fal-ai/flux-pro', 'fal-ai/flux/schnell'])
const IMAGEN_MODELS = new Set([
  'imagen-4.0-generate-001',
  'imagen-4.0-ultra-generate-001',
  'imagen-4.0-fast-generate-001',
  'imagen-3.0-generate-002',
])
const IMAGEN_IMAGE_SIZES = new Set(['1K', '2K'])
const IMAGEN_ASPECT_RATIOS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9'])
const IMAGEN_PERSON_GENERATION = new Set(['allow_all', 'allow_adult', 'dont_allow'])
const OPENAI_IMAGE_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536', '512x512', '256x256'])
const OPENAI_IMAGE_QUALITIES = new Set(['auto', 'low', 'medium', 'high'])

type JsonRecord = Record<string, unknown>

export interface GeneratedImage {
  bytes: Buffer
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
}

export interface ImageGenerationExecutionOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxImageBytes?: number
  maxUpstreamBytes?: number
  maxWaveSpeedPollAttempts?: number
  waveSpeedPollIntervalMs?: number
  sleepImpl?: (ms: number, signal: AbortSignal) => Promise<void>
  keiHubUrl?: string
  signal?: AbortSignal
}

export type ImageGenerationErrorCode =
  | 'invalid_image_generation_request'
  | 'image_generation_credential_unavailable'
  | 'image_generation_configuration_invalid'
  | 'image_generation_failed'
  | 'image_generation_invalid_response'
  | 'image_generation_timeout'

export class ImageGenerationError extends Error {
  readonly code: ImageGenerationErrorCode
  readonly statusCode: number
  readonly upstreamStatus?: number

  constructor(code: ImageGenerationErrorCode, statusCode: number, upstreamStatus?: number) {
    super(code)
    this.name = 'ImageGenerationError'
    this.code = code
    this.statusCode = statusCode
    this.upstreamStatus = upstreamStatus
  }
}

export function parseImageGenerationRequest(body: unknown): ImageGenerationRequest {
  const root = readRecord(body)
  const provider = root.provider
  switch (provider) {
    case 'novelai':
      return parseNovelAiRequest(root)
    case 'dalle':
      return parseDallERequest(root)
    case 'stability':
      return parseStabilityRequest(root)
    case 'fal':
      return parseFalRequest(root)
    case 'imagen':
      return parseImagenRequest(root)
    case 'openai-compat':
      return parseOpenAiCompatibleRequest(root)
    case 'wavespeed':
      return parseWaveSpeedRequest(root)
    case 'kei':
      return parseKeiRequest(root)
    default:
      throw invalidRequest()
  }
}

export async function executeImageGeneration(
  request: ImageGenerationRequest,
  settings: JsonRecord,
  options: ImageGenerationExecutionOptions = {},
): Promise<GeneratedImage> {
  const timeout = createTimeoutController(options.timeoutMs ?? IMAGE_GENERATION_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal
  const context: ExecutionContext = {
    fetchImpl: options.fetchImpl ?? fetch,
    signal,
    maxImageBytes: options.maxImageBytes ?? IMAGE_GENERATION_MAX_IMAGE_BYTES,
    maxUpstreamBytes: options.maxUpstreamBytes ?? IMAGE_GENERATION_MAX_UPSTREAM_BYTES,
  }

  try {
    const apiKey = resolveCredential(request, settings)
    switch (request.provider) {
      case 'novelai':
        return await executeNovelAi(request, settings, requiredCredential(apiKey), context)
      case 'dalle':
        return await executeDallE(request, requiredCredential(apiKey), context)
      case 'stability':
        return await executeStability(request, requiredCredential(apiKey), context)
      case 'fal':
        return await executeFal(request, requiredCredential(apiKey), context)
      case 'imagen':
        return await executeImagen(request, requiredCredential(apiKey), context)
      case 'openai-compat':
        return await executeOpenAiCompatible(request, settings, apiKey, context)
      case 'wavespeed':
        return await executeWaveSpeed(request, requiredCredential(apiKey), context, options)
      case 'kei':
        return await executeKei(request, settings, requiredCredential(apiKey), context, options.keiHubUrl)
    }
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error
    if (signal.aborted) throw new ImageGenerationError('image_generation_timeout', 504)
    throw new ImageGenerationError('image_generation_failed', 502)
  } finally {
    timeout.cleanup()
  }
}

interface ExecutionContext {
  fetchImpl: typeof fetch
  signal: AbortSignal
  maxImageBytes: number
  maxUpstreamBytes: number
}

async function executeNovelAi(
  request: NovelAiImageGenerationRequest,
  settings: JsonRecord,
  apiKey: string,
  context: ExecutionContext,
): Promise<GeneratedImage> {
  const configuredUrl = readString(settings.NAIImgUrl) || 'https://image.novelai.net/ai/generate-image'
  const url = validateConfiguredEndpoint(configuredUrl)
  if (request.credential.source === 'stored' && !isOfficialNovelAiEndpoint(url)) {
    throw invalidConfiguration()
  }
  const response = await requestUpstream(
    url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/zip, application/octet-stream',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request.payload),
      redirect: 'error',
    },
    context,
  )
  const archive = await readBoundedBodyBytes(response, context.maxUpstreamBytes)
  return extractNovelAiImage(archive, context.maxImageBytes)
}

function isOfficialNovelAiEndpoint(value: string): boolean {
  const url = new URL(value)
  return (
    url.protocol === 'https:' &&
    url.hostname.toLowerCase() === 'image.novelai.net' &&
    (url.port === '' || url.port === '443')
  )
}

async function executeDallE(
  request: DallEImageGenerationRequest,
  apiKey: string,
  context: ExecutionContext,
): Promise<GeneratedImage> {
  const data = await requestJson(
    'https://api.openai.com/v1/images/generations',
    {
      method: 'POST',
      headers: jsonHeaders({ Authorization: `Bearer ${apiKey}` }),
      body: JSON.stringify({
        prompt: request.prompt,
        model: 'dall-e-3',
        response_format: 'b64_json',
        style: 'natural',
        quality: request.quality,
      }),
      redirect: 'error',
    },
    context,
  )
  return decodeJsonImage(data, context.maxImageBytes)
}

async function executeStability(
  request: StabilityImageGenerationRequest,
  apiKey: string,
  context: ExecutionContext,
): Promise<GeneratedImage> {
  const formData = new FormData()
  formData.append('prompt', request.prompt)
  if (request.model !== 'core' && request.model !== 'ultra') {
    formData.append('negative_prompt', request.negativePrompt)
    formData.append('model', request.model)
  } else if (request.model === 'core' && request.style) {
    formData.append('style_preset', request.style)
  } else if (request.model === 'ultra') {
    formData.append('negative_prompt', request.negativePrompt)
  }

  const endpoint = request.model === 'core' ? 'core' : request.model === 'ultra' ? 'ultra' : 'sd3'
  const response = await requestUpstream(
    `https://api.stability.ai/v2beta/stable-image/generate/${endpoint}`,
    {
      method: 'POST',
      headers: { Accept: 'image/*', Authorization: `Bearer ${apiKey}` },
      body: formData,
      redirect: 'error',
    },
    context,
  )
  return readImageResponse(response, context)
}

async function executeFal(
  request: FalImageGenerationRequest,
  apiKey: string,
  context: ExecutionContext,
): Promise<GeneratedImage> {
  const body: JsonRecord = {
    prompt: request.prompt,
    enable_safety_checker: false,
    sync_mode: true,
    image_size: { width: request.width, height: request.height },
  }
  if (request.lora) body.loras = [request.lora]
  if (request.model === 'fal-ai/flux-pro') delete body.enable_safety_checker

  const data = await requestJson(
    `https://fal.run/${encodePathSegments(request.model)}`,
    {
      method: 'POST',
      headers: jsonHeaders({ Authorization: `Key ${apiKey}` }),
      body: JSON.stringify(body),
      redirect: 'error',
    },
    context,
  )
  const outputUrl = readNestedString(data, 'images', 0, 'url')
  if (!outputUrl) throw invalidResponse()
  const url = validateGeneratedAssetUrl(outputUrl, 'fal')
  const response = await requestUpstream(url, { method: 'GET', redirect: 'error' }, context)
  return readImageResponse(response, context)
}

async function executeImagen(
  request: ImagenImageGenerationRequest,
  apiKey: string,
  context: ExecutionContext,
): Promise<GeneratedImage> {
  const parameters: JsonRecord = {
    sampleCount: 1,
    aspectRatio: request.aspectRatio,
    personGeneration: request.personGeneration,
  }
  if (request.model === 'imagen-4.0-generate-001' || request.model === 'imagen-4.0-ultra-generate-001') {
    parameters.sampleImageSize = request.imageSize
  }
  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:predict`,
  )
  url.searchParams.set('key', apiKey)
  const data = await requestJson(
    url.toString(),
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ instances: [{ prompt: request.prompt }], parameters }),
      redirect: 'error',
    },
    context,
  )
  const encoded = readNestedString(data, 'predictions', 0, 'bytesBase64Encoded')
  const declaredType = readNestedString(data, 'predictions', 0, 'mimeType')
  if (!encoded) throw invalidResponse()
  return decodeBase64Image(encoded, context.maxImageBytes, declaredType)
}

async function executeOpenAiCompatible(
  request: OpenAiCompatibleImageGenerationRequest,
  settings: JsonRecord,
  apiKey: string | undefined,
  context: ExecutionContext,
): Promise<GeneratedImage> {
  const config = readRecordOrNull(settings.openaiCompatImage)
  if (!config) throw invalidConfiguration()
  const url = validateConfiguredEndpoint(requiredConfigString(config.url))
  const model = optionalBoundedString(config.model, 256)
  const size = valueFromSet(config.size, OPENAI_IMAGE_SIZES)
  const quality = valueFromSet(config.quality, OPENAI_IMAGE_QUALITIES)
  const body: JsonRecord = {
    prompt: request.prompt,
    response_format: 'b64_json',
    size,
    quality,
  }
  if (model) body.model = model

  const data = await requestJson(
    url,
    {
      method: 'POST',
      headers: jsonHeaders(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      body: JSON.stringify(body),
      redirect: 'error',
    },
    context,
  )
  return decodeJsonImage(data, context.maxImageBytes)
}

async function executeWaveSpeed(
  request: WaveSpeedImageGenerationRequest,
  apiKey: string,
  context: ExecutionContext,
  options: ImageGenerationExecutionOptions,
): Promise<GeneratedImage> {
  const submit = await requestJson(
    `https://api.wavespeed.ai/api/v3/${encodePathSegments(request.model)}`,
    {
      method: 'POST',
      headers: jsonHeaders({ Authorization: `Bearer ${apiKey}` }),
      body: JSON.stringify({
        prompt: request.prompt,
        ...(request.images ? { images: request.images } : {}),
        ...(request.loras ? { loras: request.loras } : {}),
      }),
      redirect: 'error',
    },
    context,
  )
  const requestId = readNestedString(submit, 'data', 'id')
  if (!requestId || !/^[A-Za-z0-9_-]{1,256}$/.test(requestId)) throw invalidResponse()

  const attempts = options.maxWaveSpeedPollAttempts ?? WAVESPEED_MAX_POLL_ATTEMPTS
  const interval = options.waveSpeedPollIntervalMs ?? WAVESPEED_POLL_INTERVAL_MS
  const sleepImpl = options.sleepImpl ?? abortableSleep
  let outputUrl = ''
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await requestJson(
      `https://api.wavespeed.ai/api/v3/predictions/${encodeURIComponent(requestId)}/result`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
      },
      context,
    )
    const status = readNestedString(result, 'data', 'status')
    if (status === 'completed') {
      outputUrl = readNestedString(result, 'data', 'outputs', 0) ?? ''
      break
    }
    if (status === 'failed') throw new ImageGenerationError('image_generation_failed', 502)
    if (status !== 'created' && status !== 'pending' && status !== 'processing') throw invalidResponse()
    if (attempt + 1 < attempts) await sleepImpl(interval, context.signal)
  }
  if (!outputUrl) throw new ImageGenerationError('image_generation_timeout', 504)

  const url = validateGeneratedAssetUrl(outputUrl, 'wavespeed')
  // Generated asset URLs are public. Never forward the provider credential to
  // a result host supplied by the polling response.
  const response = await requestUpstream(url, { method: 'GET', redirect: 'error' }, context)
  return readImageResponse(response, context)
}

async function executeKei(
  request: KeiImageGenerationRequest,
  settings: JsonRecord,
  apiKey: string,
  context: ExecutionContext,
  hubUrl: string | undefined,
): Promise<GeneratedImage> {
  const configuredBase = readString(settings.keiServerURL)
  const base = configuredBase || (hubUrl ? `${hubUrl.replace(/\/$/, '')}/kei` : '')
  if (!base) throw invalidConfiguration()
  const endpoint = validateConfiguredEndpoint(`${base.replace(/\/$/, '')}/imaggen`)
  const data = await requestJson(
    endpoint,
    {
      method: 'POST',
      headers: jsonHeaders({ 'x-api-key': apiKey }),
      body: JSON.stringify({ prompt: request.prompt }),
      redirect: 'error',
    },
    context,
  )
  if (readNestedValue(data, 'success') !== true) {
    throw new ImageGenerationError('image_generation_failed', 502)
  }
  const result = readNestedString(data, 'data')
  if (!result) throw invalidResponse()
  return decodeImageDataUrl(result, context.maxImageBytes)
}

function parseNovelAiRequest(root: JsonRecord): NovelAiImageGenerationRequest {
  assertExactKeys(root, ['provider', 'credential', 'payload'])
  const payload = readExactRecord(root.payload, ['input', 'model', 'parameters', 'action'])
  boundedString(payload.input, IMAGE_GENERATION_MAX_PROMPT_LENGTH)
  const model = boundedString(payload.model, 128)
  if (!/^nai-diffusion-[A-Za-z0-9.-]+$/.test(model)) throw invalidRequest()
  if (payload.action !== 'generate' && payload.action !== 'img2img') throw invalidRequest()
  const parameters = readExactRecord(payload.parameters, NOVEL_PARAMETER_KEYS)
  validateNovelParameters(parameters, payload.action)
  return {
    provider: 'novelai',
    credential: parseCredential(root.credential),
    payload: cloneJson(payload),
  }
}

function validateNovelParameters(parameters: JsonRecord, action: unknown): void {
  const width = boundedInteger(parameters.width, 64, MAX_DIMENSION)
  const height = boundedInteger(parameters.height, 64, MAX_DIMENSION)
  if (width % 64 !== 0 || height % 64 !== 0 || width * height > MAX_PIXELS) throw invalidRequest()
  if (parameters.n_samples !== 1) throw invalidRequest()
  boundedInteger(parameters.steps, 1, 100)
  boundedNumber(parameters.scale, 0, 100)
  boundedStringAllowEmpty(parameters.negative_prompt, IMAGE_GENERATION_MAX_PROMPT_LENGTH)
  boundedString(parameters.sampler, 128)
  boundedString(parameters.noise_schedule, 128)
  boundedInteger(parameters.seed, 0, 0xffffffff)
  boundedInteger(parameters.extra_noise_seed, 0, 0xffffffff)

  validateOptionalBase64(parameters.image)
  validateOpaqueStringArray(parameters.reference_image_multiple, 4, IMAGE_GENERATION_MAX_REFERENCE_BYTES)
  validateOptionalBase64Array(parameters.director_reference_images, 4)
  validateNumberArray(parameters.reference_strength_multiple, 4, 0, 2)
  validateNumberArray(parameters.director_reference_information_extracted, 4, 0, 1)
  validateNumberArray(parameters.director_reference_strength_values, 4, 0, 2)
  if (parameters.director_reference_descriptions !== undefined) {
    if (
      !Array.isArray(parameters.director_reference_descriptions) ||
      parameters.director_reference_descriptions.length > 4
    ) {
      throw invalidRequest()
    }
    if (JSON.stringify(parameters.director_reference_descriptions).length > 64 * 1024) throw invalidRequest()
  }
  if (action === 'img2img' && typeof parameters.image !== 'string') throw invalidRequest()
}

function parseDallERequest(root: JsonRecord): DallEImageGenerationRequest {
  assertExactKeys(root, ['provider', 'credential', 'prompt', 'quality'])
  if (root.quality !== 'standard' && root.quality !== 'hd') throw invalidRequest()
  return {
    provider: 'dalle',
    credential: parseCredential(root.credential),
    prompt: boundedString(root.prompt, IMAGE_GENERATION_MAX_PROMPT_LENGTH),
    quality: root.quality,
  }
}

function parseStabilityRequest(root: JsonRecord): StabilityImageGenerationRequest {
  assertExactKeys(root, ['provider', 'credential', 'prompt', 'negativePrompt', 'model', 'style'])
  return {
    provider: 'stability',
    credential: parseCredential(root.credential),
    prompt: boundedString(root.prompt, IMAGE_GENERATION_MAX_PROMPT_LENGTH),
    negativePrompt: boundedStringAllowEmpty(root.negativePrompt, IMAGE_GENERATION_MAX_PROMPT_LENGTH),
    model: valueFromSet(root.model, STABILITY_MODELS),
    style: valueFromSet(root.style, STABILITY_STYLES),
  }
}

function parseFalRequest(root: JsonRecord): FalImageGenerationRequest {
  assertExactKeys(root, ['provider', 'credential', 'prompt', 'model', 'width', 'height', 'lora'])
  const width = boundedInteger(root.width, 64, MAX_DIMENSION)
  const height = boundedInteger(root.height, 64, MAX_DIMENSION)
  if (width * height > MAX_PIXELS) throw invalidRequest()
  const model = valueFromSet(root.model, FAL_MODELS)
  let lora: FalImageGenerationRequest['lora']
  if (root.lora !== undefined) {
    if (model !== 'fal-ai/flux-lora') throw invalidRequest()
    const value = readExactRecord(root.lora, ['path', 'scale'])
    lora = {
      path: normalizeFalLoraPath(boundedString(value.path, 2_048)),
      scale: boundedNumber(value.scale, 0, 2),
    }
  }
  return {
    provider: 'fal',
    credential: parseCredential(root.credential),
    prompt: boundedString(root.prompt, IMAGE_GENERATION_MAX_PROMPT_LENGTH),
    model,
    width,
    height,
    ...(lora ? { lora } : {}),
  }
}

function parseImagenRequest(root: JsonRecord): ImagenImageGenerationRequest {
  assertExactKeys(root, ['provider', 'credential', 'prompt', 'model', 'imageSize', 'aspectRatio', 'personGeneration'])
  return {
    provider: 'imagen',
    credential: parseCredential(root.credential),
    prompt: boundedString(root.prompt, IMAGE_GENERATION_MAX_PROMPT_LENGTH),
    model: valueFromSet(root.model, IMAGEN_MODELS),
    imageSize: valueFromSet(root.imageSize, IMAGEN_IMAGE_SIZES),
    aspectRatio: valueFromSet(root.aspectRatio, IMAGEN_ASPECT_RATIOS),
    personGeneration: valueFromSet(root.personGeneration, IMAGEN_PERSON_GENERATION),
  }
}

function parseOpenAiCompatibleRequest(root: JsonRecord): OpenAiCompatibleImageGenerationRequest {
  assertExactKeys(root, ['provider', 'credential', 'prompt'])
  return {
    provider: 'openai-compat',
    credential: parseCredential(root.credential),
    prompt: boundedString(root.prompt, IMAGE_GENERATION_MAX_PROMPT_LENGTH),
  }
}

function parseWaveSpeedRequest(root: JsonRecord): WaveSpeedImageGenerationRequest {
  assertExactKeys(root, ['provider', 'credential', 'prompt', 'model', 'images', 'loras'])
  const model = boundedString(root.model, 256)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){1,3}$/.test(model)) throw invalidRequest()
  let images: string[] | undefined
  if (root.images !== undefined) {
    images = validateBase64Array(root.images, 1)
  }
  let loras: WaveSpeedImageGenerationRequest['loras']
  if (root.loras !== undefined) {
    if (!Array.isArray(root.loras) || root.loras.length > 3) throw invalidRequest()
    loras = root.loras.map((row) => {
      const value = readExactRecord(row, ['path', 'scale'])
      return {
        path: boundedString(value.path, 2_048),
        scale: boundedNumber(value.scale, 0, 4),
      }
    })
  }
  return {
    provider: 'wavespeed',
    credential: parseCredential(root.credential),
    prompt: boundedString(root.prompt, IMAGE_GENERATION_MAX_PROMPT_LENGTH),
    model,
    ...(images ? { images } : {}),
    ...(loras ? { loras } : {}),
  }
}

function parseKeiRequest(root: JsonRecord): KeiImageGenerationRequest {
  assertExactKeys(root, ['provider', 'credential', 'prompt'])
  return {
    provider: 'kei',
    credential: parseCredential(root.credential),
    prompt: boundedString(root.prompt, IMAGE_GENERATION_MAX_PROMPT_LENGTH),
  }
}

function parseCredential(value: unknown): ImageGenerationCredential {
  const record = readRecord(value)
  if (record.source === 'none' || record.source === 'stored') {
    assertExactKeys(record, ['source'])
    return { source: record.source }
  }
  if (record.source === 'provided') {
    assertExactKeys(record, ['source', 'apiKey'])
    const apiKey = boundedString(record.apiKey, IMAGE_GENERATION_MAX_API_KEY_LENGTH)
    if (apiKey === MASKED_PROVIDER_SECRET || apiKey.trim().length === 0) throw invalidRequest()
    return { source: 'provided', apiKey }
  }
  throw invalidRequest()
}

function resolveCredential(request: ImageGenerationRequest, settings: JsonRecord): string | undefined {
  if (request.credential.source === 'none') return undefined
  if (request.credential.source === 'provided') return request.credential.apiKey

  const stored = (() => {
    switch (request.provider) {
      case 'novelai':
        return readString(settings.NAIApiKey)
      case 'dalle':
        return readString(settings.openAIKey)
      case 'stability':
        return readString(settings.stabilityKey)
      case 'fal':
        return readString(settings.falToken)
      case 'imagen':
        return readNestedString(settings, 'google', 'accessToken')
      case 'openai-compat':
        return readNestedString(settings, 'openaiCompatImage', 'key')
      case 'wavespeed':
        return readNestedString(settings, 'wavespeedImage', 'key')
      case 'kei':
        return readNestedString(settings, 'account', 'token')
    }
  })()
  if (!stored || stored === MASKED_PROVIDER_SECRET || stored.length > IMAGE_GENERATION_MAX_API_KEY_LENGTH) {
    return undefined
  }
  return stored
}

function requiredCredential(value: string | undefined): string {
  if (!value) throw new ImageGenerationError('image_generation_credential_unavailable', 422)
  return value
}

async function requestJson(url: string, init: RequestInit, context: ExecutionContext): Promise<unknown> {
  const response = await requestUpstream(url, init, context)
  try {
    return await readBoundedBodyJson(response, context.maxUpstreamBytes)
  } catch {
    if (context.signal.aborted) throw new ImageGenerationError('image_generation_timeout', 504)
    throw invalidResponse()
  }
}

async function requestUpstream(url: string, init: RequestInit, context: ExecutionContext): Promise<Response> {
  let response: Response
  try {
    response = await context.fetchImpl(url, { ...init, signal: context.signal })
  } catch {
    if (context.signal.aborted) throw new ImageGenerationError('image_generation_timeout', 504)
    throw new ImageGenerationError('image_generation_failed', 502)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new ImageGenerationError('image_generation_failed', 502, response.status)
  }
  return response
}

async function readImageResponse(response: Response, context: ExecutionContext): Promise<GeneratedImage> {
  const bytes = await readBoundedBodyBytes(response, context.maxImageBytes)
  return validateImageBytes(bytes, response.headers.get('content-type'))
}

async function readBoundedBodyBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw invalidResponse()
  }
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw invalidResponse()
      chunks.push(value)
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  )
}

function decodeJsonImage(data: unknown, maxBytes: number): GeneratedImage {
  const encoded = readNestedString(data, 'data', 0, 'b64_json')
  if (!encoded) throw invalidResponse()
  return decodeBase64Image(encoded, maxBytes)
}

function decodeBase64Image(encoded: string, maxBytes: number, declaredType?: string): GeneratedImage {
  let bytes: Buffer
  try {
    bytes = decodeBoundedBase64(encoded, maxBytes)
  } catch {
    throw invalidResponse()
  }
  return validateImageBytes(bytes, declaredType)
}

function decodeImageDataUrl(value: string, maxBytes: number): GeneratedImage {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value)
  if (!match) throw invalidResponse()
  return decodeBase64Image(match[2] ?? '', maxBytes, match[1])
}

function validateImageBytes(bytes: Uint8Array, _declaredType?: string | null): GeneratedImage {
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_GENERATION_MAX_IMAGE_BYTES) throw invalidResponse()
  let contentType: GeneratedImage['contentType']
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    contentType = 'image/png'
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    contentType = 'image/jpeg'
  } else if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  ) {
    contentType = 'image/webp'
  } else {
    throw invalidResponse()
  }
  return { bytes: Buffer.from(bytes), contentType }
}

function extractNovelAiImage(archive: Uint8Array, maxImageBytes: number): GeneratedImage {
  let parseError: Error | null = null
  let entryCount = 0
  let totalExpanded = 0
  let imageName = ''
  let imageBytes = 0
  const imageChunks: Uint8Array[] = []
  const setError = (error: Error): void => {
    parseError ??= error
  }

  try {
    const unzip = new fflate.Unzip()
    unzip.register(fflate.UnzipInflate)
    unzip.onfile = (file) => {
      entryCount += 1
      if (entryCount > MAX_NOVEL_ARCHIVE_ENTRIES) {
        setError(invalidResponse())
        return
      }
      const capture = !imageName && /\.(?:jpe?g|png|webp)$/i.test(file.name)
      if (capture) imageName = file.name
      file.ondata = (error, chunk) => {
        if (error) {
          setError(error)
          return
        }
        totalExpanded += chunk.byteLength
        if (totalExpanded > MAX_NOVEL_EXPANDED_BYTES) {
          setError(invalidResponse())
          return
        }
        if (capture) {
          imageBytes += chunk.byteLength
          if (imageBytes > maxImageBytes) {
            setError(invalidResponse())
            return
          }
          imageChunks.push(chunk)
        }
      }
      file.start()
    }

    for (let offset = 0; offset < archive.length && !parseError; offset += NOVEL_ZIP_PUSH_BYTES) {
      const end = Math.min(offset + NOVEL_ZIP_PUSH_BYTES, archive.length)
      unzip.push(archive.subarray(offset, end), end === archive.length)
    }
  } catch (error) {
    setError(error instanceof Error ? error : invalidResponse())
  }
  if (parseError || !imageName || imageBytes === 0) throw invalidResponse()
  return validateImageBytes(
    Buffer.concat(
      imageChunks.map((chunk) => Buffer.from(chunk)),
      imageBytes,
    ),
  )
}

function validateConfiguredEndpoint(value: string): string {
  if (value.length > MAX_URL_LENGTH) throw invalidConfiguration()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidConfiguration()
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname
  ) {
    throw invalidConfiguration()
  }
  return url.toString()
}

function validateGeneratedAssetUrl(value: string, provider: 'fal' | 'wavespeed'): string {
  if (value.length > MAX_URL_LENGTH) throw invalidResponse()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidResponse()
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
    throw invalidResponse()
  }
  const hostname = url.hostname.toLowerCase()
  const allowed =
    provider === 'fal'
      ? hostname === 'fal.media' || hostname.endsWith('.fal.media')
      : hostname === 'wavespeed.ai' || hostname.endsWith('.wavespeed.ai') || hostname.endsWith('.cloudfront.net')
  if (!allowed) throw invalidResponse()
  return url.toString()
}

function normalizeFalLoraPath(path: string): string {
  if (path.startsWith('urn:')) return path
  if (path.startsWith('civitai:')) {
    const id = path.split('@').pop()
    if (!id || !/^\d+$/.test(id)) throw invalidRequest()
    return `https://civitai.com/api/download/models/${id}?type=Model&format=SafeTensor`
  }
  let url: URL
  try {
    url = new URL(path)
  } catch {
    throw invalidRequest()
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw invalidRequest()
  return url.toString()
}

function validateOptionalBase64(value: unknown): void {
  if (value === undefined) return
  if (typeof value !== 'string') throw invalidRequest()
  decodeBoundedBase64(value, IMAGE_GENERATION_MAX_REFERENCE_BYTES)
}

function validateOptionalBase64Array(value: unknown, maxItems: number): void {
  if (value === undefined) return
  validateBase64Array(value, maxItems)
}

function validateOpaqueStringArray(value: unknown, maxItems: number, maxItemLength: number): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > maxItems) throw invalidRequest()
  for (const item of value) boundedString(item, maxItemLength)
}

function validateBase64Array(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw invalidRequest()
  return value.map((item) => {
    if (typeof item !== 'string') throw invalidRequest()
    decodeBoundedBase64(item, IMAGE_GENERATION_MAX_REFERENCE_BYTES)
    return item
  })
}

function decodeBoundedBase64(value: string, maxBytes: number): Buffer {
  if (value.length === 0 || value.length > Math.ceil(maxBytes / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw invalidRequest()
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw invalidRequest()
  return bytes
}

function validateNumberArray(value: unknown, maxItems: number, min: number, max: number): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > maxItems) throw invalidRequest()
  for (const item of value) boundedNumber(item, min, max)
}

function encodePathSegments(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/')
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Accept: 'application/json', 'Content-Type': 'application/json', ...extra }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function readNestedString(value: unknown, ...path: Array<string | number>): string | undefined {
  let current = value
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[segment]
    } else {
      if (!isRecord(current)) return undefined
      current = current[segment]
    }
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined
}

function readNestedValue(value: unknown, ...path: Array<string | number>): unknown {
  let current = value
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[segment]
    } else {
      if (!isRecord(current)) return undefined
      current = current[segment]
    }
  }
  return current
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) throw invalidRequest()
  return value
}

function readRecordOrNull(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null
}

function readExactRecord(value: unknown, keys: readonly string[]): JsonRecord {
  const record = readRecord(value)
  assertExactKeys(record, keys)
  return record
}

function assertExactKeys(record: JsonRecord, keys: readonly string[]): void {
  const allowed = new Set(keys)
  if (Object.keys(record).some((key) => !allowed.has(key))) throw invalidRequest()
}

function boundedString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) throw invalidRequest()
  return value
}

function boundedStringAllowEmpty(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw invalidRequest()
  return value
}

function optionalBoundedString(value: unknown, maxLength: number): string {
  if (value === undefined || value === '') return ''
  return boundedString(value, maxLength)
}

function requiredConfigString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) throw invalidConfiguration()
  return value
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw invalidRequest()
  return value
}

function boundedNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalidRequest()
  return value
}

function valueFromSet<T extends string>(value: unknown, allowed: ReadonlySet<T>): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) throw invalidRequest()
  return value as T
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function invalidRequest(): ImageGenerationError {
  return new ImageGenerationError('invalid_image_generation_request', 400)
}

function invalidConfiguration(): ImageGenerationError {
  return new ImageGenerationError('image_generation_configuration_invalid', 422)
}

function invalidResponse(): ImageGenerationError {
  return new ImageGenerationError('image_generation_invalid_response', 502)
}
