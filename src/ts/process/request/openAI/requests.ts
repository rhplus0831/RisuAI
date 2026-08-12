import { language } from 'src/lang'
import { alertError } from 'src/ts/alert'
import { getDatabase } from 'src/ts/storage/database.svelte'
import { LLMFlags, LLMFormat, LLMProvider } from 'src/ts/model/modellist'
import { strongBan, tokenizeNum } from 'src/ts/tokenizer'
import { getFreeOpenRouterModels } from 'src/ts/model/openrouter'
import { addFetchLog, fetchNative, globalFetch, textifyReadableStream } from 'src/ts/globalApi.svelte'
import { simplifySchema } from 'src/ts/util'
import { isLocalNetworkUrl } from 'src/ts/network/localNetwork'
import { normalizeLegacyOpenAIModelId } from 'src/ts/model/legacyOpenAIModelAliases'

import { extractJSON, getOpenAIJSONSchema } from '../../templates/jsonSchema'
import { applyChatTemplate } from '../../templates/chatTemplate'
import { supportsInlayImage } from '../../files/inlays'
import { callTool, decodeToolCall, encodeToolCall } from '../../mcp/mcp'
import type { RequestDataArgumentExtended, requestDataResponse, StreamResponseChunk } from '../request'
import {
  applyAdditionalParameters,
  applyParameters,
  getAdditionalParameters,
  getRequestAdditionalParameters,
} from '../shared'

import type {
  Contents,
  OpenAIChatExtra,
  OpenAIChatFull,
  ResponseFunctionCallItem,
  ResponseInputItem,
  ResponseItem,
  ResponseOutputContent,
  ToolCall,
} from './types'

interface LocalNetworkRequestOptions {
  networkRoute?: 'auto' | 'local_network'
  requestTimeoutMs?: number
}

const CHAT_COMPLETIONS_SUFFIX = '/chat/completions'
const RESPONSES_SUFFIX = '/responses'
const COMPLETIONS_SUFFIX = '/completions'

function isOfficialOpenAIURL(url: string): boolean {
  try {
    return new URL(url).hostname === 'api.openai.com'
  } catch {
    return false
  }
}

function shouldUseOpenAIFlexProcessing(aiModel: string, url: string, provider: LLMProvider): boolean {
  const isCustomEndpoint = aiModel === 'reverse_proxy' || aiModel === 'custom-api' || aiModel.startsWith('xcustom:::')
  return (provider === LLMProvider.OpenAI || isCustomEndpoint) && isOfficialOpenAIURL(url)
}

function appendOperationPath(baseUrl: string, suffix: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (!trimmed || trimmed.endsWith(suffix)) {
    return trimmed
  }

  try {
    const url = new URL(trimmed)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const suffixSegments = suffix.split('/').filter(Boolean)
    const hasSuffix =
      pathSegments.length >= suffixSegments.length &&
      suffixSegments.every(
        (segment, index) => pathSegments[pathSegments.length - suffixSegments.length + index] === segment,
      )

    if (hasSuffix) {
      return url.toString()
    }

    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${suffixSegments.join('/')}`
    return url.toString()
  } catch {
    return `${trimmed}${suffix}`
  }
}

function appendChatCompletionsPath(baseUrl: string): string {
  return appendOperationPath(baseUrl, CHAT_COMPLETIONS_SUFFIX)
}

function appendResponsesPath(baseUrl: string): string {
  return appendOperationPath(baseUrl, RESPONSES_SUFFIX)
}

function appendCompletionsPath(baseUrl: string): string {
  return appendOperationPath(baseUrl, COMPLETIONS_SUFFIX)
}

function resolveProfileChatCompletionsUrl(arg: RequestDataArgumentExtended, aiModel: string): string | undefined {
  const providerOptions = arg.resolvedProfile?.providerOptions
  if (!providerOptions) {
    return undefined
  }
  if (providerOptions.baseUrl) {
    return appendChatCompletionsPath(providerOptions.baseUrl)
  }
  if (providerOptions.endpoint) {
    return providerOptions.endpoint
  }
  if (aiModel.startsWith('xcustom:::') && providerOptions.customModel?.url) {
    return providerOptions.customModel.url
  }
  return undefined
}

function resolveOpenAIWireModel(
  requestModel: string | undefined,
  internalID: string | undefined,
  allowInternalFallback: boolean,
): string {
  const selectedModel = requestModel || (allowInternalFallback ? internalID : undefined) || 'gpt-3.5-turbo'
  return normalizeLegacyOpenAIModelId(selectedModel)
}

function getLocalNetworkRequestOptions(
  url: string,
  db = getDatabase(),
  useStreaming = false,
): LocalNetworkRequestOptions {
  if (!db.localNetworkMode || !isLocalNetworkUrl(url)) {
    return {}
  }

  const timeoutSec =
    Number.isFinite(db.localNetworkTimeoutSec) && db.localNetworkTimeoutSec > 0 ? db.localNetworkTimeoutSec : 600

  return {
    networkRoute: 'local_network',
    requestTimeoutMs: useStreaming ? Math.max(1, Math.floor(timeoutSec * 1000)) : undefined,
  }
}

function serverOwnedOllamaHeaders(
  arg: RequestDataArgumentExtended,
  headers: Record<string, string>,
): Record<string, string> {
  return arg.serverOwnedOllamaAuth ? { ...headers, 'risu-auth': arg.serverOwnedOllamaAuth } : headers
}

export async function requestOpenAI(arg: RequestDataArgumentExtended): Promise<requestDataResponse> {
  let formatedChat: OpenAIChatExtra[] = []
  const formated = arg.formated
  const db = getDatabase()
  const aiModel = arg.aiModel ?? ''
  const resolvedProfile = arg.resolvedProfile
  const providerOptions = resolvedProfile?.providerOptions
  const runtimeOptions = resolvedProfile?.runtimeOptions
  const hasResolvedProfile = resolvedProfile !== undefined
  const reverseProxyOobaSystemHoist =
    aiModel === 'reverse_proxy' &&
    (hasResolvedProfile ? providerOptions?.reverseProxy?.oobaSystemHoist === true : db.reverseProxyOobaMode)

  const processToolCalls = async (text: string, originalMessage: any) => {
    // Split text by tool_call tags and process each segment
    const segments = text.split(/(<tool_call>.*?<\/tool_call>)/gms)
    const processedMessages = []

    let currentContent = ''

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]

      if (segment.match(/<tool_call>(.*?)<\/tool_call>/gms)) {
        // This is a tool call segment
        const toolCallMatch = segment.match(/<tool_call>(.*?)<\/tool_call>/s)
        if (toolCallMatch) {
          const call = await decodeToolCall(toolCallMatch[1])
          if (call) {
            // Create assistant message with accumulated content and this tool call
            processedMessages.push({
              ...originalMessage,
              role: 'assistant',
              content: currentContent,
              tool_calls: [
                {
                  id: call.call.id,
                  type: 'function',
                  function: {
                    name: call.call.name,
                    arguments: call.call.arg,
                  },
                },
              ],
            })

            // Add tool response
            const textContents: string[] = []
            for (const m of call.response) {
              if (m.type === 'text') {
                textContents.push(m.text)
              }
            }

            processedMessages.push({
              role: 'tool',
              content: textContents.join('\n'),
              tool_call_id: call.call.id,
              cachePoint: true,
            })

            // Reset content for next segment
            currentContent = ''
          }
        }
      } else {
        // This is regular text content - accumulate it
        currentContent += segment
      }
    }

    // If there's remaining content without tool calls, add it as a regular message
    if (currentContent.trim()) {
      processedMessages.push({
        ...originalMessage,
        role: 'assistant',
        content: currentContent,
      })
    }

    return processedMessages
  }
  for (let i = 0; i < formated.length; i++) {
    const m = formated[i]

    // Check if message contains tool calls
    if (m.content && m.content.includes('<tool_call>')) {
      const processedMessages = await processToolCalls(m.content, m)
      formatedChat.push(...processedMessages)
    } else if (m.multimodals && m.multimodals.length > 0 && m.role === 'user') {
      let v: OpenAIChatExtra = safeStructuredClone(m)
      let contents: Contents[] = []
      for (let j = 0; j < m.multimodals.length; j++) {
        contents.push({
          type: 'image_url',
          image_url: {
            url: m.multimodals[j].base64,
            detail: db.gptVisionQuality,
          },
        })
      }
      contents.push({
        type: 'text',
        text: m.content,
      })
      v.content = contents
      formatedChat.push(v)
    } else {
      formatedChat.push(m)
    }
  }

  let oobaSystemPrompts: string[] = []
  for (let i = 0; i < formatedChat.length; i++) {
    if (formatedChat[i].role !== 'function') {
      if (!(formatedChat[i].name && formatedChat[i].name.startsWith('example_') && db.newOAIHandle)) {
        formatedChat[i].name = undefined
      }
      if (db.newOAIHandle && formatedChat[i].memo && formatedChat[i].memo.startsWith('NewChat')) {
        formatedChat[i].content = ''
      }
      if (
        arg.modelInfo.flags.includes(LLMFlags.deepSeekPrefix) &&
        i === formatedChat.length - 1 &&
        formatedChat[i].role === 'assistant'
      ) {
        formatedChat[i].prefix = true
      }
      if (
        arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingInput) &&
        i === formatedChat.length - 1 &&
        formatedChat[i].thoughts &&
        formatedChat[i].thoughts.length > 0 &&
        formatedChat[i].role === 'assistant'
      ) {
        formatedChat[i].reasoning_content = formatedChat[i].thoughts.join('\n')
      }
      delete formatedChat[i].memo
      delete formatedChat[i].removable
      delete formatedChat[i].attr
      delete formatedChat[i].multimodals
      delete formatedChat[i].thoughts
      delete formatedChat[i].cachePoint
    }
    if (reverseProxyOobaSystemHoist && formatedChat[i].role === 'system') {
      const cont = formatedChat[i].content
      if (typeof cont === 'string') {
        oobaSystemPrompts.push(cont)
        formatedChat[i].content = ''
      }
    }
  }

  if (oobaSystemPrompts.length > 0) {
    formatedChat.push({
      role: 'system',
      content: oobaSystemPrompts.join('\n'),
    })
  }

  if (db.newOAIHandle) {
    formatedChat = formatedChat.filter((m) => {
      return m.content !== '' || (m.multimodals && m.multimodals.length > 0) || m.tool_calls || m.role === 'tool'
    })
  }

  for (let i = 0; i < arg.biasString.length; i++) {
    const bia = arg.biasString[i]
    if (bia[0].startsWith('[[') && bia[0].endsWith(']]')) {
      const num = parseInt(bia[0].replace('[[', '').replace(']]', ''))
      arg.bias[num] = bia[1]
      continue
    }

    if (bia[1] === -101) {
      arg.bias = await strongBan(bia[0], arg.bias)
      continue
    }
    const tokens = await tokenizeNum(bia[0])

    for (const token of tokens) {
      arg.bias[token] = bia[1]
    }
  }

  let requestModel = hasResolvedProfile
    ? providerOptions?.requestModel
    : aiModel === 'reverse_proxy' || aiModel === 'openrouter'
      ? db.proxyRequestModel
      : aiModel
  if (!hasResolvedProfile && aiModel === 'reverse_proxy') {
    requestModel = db.customProxyRequestModel
  }
  if (!hasResolvedProfile && aiModel === 'nanogpt') {
    requestModel = db.nanogptRequestModel
  }
  let openrouterRequestModel = hasResolvedProfile ? (requestModel ?? '') : db.openrouterRequestModel

  if (aiModel === 'openrouter' && openrouterRequestModel === 'risu/free') {
    const freeOpenRouterModel = await (hasResolvedProfile
      ? getFreeOpenRouterModels({
          apiKey: providerOptions?.apiKey,
          profileId: arg.resolvedProfile?.source.kind === 'durable-profile' ? arg.resolvedProfile.profileId : undefined,
        })
      : getFreeOpenRouterModels())
    if (!freeOpenRouterModel) {
      return {
        type: 'fail',
        result: language.errors.unknownModel,
      }
    }
    openrouterRequestModel = freeOpenRouterModel
  }

  if (arg.modelInfo.flags.includes(LLMFlags.DeveloperRole)) {
    formatedChat = formatedChat.map((v) => {
      if (v.role === 'system') {
        v.role = 'developer'
      }
      return v
    })
  }

  console.log(formatedChat)
  if (arg.modelInfo.format === LLMFormat.Mistral) {
    const mistralRequestModel = hasResolvedProfile ? (providerOptions?.requestModel ?? aiModel) : aiModel

    let reformatedChat: OpenAIChatExtra[] = []

    for (let i = 0; i < formatedChat.length; i++) {
      const chat = formatedChat[i]
      if (i === 0) {
        if (chat.role === 'user' || chat.role === 'system') {
          reformatedChat.push({
            role: chat.role,
            content: chat.content,
          })
        } else {
          reformatedChat.push({
            role: 'system',
            content: chat.role + ':' + chat.content,
          })
        }
      } else {
        const prevChat = reformatedChat[reformatedChat.length - 1]
        if (prevChat?.role === chat.role) {
          reformatedChat[reformatedChat.length - 1].content += '\n' + chat.content
          continue
        } else if (chat.role === 'system') {
          if (prevChat?.role === 'user') {
            reformatedChat[reformatedChat.length - 1].content += '\nSystem:' + chat.content
          } else {
            reformatedChat.push({
              role: 'user',
              content: 'System:' + chat.content,
            })
          }
        } else if (chat.role === 'function') {
          reformatedChat.push({
            role: 'user',
            content: chat.content,
          })
        } else {
          reformatedChat.push({
            role: chat.role,
            content: chat.content,
          })
        }
      }
    }

    const requestURL = hasResolvedProfile
      ? (resolveProfileChatCompletionsUrl(arg, aiModel) ?? 'https://api.mistral.ai/v1/chat/completions')
      : (arg.customURL ?? 'https://api.mistral.ai/v1/chat/completions')
    const networkOptions = getLocalNetworkRequestOptions(requestURL, db, false)

    let body = applyParameters(
      {
        model: mistralRequestModel,
        messages: reformatedChat,
        safe_prompt: false,
        max_tokens: arg.maxTokens,
      },
      ['temperature', 'presence_penalty', 'frequency_penalty', 'top_p'],
      {},
      arg.mode,
      {
        modelId: arg.modelInfo.id,
      },
    )
    const headers: Record<string, string> = {
      Authorization: 'Bearer ' + (hasResolvedProfile ? (providerOptions?.apiKey ?? '') : (arg.key ?? db.mistralKey)),
    }
    if (hasResolvedProfile) Object.assign(headers, providerOptions?.extraHeaders ?? {})
    body = applyAdditionalParameters(
      body,
      headers,
      hasResolvedProfile
        ? getRequestAdditionalParameters(
            aiModel,
            providerOptions?.additionalParams ?? [],
            providerOptions?.extraHeaders,
          )
        : getAdditionalParameters(aiModel),
    )

    const targs = {
      body,
      headers,
      abortSignal: arg.abortSignal,
      chatId: arg.chatId,
      interceptor: 'mistral',
      networkRoute: networkOptions.networkRoute,
      requestTimeoutMs: networkOptions.requestTimeoutMs,
    } as const

    if (arg.previewBody) {
      return {
        type: 'success',
        result: JSON.stringify({
          url: requestURL,
          body: targs.body,
          headers: targs.headers,
        }),
      }
    }

    const res = await globalFetch(requestURL, targs)

    const dat = res.data as any
    if (res.ok) {
      try {
        const msg: OpenAIChatFull = dat.choices[0].message
        return {
          type: 'success',
          result: msg.content ?? '',
        }
      } catch (error) {
        return {
          type: 'fail',
          result: language.errors.httpError + `${JSON.stringify(dat)}`,
        }
      }
    } else {
      if (dat.error && dat.error.message) {
        return {
          type: 'fail',
          result: language.errors.httpError + `${dat.error.message}`,
        }
      } else {
        return {
          type: 'fail',
          result: language.errors.httpError + `${JSON.stringify(res.data)}`,
        }
      }
    }
  }

  db.cipherChat = false
  const bodyModel = resolveOpenAIWireModel(
    aiModel === 'openrouter' ? openrouterRequestModel : requestModel,
    arg.modelInfo.internalID,
    !hasResolvedProfile,
  )
  let body: {
    [key: string]: any
  } = {
    model: bodyModel,
    messages: formatedChat,
    max_tokens: arg.maxTokens,
    logit_bias: arg.bias,
    stream: false,
  }

  if (Object.keys(body.logit_bias).length === 0) {
    delete body.logit_bias
  }

  if (arg.modelInfo.flags.includes(LLMFlags.OAICompletionTokens)) {
    body.max_completion_tokens = body.max_tokens
    delete body.max_tokens
  }

  if (db.generationSeed > 0) {
    body.seed = db.generationSeed
  }

  if ((db.jsonSchemaEnabled || arg.schema) && !arg.modelInfo.flags.includes(LLMFlags.noStructuredOutput)) {
    body.response_format = {
      type: 'json_schema',
      json_schema: getOpenAIJSONSchema(arg.schema),
    }
  }

  if (db.OAIPrediction) {
    body.prediction = {
      type: 'content',
      content: db.OAIPrediction,
    }
  }

  if (aiModel === 'openrouter') {
    const openrouterOptions = hasResolvedProfile ? providerOptions?.openrouter : undefined
    const openrouterFallback = hasResolvedProfile ? openrouterOptions?.fallback === true : db.openrouterFallback
    const openrouterMiddleOut = hasResolvedProfile ? openrouterOptions?.middleOut === true : db.openrouterMiddleOut
    const openrouterProvider = hasResolvedProfile ? openrouterOptions?.provider : db.openrouterProvider
    if (openrouterFallback) {
      body.route = 'fallback'
    }
    body.transforms = openrouterMiddleOut ? ['middle-out'] : []

    if (openrouterProvider) {
      const provider: typeof db.openrouterProvider = {} as typeof db.openrouterProvider
      if (openrouterProvider.order?.length) {
        provider.order = openrouterProvider.order
      }
      if (openrouterProvider.only?.length) {
        provider.only = openrouterProvider.only
      }
      if (openrouterProvider.ignore?.length) {
        provider.ignore = openrouterProvider.ignore
      }
      if (Object.keys(provider).length) {
        body.provider = provider
      }
    }

    if (db.useInstructPrompt) {
      delete body.messages
      const prompt = applyChatTemplate(formated)
      body.prompt = prompt
    }
  }

  body = applyParameters(body, arg.modelInfo.parameters, {}, arg.mode, {
    modelId: arg.modelInfo.id,
  })

  if (arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingToggle)) {
    if (db.deepseekThinkingType === 'enabled') {
      body.thinking = {
        type: 'enabled',
        reasoning_effort: db.deepseekReasoningEffort ?? 'high',
      }
      delete body.temperature
      delete body.top_p
      delete body.frequency_penalty
      delete body.presence_penalty
    } else {
      body.thinking = { type: 'disabled' }
    }
  }

  if (arg.tools && arg.tools.length > 0) {
    body.tools = arg.tools.map((tool) => {
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: simplifySchema(tool.inputSchema),
        },
      }
    })
  }

  if (reverseProxyOobaSystemHoist) {
    const OobaBodyTemplate = hasResolvedProfile ? providerOptions?.reverseProxy?.oobaArgs : db.reverseProxyOobaArgs

    if (OobaBodyTemplate && typeof OobaBodyTemplate === 'object' && !Array.isArray(OobaBodyTemplate)) {
      const keys = Object.keys(OobaBodyTemplate)
      for (const key of keys) {
        if (OobaBodyTemplate[key] !== undefined && OobaBodyTemplate[key] !== null) {
          body[key] = OobaBodyTemplate[key]
        }
      }
    }
  }

  if (supportsInlayImage()) {
    // inlay models doesn't support logit_bias
    // OpenAI's gpt based llm model supports both logit_bias and inlay image
    if (
      !(
        aiModel.startsWith('gpt') ||
        (aiModel == 'reverse_proxy' &&
          (hasResolvedProfile
            ? (requestModel?.startsWith('gpt') ?? false)
            : db.proxyRequestModel?.startsWith('gpt') ||
              (db.proxyRequestModel === 'custom' && db.customProxyRequestModel.startsWith('gpt'))))
      )
    ) {
      delete body.logit_bias
    }
  }

  let replacerURL =
    aiModel === 'nanogpt'
      ? db.nanogptUseSubscriptionEndpoint
        ? 'https://nano-gpt.com/api/subscription/v1/chat/completions'
        : 'https://nano-gpt.com/api/v1/chat/completions'
      : aiModel === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : (arg.customURL ?? 'https://api.openai.com/v1/chat/completions')

  const profileChatCompletionsUrl = resolveProfileChatCompletionsUrl(arg, aiModel)
  if (profileChatCompletionsUrl !== undefined) {
    replacerURL = profileChatCompletionsUrl
  } else if (arg.modelInfo?.endpoint) {
    replacerURL = arg.modelInfo.endpoint
  }

  let risuIdentify = false
  if (replacerURL.startsWith('risu::')) {
    risuIdentify = true
    replacerURL = replacerURL.replace('risu::', '')
  }

  if (aiModel === 'reverse_proxy' && !hasResolvedProfile && db.autofillRequestUrl) {
    if (replacerURL.endsWith('v1')) {
      replacerURL += '/chat/completions'
    } else if (replacerURL.endsWith('v1/')) {
      replacerURL += 'chat/completions'
    } else if (!(replacerURL.endsWith('completions') || replacerURL.endsWith('completions/'))) {
      if (replacerURL.endsWith('/')) {
        replacerURL += 'v1/chat/completions'
      } else {
        replacerURL += '/v1/chat/completions'
      }
    }
  }

  const resolvedProvider = resolvedProfile?.modelInfo.provider ?? arg.modelInfo.provider
  if (db.openAIFlexProcessing && shouldUseOpenAIFlexProcessing(aiModel, replacerURL, resolvedProvider)) {
    body.service_tier = 'flex'
  }

  let headers: Record<string, string> = {
    Authorization:
      'Bearer ' +
      (hasResolvedProfile
        ? (providerOptions?.apiKey ?? '')
        : (arg.key ??
          (aiModel === 'nanogpt'
            ? db.nanogptKey
            : aiModel === 'reverse_proxy'
              ? db.proxyKey
              : aiModel === 'openrouter'
                ? db.openrouterKey
                : db.openAIKey))),
    'Content-Type': 'application/json',
  }

  if (!hasResolvedProfile && arg.modelInfo?.keyIdentifier) {
    headers['Authorization'] = 'Bearer ' + db.OaiCompAPIKeys[arg.modelInfo.keyIdentifier]
  }
  if (hasResolvedProfile) {
    Object.assign(headers, providerOptions?.extraHeaders ?? {})
  } else {
    if (aiModel === 'openrouter') {
      headers['X-Title'] = 'RisuAI'
      headers['HTTP-Referer'] = 'https://risuai.xyz'
    }
    if (aiModel === 'nanogpt' && db.nanogptProvider) {
      headers['X-Provider'] = db.nanogptProvider
    }
    if (risuIdentify) {
      headers['X-Proxy-Risu'] = 'RisuAI'
    }
  }
  if (arg.multiGen) {
    // Check if tools are enabled - multiGen with tools is not supported
    if (arg.tools && arg.tools.length > 0) {
      return {
        type: 'fail',
        result: 'MultiGen mode cannot be used with tool calls. Please disable one of them.',
      }
    }
    body.n = hasResolvedProfile ? (runtimeOptions?.genTime ?? db.genTime) : db.genTime
  }
  body = applyAdditionalParameters(
    body,
    headers,
    hasResolvedProfile
      ? getRequestAdditionalParameters(aiModel, providerOptions?.additionalParams ?? [], providerOptions?.extraHeaders)
      : getAdditionalParameters(aiModel),
  )

  // Some aux flows are intentionally non-streaming (e.g. memory/translate).
  // If custom Additional Parameters contains stream=true, force non-stream mode back.
  if (!arg.useStreaming) {
    body.stream = false
  }

  const localNetworkOptions = arg.serverOwnedOllamaAuth ? {} : getLocalNetworkRequestOptions(replacerURL, db, false)
  const streamingLocalNetworkOptions = arg.serverOwnedOllamaAuth
    ? {}
    : getLocalNetworkRequestOptions(replacerURL, db, true)

  if (arg.useStreaming) {
    body.stream = true
    if (arg.previewBody) {
      return {
        type: 'success',
        result: JSON.stringify({
          url: replacerURL,
          body: body,
          headers: headers,
        }),
      }
    }
    const da = await fetchNative(replacerURL, {
      body: JSON.stringify(body),
      method: 'POST',
      headers: serverOwnedOllamaHeaders(arg, headers),
      signal: arg.abortSignal,
      chatId: arg.chatId,
      interceptor: 'openai_streaming',
      networkRoute: streamingLocalNetworkOptions.networkRoute,
      requestTimeoutMs: streamingLocalNetworkOptions.requestTimeoutMs,
      sensitive: !!arg.serverOwnedOllamaAuth,
    })

    if (da.status !== 200) {
      return {
        type: 'fail',
        result: await textifyReadableStream(da.body),
      }
    }

    if (!da.headers.get('Content-Type').includes('text/event-stream')) {
      return {
        type: 'fail',
        result: await textifyReadableStream(da.body),
      }
    }

    addFetchLog({
      body: body,
      response: 'Streaming',
      success: true,
      url: replacerURL,
      status: da.status,
    })

    const transtream = getTranStream(arg)

    da.body.pipeTo(transtream.writable)

    return {
      type: 'streaming',
      result: wrapToolStream(transtream.readable, body, headers, replacerURL, arg, streamingLocalNetworkOptions),
    }
  }

  if (arg.previewBody) {
    return {
      type: 'success',
      result: JSON.stringify({
        url: replacerURL,
        body: body,
        headers: headers,
      }),
    }
  }

  return requestHTTPOpenAI(replacerURL, body, headers, arg, localNetworkOptions)
}

export async function requestHTTPOpenAI(
  replacerURL: string,
  body: any,
  headers: Record<string, string>,
  arg: RequestDataArgumentExtended,
  networkOptions: LocalNetworkRequestOptions = {},
): Promise<requestDataResponse> {
  const db = getDatabase()
  const res = await globalFetch(replacerURL, {
    body: body,
    headers: serverOwnedOllamaHeaders(arg, headers),
    abortSignal: arg.abortSignal,
    chatId: arg.chatId,
    interceptor: 'openai_basic',
    networkRoute: networkOptions.networkRoute,
    requestTimeoutMs: networkOptions.requestTimeoutMs,
    plainFetchForce: !!arg.serverOwnedOllamaAuth,
    sensitive: !!arg.serverOwnedOllamaAuth,
  })

  function processTextResponse(dat: any): string {
    if (dat?.choices[0]?.text) {
      let text = dat.choices[0].text as string
      if (arg.extractJson && (db.jsonSchemaEnabled || arg.schema)) {
        try {
          const parsed = JSON.parse(text)
          const extracted = extractJSON(parsed, arg.extractJson)
          return extracted
        } catch (error) {
          console.log(error)
          return text
        }
      }
      return text
    }
    if (arg.extractJson && (db.jsonSchemaEnabled || arg.schema)) {
      return extractJSON(dat.choices[0].message.content, arg.extractJson)
    }
    const msg: OpenAIChatFull = dat.choices[0].message
    let result = msg.content ?? ''
    const reasoningContentField = dat?.choices[0]?.reasoning_content ?? dat?.choices[0]?.message?.reasoning_content
    if (arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingOutput) && !reasoningContentField) {
      let reasoningContent = ''
      result = result.replace(/(.*)\<\/think\>/gms, (m, p1) => {
        reasoningContent = p1
        return ''
      })
      if (reasoningContent) {
        reasoningContent = reasoningContent.replace(/\<think\>/gms, '')
        result = `<Thoughts>\n${reasoningContent}\n</Thoughts>\n${result}`
      }
    }
    if (reasoningContentField && !result.startsWith('<Thoughts>')) {
      result = `<Thoughts>\n${reasoningContentField}\n</Thoughts>\n${result}`
    }
    // For openrouter, https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request#response.body.choices.message.reasoning
    if (dat?.choices?.[0]?.message?.reasoning) {
      result = `<Thoughts>\n${dat.choices[0].message.reasoning}\n</Thoughts>\n${result}`
    }

    return result
  }

  const dat = res.data as any

  if (res.ok) {
    try {
      // Collect all tool_calls from all choices
      let allToolCalls: ToolCall[] = []
      if (dat.choices) {
        for (const choice of dat.choices) {
          if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
            allToolCalls = allToolCalls.concat(choice.message.tool_calls)
          }
        }
      }

      // Replace choices[0].message.tool_calls with all collected tool calls
      if (dat.choices?.[0]?.message && allToolCalls.length > 0) {
        dat.choices[0].message.tool_calls = allToolCalls
      }

      if (dat.choices?.[0]?.message?.tool_calls && dat.choices[0].message.tool_calls.length > 0) {
        const toolCalls = dat.choices[0].message.tool_calls as ToolCall[]

        const messages = body.messages as OpenAIChatExtra[]

        messages.push(dat.choices[0].message)

        // Remove the last message content if simplifiedToolUse is enabled
        if (db.simplifiedToolUse && messages[messages.length - 1].content) {
          messages[messages.length - 1].content = ''
        }

        const callCodes: string[] = []

        for (const toolCall of toolCalls) {
          if (
            !toolCall.function ||
            !toolCall.function.name ||
            toolCall.function.arguments === undefined ||
            toolCall.function.arguments === null
          ) {
            continue
          }
          try {
            const functionArgs = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {}
            if (arg.tools && arg.tools.length > 0) {
              const tool = arg.tools.find((t) => t.name === toolCall.function.name)
              if (!tool) {
                messages.push({
                  role: 'tool',
                  content: 'No tool found with name: ' + toolCall.function.name,
                  tool_call_id: toolCall.id,
                })
              } else {
                const parsed = functionArgs
                const x = (await callTool(tool.name, parsed)).filter((m) => m.type === 'text')
                if (x.length > 0) {
                  messages.push({
                    role: 'tool',
                    content: x[0].text,
                    tool_call_id: toolCall.id,
                  })
                  if (arg.rememberToolUsage) {
                    callCodes.push(
                      await encodeToolCall({
                        call: {
                          id: toolCall.id,
                          name: toolCall.function.name,
                          arg: toolCall.function.arguments,
                        },
                        response: x,
                      }),
                    )
                  }
                } else {
                  messages.push({
                    role: 'tool',
                    content: 'Tool call failed with no text response',
                    tool_call_id: toolCall.id,
                  })
                }
              }
            }
          } catch (error) {
            messages.push({
              role: 'tool',
              content: 'Tool call failed with error: ' + error,
              tool_call_id: toolCall.id,
            })
          }
        }

        body.messages = messages

        // Send the next request recursively
        let resRec
        let attempt = 0

        do {
          attempt++
          resRec = await requestHTTPOpenAI(replacerURL, body, headers, arg, networkOptions)

          if (resRec.type != 'fail') {
            break
          }
        } while (attempt <= db.requestRetrys) // Retry up to db.requestRetrys times

        const callCode = callCodes.join('\n\n')

        // Combine the tool call results with the main response (does not include text response if simplifiedToolUse is enabled)
        const result = (db.simplifiedToolUse ? '' : (processTextResponse(dat) ?? '') + '\n\n') + callCode

        if (resRec.type === 'fail') {
          alertError(language.errors.toolFollowupRequestFailed)
          return {
            type: 'success',
            result: result,
          }
        } else if (resRec.type === 'success') {
          return {
            type: 'success',
            result: result + '\n\n' + resRec.result,
          }
        }

        return resRec
      }

      if (arg.multiGen && dat.choices) {
        if (arg.extractJson && (db.jsonSchemaEnabled || arg.schema)) {
          const c = dat.choices.map((v: { message: { content: string } }) => {
            const extracted = extractJSON(v.message.content ?? '', arg.extractJson)
            return ['char', extracted]
          })

          return {
            type: 'multiline',
            result: c,
          }
        }
        return {
          type: 'multiline',
          result: dat.choices.map((v) => {
            return ['char', v.message.content ?? '']
          }),
        }
      }

      const result = processTextResponse(dat) ?? ''

      return {
        type: 'success',
        result: result,
      }
    } catch (error) {
      return {
        type: 'fail',
        result: language.errors.httpError + `${JSON.stringify(dat)}`,
      }
    }
  }

  if (dat.error && dat.error.message) {
    return {
      type: 'fail',
      result: language.errors.httpError + `${dat.error.message}`,
    }
  }

  return {
    type: 'fail',
    result: language.errors.httpError + `${JSON.stringify(res.data)}`,
  }
}

export async function requestOpenAILegacyInstruct(arg: RequestDataArgumentExtended): Promise<requestDataResponse> {
  const formated = arg.formated
  const db = getDatabase()
  const aiModel = arg.aiModel ?? ''
  const resolvedProfile = arg.resolvedProfile
  const providerOptions = resolvedProfile?.providerOptions
  const hasResolvedProfile = resolvedProfile !== undefined
  const maxTokens = arg.maxTokens
  const temperature = arg.temperature
  const prompt =
    formated
      .filter((m) => m.content?.trim())
      .map((m) => {
        let author = ''

        if (m.role == 'system') {
          m.content = m.content.trim()
        }

        console.log(m.role + ':' + m.content)
        switch (m.role) {
          case 'user':
            author = 'User'
            break
          case 'assistant':
            author = 'Assistant'
            break
          case 'system':
            author = 'Instruction'
            break
          default:
            author = m.role
            break
        }

        return `\n## ${author}\n${m.content.trim()}`
      })
      .join('') + `\n## Response\n`

  let requestURL = arg.customURL ?? 'https://api.openai.com/v1/completions'
  if (hasResolvedProfile) {
    if (providerOptions?.endpoint) {
      requestURL = providerOptions.endpoint
    } else if (providerOptions?.baseUrl) {
      requestURL = appendCompletionsPath(providerOptions.baseUrl)
    }
  }

  let risuIdentify = false
  if (hasResolvedProfile && requestURL.startsWith('risu::')) {
    risuIdentify = true
    requestURL = requestURL.replace('risu::', '')
  }

  let body = {
    model: hasResolvedProfile ? (providerOptions?.requestModel ?? 'gpt-3.5-turbo-instruct') : 'gpt-3.5-turbo-instruct',
    prompt: prompt,
    max_tokens: maxTokens,
    temperature: temperature,
    top_p: 1,
    stop: ['User:', ' User:', 'user:', ' user:'],
    presence_penalty: arg.PresensePenalty || db.PresensePenalty / 100,
    frequency_penalty: arg.frequencyPenalty || db.frequencyPenalty / 100,
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (hasResolvedProfile ? (providerOptions?.apiKey ?? '') : (arg.key ?? db.openAIKey)),
  }

  if (risuIdentify) {
    headers['X-Proxy-Risu'] = 'RisuAI'
  }
  if (hasResolvedProfile) {
    Object.assign(headers, providerOptions?.extraHeaders ?? {})
  }

  body = applyAdditionalParameters(
    body,
    headers,
    hasResolvedProfile
      ? getRequestAdditionalParameters(aiModel, providerOptions?.additionalParams ?? [], providerOptions?.extraHeaders)
      : getAdditionalParameters(aiModel),
  )

  if (arg.previewBody) {
    return {
      type: 'success',
      result: JSON.stringify({
        url: requestURL,
        body: body,
        headers: headers,
      }),
    }
  }

  const response = await globalFetch(requestURL, {
    body,
    headers,
    chatId: arg.chatId,
    abortSignal: arg.abortSignal,
  })

  if (!response.ok) {
    return {
      type: 'fail',
      result: language.errors.httpError + `${JSON.stringify(response.data)}`,
    }
  }
  const text: string = response.data.choices[0].text
  return {
    type: 'success',
    result: text.replace(/##\n/g, ''),
  }
}

function responseTextContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) =>
      item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'
        ? (item as { text: string }).text
        : '',
    )
    .join('\n')
}

async function decodeRememberedToolCallsForResponses(text: string): Promise<ResponseItem[]> {
  const items: ResponseItem[] = []
  const segments = text.split(/(<tool_call>.*?<\/tool_call>)/gms)
  let currentContent = ''

  for (const segment of segments) {
    const toolCallMatch = segment.match(/<tool_call>(.*?)<\/tool_call>/s)
    if (!toolCallMatch) {
      currentContent += segment
      continue
    }
    if (currentContent.trim()) {
      items.push({
        content: [{ type: 'output_text', text: currentContent, annotations: [] }],
        role: 'assistant',
        status: 'completed',
        type: 'message',
      })
      currentContent = ''
    }

    const decoded = await decodeToolCall(toolCallMatch[1])
    if (!decoded) continue
    items.push(
      {
        type: 'function_call',
        call_id: decoded.call.id,
        name: decoded.call.name,
        arguments: decoded.call.arg,
        status: 'completed',
      },
      {
        type: 'function_call_output',
        call_id: decoded.call.id,
        output: decoded.response
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n'),
      },
    )
  }

  if (currentContent.trim()) {
    items.push({
      content: [{ type: 'output_text', text: currentContent, annotations: [] }],
      role: 'assistant',
      status: 'completed',
      type: 'message',
    })
  }
  return items
}

async function buildClientResponseInputItems(arg: RequestDataArgumentExtended): Promise<ResponseItem[]> {
  const db = getDatabase()
  const developerRole = arg.modelInfo.flags.includes(LLMFlags.DeveloperRole)
  const detail = db.gptVisionQuality === 'low' || db.gptVisionQuality === 'high' ? db.gptVisionQuality : 'auto'
  const items: ResponseItem[] = []

  for (const message of arg.formated as OpenAIChatExtra[]) {
    if (message.role === 'function') continue
    if (message.role === 'tool') {
      if (message.tool_call_id) {
        items.push({
          type: 'function_call_output',
          call_id: message.tool_call_id,
          output: responseTextContentToString(message.content),
        })
      }
      continue
    }
    if (message.role === 'assistant') {
      if (typeof message.content === 'string' && message.content.includes('<tool_call>')) {
        items.push(...(await decodeRememberedToolCallsForResponses(message.content)))
        continue
      }
      const text = responseTextContentToString(message.content)
      items.push({
        content: text ? [{ type: 'output_text', text, annotations: [] }] : [],
        role: 'assistant',
        status: 'completed',
        type: 'message',
      })
      for (const toolCall of message.tool_calls ?? []) {
        if (!toolCall.id || !toolCall.function?.name) continue
        items.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
          status: 'completed',
        })
      }
      continue
    }
    if (message.role !== 'user' && message.role !== 'system' && message.role !== 'developer') continue

    const role = message.role === 'system' && developerRole ? 'developer' : message.role
    const content: ResponseInputItem['content'] = []
    const text = responseTextContentToString(message.content)
    if (text || db.newOAIHandle === false) content.push({ type: 'input_text', text })
    for (const multimodal of message.multimodals ?? []) {
      if (multimodal.type === 'image') {
        content.push({ type: 'input_image', detail, image_url: multimodal.base64 })
      } else {
        content.push({ type: 'input_file', file_data: multimodal.base64 })
      }
    }
    if (content.length > 0) items.push({ role, content })
  }

  const last = items.at(-1)
  if (last && 'type' in last && last.type === 'message') last.status = 'incomplete'
  return items
}

function sanitizeResponsesContinuationItem(value: unknown): ResponseItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (item.type === 'function_call' && typeof item.call_id === 'string' && typeof item.name === 'string') {
    let argumentsText = ''
    if (typeof item.arguments === 'string') {
      argumentsText = item.arguments
    } else if (item.arguments && typeof item.arguments === 'object') {
      try {
        argumentsText = JSON.stringify(item.arguments)
      } catch {
        return null
      }
    }
    return {
      type: 'function_call',
      call_id: item.call_id,
      name: item.name,
      arguments: argumentsText,
      status: typeof item.status === 'string' ? item.status : 'completed',
    }
  }
  if (item.type !== 'message') return null

  const content: ResponseOutputContent[] = []
  for (const rawContent of Array.isArray(item.content) ? item.content : []) {
    if (!rawContent || typeof rawContent !== 'object' || Array.isArray(rawContent)) continue
    const contentItem = rawContent as Record<string, unknown>
    if (contentItem.type === 'output_text') {
      content.push({
        type: 'output_text',
        text: typeof contentItem.text === 'string' ? contentItem.text : '',
        annotations: Array.isArray(contentItem.annotations) ? contentItem.annotations : [],
      })
      continue
    }
    if (contentItem.type === 'refusal') {
      content.push({ type: 'refusal', refusal: typeof contentItem.refusal === 'string' ? contentItem.refusal : '' })
    }
  }
  return {
    type: 'message',
    role: 'assistant',
    status: item.status === 'in_progress' || item.status === 'incomplete' ? item.status : 'completed',
    content,
  }
}

function collectResponsesReasoningText(value: unknown): string[] {
  if (typeof value === 'string') return value.length > 0 ? [value] : []
  if (Array.isArray(value)) return value.flatMap(collectResponsesReasoningText)
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return ['text', 'summary_text', 'reasoning_text', 'reasoning', 'summary'].flatMap((key) =>
    collectResponsesReasoningText(record[key]),
  )
}

function responseOutputRecords(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return []
  const output = (data as { output?: unknown }).output
  return Array.isArray(output)
    ? output.filter(
        (item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item),
      )
    : []
}

function extractClientResponsesText(data: unknown, arg: RequestDataArgumentExtended): string {
  if (!data || typeof data !== 'object') return ''
  const body = data as Record<string, unknown>
  const hasTopLevelOutputText = typeof body.output_text === 'string'
  const texts = hasTopLevelOutputText ? [body.output_text as string] : []
  const refusals: string[] = []
  const thoughts: string[] = []

  for (const item of responseOutputRecords(data)) {
    if (item.type === 'reasoning') {
      thoughts.push(
        ...collectResponsesReasoningText(item.summary),
        ...collectResponsesReasoningText(item.content),
        ...collectResponsesReasoningText(item.text),
        ...collectResponsesReasoningText(item.summary_text),
        ...collectResponsesReasoningText(item.reasoning_text),
        ...collectResponsesReasoningText(item.reasoning),
      )
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const rawContent of item.content) {
      if (!rawContent || typeof rawContent !== 'object') continue
      const content = rawContent as Record<string, unknown>
      if (!hasTopLevelOutputText && content.type === 'output_text' && typeof content.text === 'string') {
        texts.push(content.text)
      }
      if (content.type === 'refusal' && typeof content.refusal === 'string') refusals.push(content.refusal)
    }
  }

  let result = texts.length > 0 ? texts.join('\n') : refusals.join('\n')
  if (thoughts.length > 0 && !result.startsWith('<Thoughts>')) {
    result = `<Thoughts>\n\n${thoughts.join('\n\n')}\n\n</Thoughts>\n${result}`
  }
  if (arg.extractJson && (getDatabase().jsonSchemaEnabled || arg.schema)) {
    return extractJSON(result, arg.extractJson)
  }
  return result
}

function extractClientResponsesFunctionCalls(data: unknown): ResponseFunctionCallItem[] {
  return responseOutputRecords(data)
    .map(sanitizeResponsesContinuationItem)
    .filter(
      (item): item is ResponseFunctionCallItem => item !== null && 'type' in item && item.type === 'function_call',
    )
}

export async function requestOpenAIResponseAPI(arg: RequestDataArgumentExtended): Promise<requestDataResponse> {
  const db = getDatabase()
  const aiModel = arg.aiModel
  const resolvedProfile = arg.resolvedProfile
  const providerOptions = resolvedProfile?.providerOptions
  const runtimeOptions = resolvedProfile?.runtimeOptions
  const hasResolvedProfile = resolvedProfile !== undefined
  const maxTokens = arg.maxTokens

  const items = await buildClientResponseInputItems(arg)
  const modelTools = hasResolvedProfile ? (runtimeOptions?.modelTools ?? []) : db.modelTools
  const tools = [
    ...(arg.tools ?? []).map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: simplifySchema(tool.inputSchema),
    })),
    ...(modelTools.includes('search') ? [{ type: 'web_search_preview' }] : []),
  ]

  let body = applyParameters(
    {
      model: hasResolvedProfile
        ? (providerOptions?.requestModel ?? arg.modelInfo.internalID ?? aiModel)
        : (arg.modelInfo.internalID ?? aiModel),
      input: items,
      max_output_tokens: maxTokens,
      tools,
      store: false,
    },
    ['temperature', 'top_p'],
    {},
    arg.mode,
    {
      modelId: arg.modelInfo.id,
    },
  )

  if (aiModel === 'ollama-cloud') {
    delete body.store
  }
  if (body.tools.length === 0) delete body.tools
  if ((db.jsonSchemaEnabled || arg.schema) && !arg.modelInfo.flags.includes(LLMFlags.noStructuredOutput)) {
    body.text ??= {}
    body.text.format = {
      type: 'json_schema',
      ...getOpenAIJSONSchema(arg.schema),
    }
  }

  let requestURL = arg.customURL ?? 'https://api.openai.com/v1/responses'
  if (hasResolvedProfile) {
    if (providerOptions?.endpoint) {
      requestURL = providerOptions.endpoint
    } else if (providerOptions?.baseUrl) {
      requestURL = appendResponsesPath(providerOptions.baseUrl)
    }
  } else if (arg.modelInfo?.endpoint) {
    requestURL = arg.modelInfo.endpoint
  }

  let risuIdentify = false
  if (requestURL.startsWith('risu::')) {
    risuIdentify = true
    requestURL = requestURL.replace('risu::', '')
  }

  if (aiModel === 'reverse_proxy' && !hasResolvedProfile && db.autofillRequestUrl) {
    try {
      const url = new URL(requestURL)
      const pathSegments = url.pathname.split('/').filter(Boolean)
      const lastSegment = pathSegments[pathSegments.length - 1] ?? ''

      if (url.searchParams.has('api-version') && url.pathname.includes('/responses')) {
        // Azure-style Responses API URL already includes the endpoint
      } else if (lastSegment === 'responses') {
        // keep as-is
      } else if (lastSegment === 'v1') {
        url.pathname = url.pathname.replace(/\/?$/, '/responses')
      } else {
        url.pathname = url.pathname.replace(/\/?$/, '/v1/responses')
      }

      requestURL = url.toString()
    } catch {
      const [baseURL, query] = requestURL.split('?', 2)
      let nextURL = baseURL
      const pathSegments = nextURL.split('/').filter(Boolean)
      const lastSegment = pathSegments[pathSegments.length - 1] ?? ''
      const hasApiVersion = query?.includes('api-version=')

      if (hasApiVersion && nextURL.includes('/responses')) {
        // Azure-style Responses API URL already includes the endpoint
      } else if (lastSegment === 'responses') {
        // keep as-is
      } else if (lastSegment === 'v1') {
        nextURL += nextURL.endsWith('/') ? 'responses' : '/responses'
      } else {
        nextURL += nextURL.endsWith('/') ? 'v1/responses' : '/v1/responses'
      }

      requestURL = query ? `${nextURL}?${query}` : nextURL
    }
  }

  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + (hasResolvedProfile ? (providerOptions?.apiKey ?? '') : (arg.key ?? db.openAIKey)),
    'Content-Type': 'application/json',
  }

  if (risuIdentify) {
    headers['X-Proxy-Risu'] = 'RisuAI'
  }
  if (hasResolvedProfile) {
    Object.assign(headers, providerOptions?.extraHeaders ?? {})
  }

  body = applyAdditionalParameters(
    body,
    headers,
    hasResolvedProfile
      ? getRequestAdditionalParameters(aiModel, providerOptions?.additionalParams ?? [], providerOptions?.extraHeaders)
      : getAdditionalParameters(aiModel),
  )

  if (arg.previewBody) {
    return {
      type: 'success',
      result: JSON.stringify({
        url: requestURL,
        body: body,
        headers: headers,
      }),
    }
  }

  const localNetworkOptions = arg.serverOwnedOllamaAuth ? {} : getLocalNetworkRequestOptions(requestURL, db, false)
  let prefix = ''

  for (let round = 0; round < 8; round++) {
    const response = await globalFetch(requestURL, {
      body: body,
      headers: serverOwnedOllamaHeaders(arg, headers),
      chatId: arg.chatId,
      abortSignal: arg.abortSignal,
      interceptor: 'openai_response_api',
      networkRoute: localNetworkOptions.networkRoute,
      requestTimeoutMs: localNetworkOptions.requestTimeoutMs,
      plainFetchForce: !!arg.serverOwnedOllamaAuth,
      sensitive: !!arg.serverOwnedOllamaAuth,
    })

    if (!response.ok) {
      return {
        type: 'fail',
        result: language.errors.httpError + `${JSON.stringify(response.data)}`,
      }
    }

    const data = response.data as unknown
    const dataRecord = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
    const result = extractClientResponsesText(data, arg)
    if (dataRecord.status === 'failed' || dataRecord.error) {
      return { type: 'fail', result: JSON.stringify(dataRecord.error ?? data) }
    }
    if (dataRecord.status === 'incomplete') {
      const incompleteDetails =
        dataRecord.incomplete_details && typeof dataRecord.incomplete_details === 'object'
          ? (dataRecord.incomplete_details as Record<string, unknown>)
          : {}
      const reason =
        typeof incompleteDetails.reason === 'string'
          ? `Incomplete response: ${incompleteDetails.reason}`
          : 'Incomplete response'
      return { type: 'fail', result: result ? `${reason}\n${result}` : reason }
    }
    const output = responseOutputRecords(data)
    const functionCalls = extractClientResponsesFunctionCalls(data)

    if (functionCalls.length === 0) {
      const finalResult = [prefix, result].filter(Boolean).join('\n\n')
      if (!finalResult) {
        return {
          type: 'fail',
          result: JSON.stringify(response.data),
        }
      }
      return { type: 'success', result: finalResult }
    }

    if (!db.simplifiedToolUse && result) prefix = [prefix, result].filter(Boolean).join('\n\n')
    for (const outputItem of output) {
      const sanitized = sanitizeResponsesContinuationItem(outputItem)
      if (!sanitized) continue
      if (db.simplifiedToolUse && 'type' in sanitized && sanitized.type === 'message') {
        body.input.push({ ...sanitized, content: [] })
      } else {
        body.input.push(sanitized)
      }
    }
    const callCodes: string[] = []
    for (const functionCall of functionCalls) {
      const callId = functionCall.call_id
      const tool = arg.tools?.find((candidate) => candidate.name === functionCall.name)
      let parsedArguments: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(functionCall.arguments || '{}') as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedArguments = parsed as Record<string, unknown>
        }
      } catch {
        parsedArguments = {}
      }

      let outputText: string
      if (!tool) {
        outputText = `No tool found with name: ${functionCall.name}`
      } else {
        try {
          const toolResponse = await callTool(tool.name, parsedArguments)
          const textParts = toolResponse.filter((item) => item.type === 'text')
          outputText = textParts.map((item) => item.text).join('\n') || 'Tool call failed with no text response'
          if (arg.rememberToolUsage) {
            callCodes.push(
              await encodeToolCall({
                call: {
                  id: callId,
                  name: functionCall.name,
                  arg: functionCall.arguments,
                },
                response: toolResponse,
              }),
            )
          }
        } catch (error) {
          outputText = `Tool call failed with error: ${error}`
        }
      }
      body.input.push({ type: 'function_call_output', call_id: callId, output: outputText })
    }
    if (callCodes.length) prefix = [prefix, callCodes.join('\n\n')].filter(Boolean).join('\n\n')
  }

  return { type: 'fail', result: language.errors.openAIResponsesToolCallLimit, noRetry: true }
}

function getTranStream(arg: RequestDataArgumentExtended): TransformStream<Uint8Array, StreamResponseChunk> {
  let dataUint: Uint8Array | Buffer = new Uint8Array([])
  let reasoningContent = ''
  let reasoningFromStructured = false
  const db = getDatabase()

  const appendStreamingFragment = (current: string, incoming?: string) => {
    if (!incoming) {
      return current
    }
    if (incoming.length > current.length && incoming.startsWith(current)) {
      return incoming
    }
    return current + incoming
  }

  return new TransformStream<Uint8Array, StreamResponseChunk>({
    transform(chunk, control) {
      const combined = new Uint8Array(dataUint.length + chunk.length)
      combined.set(dataUint, 0)
      combined.set(chunk, dataUint.length)
      dataUint = Buffer.from(combined)
      let JSONreaded: { [key: string]: string } = {}
      reasoningContent = ''
      try {
        const datas = dataUint.toString().split('\n')
        let readed: { [key: string]: string } = {}
        for (const data of datas) {
          if (data.startsWith('data: ')) {
            try {
              const rawChunk = data.replace('data: ', '')
              if (rawChunk === '[DONE]') {
                if (arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingOutput) && !reasoningFromStructured) {
                  readed['0'] = readed['0'].replace(/(.*)\<\/think\>/gms, (m, p1) => {
                    reasoningContent = p1
                    return ''
                  })

                  if (reasoningContent) {
                    reasoningContent = reasoningContent.replace(/\<think\>/gm, '')
                  }
                }
                if (arg.extractJson && (db.jsonSchemaEnabled || arg.schema)) {
                  for (const key in readed) {
                    const extracted = extractJSON(readed[key], arg.extractJson)
                    JSONreaded[key] = extracted
                  }
                  console.log(JSONreaded)
                  control.enqueue(JSONreaded)
                } else if (reasoningContent) {
                  const chunk: Record<string, string> = {
                    '0': `<Thoughts>\n${reasoningContent}\n</Thoughts>\n${readed['0'] ?? ''}`,
                  }
                  if (readed['__tool_calls']) {
                    chunk['__tool_calls'] = readed['__tool_calls']
                  }
                  control.enqueue(chunk)
                } else {
                  control.enqueue(readed)
                }
                return
              }
              const choices = JSON.parse(rawChunk).choices
              for (const choice of choices) {
                const chunk = choice.delta.content ?? choice.text
                if (chunk) {
                  if (arg.multiGen) {
                    const ind = choice.index.toString()
                    if (!readed[ind]) {
                      readed[ind] = ''
                    }
                    readed[ind] = appendStreamingFragment(readed[ind], chunk)
                  } else {
                    if (!readed['0']) {
                      readed['0'] = ''
                    }
                    readed['0'] = appendStreamingFragment(readed['0'], chunk)
                  }
                }
                // Check for tool calls in the delta
                if (choice?.delta?.tool_calls) {
                  if (!readed['__tool_calls']) {
                    readed['__tool_calls'] = JSON.stringify({})
                  }
                  const toolCallsData = JSON.parse(readed['__tool_calls'])

                  for (const toolCall of choice.delta.tool_calls) {
                    const index = toolCall.index ?? 0
                    const toolCallId = toolCall.id

                    // Initialize tool call data if not exists
                    if (!toolCallsData[index]) {
                      toolCallsData[index] = {
                        id: toolCallId || null,
                        type: 'function',
                        function: {
                          name: null,
                          arguments: '',
                        },
                      }
                    }

                    // Update tool call data incrementally
                    if (toolCall.id) {
                      toolCallsData[index].id = toolCall.id
                    }
                    if (toolCall.function?.name) {
                      toolCallsData[index].function.name = toolCall.function.name
                    }
                    if (toolCall.function?.arguments) {
                      toolCallsData[index].function.arguments = appendStreamingFragment(
                        toolCallsData[index].function.arguments,
                        toolCall.function.arguments,
                      )
                    }
                  }

                  readed['__tool_calls'] = JSON.stringify(toolCallsData)
                }
                const reasoningChunk = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
                if (reasoningChunk) {
                  reasoningFromStructured = true
                  reasoningContent = appendStreamingFragment(reasoningContent, reasoningChunk)
                }
              }
            } catch (error) {}
          }
        }

        if (arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingOutput) && !reasoningFromStructured) {
          readed['0'] = readed['0'].replace(/(.*)\<\/think\>/gms, (m, p1) => {
            reasoningContent = p1
            return ''
          })

          if (reasoningContent) {
            reasoningContent = reasoningContent.replace(/\<think\>/gm, '')
          }
        }
        if (arg.extractJson && (db.jsonSchemaEnabled || arg.schema)) {
          for (const key in readed) {
            const extracted = extractJSON(readed[key], arg.extractJson)
            JSONreaded[key] = extracted
          }
          console.log(JSONreaded)
          control.enqueue(JSONreaded)
        } else if (reasoningContent) {
          const chunk: Record<string, string> = {
            '0': `<Thoughts>\n${reasoningContent}\n</Thoughts>\n${readed['0'] ?? ''}`,
          }
          if (readed['__tool_calls']) {
            chunk['__tool_calls'] = readed['__tool_calls']
          }
          control.enqueue(chunk)
        } else {
          control.enqueue(readed)
        }
      } catch (error) {}
    },
  })
}

function wrapToolStream(
  stream: ReadableStream<StreamResponseChunk>,
  body: any,
  headers: Record<string, string>,
  replacerURL: string,
  arg: RequestDataArgumentExtended,
  networkOptions: LocalNetworkRequestOptions = {},
): ReadableStream<StreamResponseChunk> {
  return new ReadableStream<StreamResponseChunk>({
    async start(controller) {
      const db = getDatabase()
      let reader = stream.getReader()
      let prefix = ''
      let lastValue

      const extractThoughts = (text: string) => {
        let reasoningContent = ''
        const content = text.replace(/<Thoughts>\n?([\s\S]*?)\n?<\/Thoughts>\n*/g, (_, p1: string) => {
          reasoningContent += (reasoningContent ? '\n' : '') + p1
          return ''
        })
        return {
          content,
          reasoningContent,
        }
      }

      while (true) {
        let { done, value } = await reader.read()

        let content = value?.['0'] || ''
        if (done) {
          value = lastValue ?? { '0': '' }
          content = value?.['0'] || ''

          const toolCalls = Object.values(JSON.parse(value?.['__tool_calls'] || '{}') || {}) as ToolCall[]
          if (toolCalls && toolCalls.length > 0) {
            const messages = body.messages as OpenAIChatExtra[]
            let assistantContent = content
            let assistantReasoningContent = ''
            const shouldPassDeepSeekReasoning =
              arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingInput) ||
              (arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingToggle) && db.deepseekThinkingType === 'enabled')

            if (shouldPassDeepSeekReasoning) {
              const extracted = extractThoughts(content)
              assistantContent = extracted.content
              assistantReasoningContent = extracted.reasoningContent
            }

            const assistantMessage: OpenAIChatExtra = {
              role: 'assistant',
              content: db.simplifiedToolUse ? '' : assistantContent,
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: {
                  name: call.function.name,
                  arguments: call.function.arguments,
                },
              })),
            }
            if (assistantReasoningContent) {
              assistantMessage.reasoning_content = assistantReasoningContent
            }

            messages.push(assistantMessage)

            const callCodes: string[] = []

            for (const toolCall of toolCalls) {
              if (!toolCall.function || !toolCall.function.name || !toolCall.function.arguments) {
                continue
              }
              try {
                const functionArgs = JSON.parse(toolCall.function.arguments)
                if (arg.tools && arg.tools.length > 0) {
                  const tool = arg.tools.find((t) => t.name === toolCall.function.name)
                  if (!tool) {
                    messages.push({
                      role: 'tool',
                      content: 'No tool found with name: ' + toolCall.function.name,
                      tool_call_id: toolCall.id,
                    })
                  } else {
                    const parsed = functionArgs
                    const x = (await callTool(tool.name, parsed)).filter((m) => m.type === 'text')
                    if (x.length > 0) {
                      messages.push({
                        role: 'tool',
                        content: x[0].text,
                        tool_call_id: toolCall.id,
                      })
                      if (arg.rememberToolUsage) {
                        callCodes.push(
                          await encodeToolCall({
                            call: {
                              id: toolCall.id,
                              name: toolCall.function.name,
                              arg: toolCall.function.arguments,
                            },
                            response: x,
                          }),
                        )
                      }
                    } else {
                      messages.push({
                        role: 'tool',
                        content: 'Tool call failed with no text response',
                        tool_call_id: toolCall.id,
                      })
                    }
                  }
                }
              } catch (error) {
                messages.push({
                  role: 'tool',
                  content: 'Tool call failed with error: ' + error,
                  tool_call_id: toolCall.id,
                })
              }
            }

            body.messages = messages

            let resRec
            let attempt = 0
            let errorFlag = true

            do {
              attempt++
              resRec = await fetchNative(replacerURL, {
                body: JSON.stringify(body),
                method: 'POST',
                headers: serverOwnedOllamaHeaders(arg, headers),
                signal: arg.abortSignal,
                chatId: arg.chatId,
                interceptor: 'openai_tool',
                networkRoute: networkOptions.networkRoute,
                requestTimeoutMs: networkOptions.requestTimeoutMs,
                sensitive: !!arg.serverOwnedOllamaAuth,
              })

              if (resRec.status == 200 && resRec.headers.get('Content-Type').includes('text/event-stream')) {
                addFetchLog({
                  body: body,
                  response: 'Streaming',
                  success: true,
                  url: replacerURL,
                  status: resRec.status,
                })

                errorFlag = false
                break
              }
            } while (attempt <= db.requestRetrys) // Retry up to db.requestRetrys times

            if (errorFlag) {
              alertError(language.errors.toolFollowupRequestFailed)
              return controller.close()
            }

            const transtream = getTranStream(arg)
            resRec.body.pipeTo(transtream.writable)

            reader = transtream.readable.getReader()

            prefix += (content && !db.simplifiedToolUse ? content + '\n\n' : '') + callCodes.join('\n\n')
            controller.enqueue({ '0': prefix })

            continue
          }
          return controller.close()
        }

        lastValue = value

        controller.enqueue({ '0': (prefix ? prefix + '\n\n' : '') + content })
      }
    },
  })
}
