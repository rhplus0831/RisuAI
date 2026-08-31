import { Sha256 } from '@aws-crypto/sha256-js'
import { HttpRequest } from '@smithy/protocol-http'
import { SignatureV4 } from '@smithy/signature-v4'
import { language } from 'src/lang'
import { fetchNative, globalFetch, textifyReadableStream } from 'src/ts/globalApi.svelte'
import { LLMFlags, LLMFormat } from 'src/ts/model/modellist'
import { registerClaudeObserver } from 'src/ts/observer.svelte'
import { replaceAsync, simplifySchema, sleep } from 'src/ts/util'
import { v4 } from 'uuid'
import type { MultiModal } from '../index.svelte'
import { extractJSON } from '../templates/jsonSchema'
import { callTool, decodeToolCall, encodeToolCall } from '../mcp/mcp'
import type { RequestDataArgumentExtended, requestDataResponse, StreamResponseChunk } from './request'
import {
  applyAdditionalParameters,
  applyParameters,
  getAdditionalParameters,
  getRequestAdditionalParameters,
} from './shared'

interface Claude3TextBlock {
  type: 'text'
  text: string
  cache_control?: {
    type: 'ephemeral'
    ttl?: '5m' | '1h'
  }
}

interface Claude3ImageBlock {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
  cache_control?: {
    type: 'ephemeral'
    ttl?: '5m' | '1h'
  }
}

interface Claude3ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: any
  cache_control?: {
    type: 'ephemeral'
    ttl?: '5m' | '1h'
  }
}

interface Claude3ToolResponseBlock {
  type: 'tool_result'
  tool_use_id: string
  content: Claude3ContentBlock[]
  cache_control?: {
    type: 'ephemeral'
    ttl?: '5m' | '1h'
  }
}

type Claude3ContentBlock = Claude3TextBlock | Claude3ImageBlock | Claude3ToolUseBlock | Claude3ToolResponseBlock

interface Claude3Chat {
  role: 'user' | 'assistant'
  content: Claude3ContentBlock[]
}

interface Claude3ExtendedChat {
  role: 'user' | 'assistant'
  content: Claude3ContentBlock[] | string
}

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MESSAGES_SUFFIX = '/messages'
const ANTHROPIC_TOOL_LOOP_LIMIT = 8

function appendAnthropicMessagesPath(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (!trimmed || trimmed.endsWith(ANTHROPIC_MESSAGES_SUFFIX)) {
    return trimmed
  }

  try {
    const url = new URL(trimmed)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const suffixSegments = ANTHROPIC_MESSAGES_SUFFIX.split('/').filter(Boolean)
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
    return `${trimmed}${ANTHROPIC_MESSAGES_SUFFIX}`
  }
}

function serverOwnedOllamaHeaders(
  arg: RequestDataArgumentExtended,
  headers: Record<string, string>,
): Record<string, string> {
  return arg.serverOwnedOllamaAuth ? { ...headers, 'risu-auth': arg.serverOwnedOllamaAuth } : headers
}

export async function requestClaude(arg: RequestDataArgumentExtended): Promise<requestDataResponse> {
  const formated = arg.formated
  const db = arg.database
  const aiModel = arg.aiModel
  const resolvedProfile = arg.resolvedProfile
  const providerOptions = resolvedProfile?.providerOptions
  const runtimeOptions = resolvedProfile?.runtimeOptions
  const hasResolvedProfile = resolvedProfile !== undefined
  const thinkingType = hasResolvedProfile ? runtimeOptions?.thinkingType : db.thinkingType
  const adaptiveThinkingEffort = hasResolvedProfile ? runtimeOptions?.adaptiveThinkingEffort : db.adaptiveThinkingEffort
  const useStreaming = arg.useStreaming
  const ollamaCloudAnthropic = aiModel === 'ollama-cloud'
  let replacerURL = hasResolvedProfile
    ? providerOptions?.endpoint
      ? providerOptions.endpoint
      : providerOptions?.baseUrl
        ? appendAnthropicMessagesPath(providerOptions.baseUrl)
        : ANTHROPIC_MESSAGES_URL
    : (arg.customURL ?? ANTHROPIC_MESSAGES_URL)
  let apiKey = hasResolvedProfile
    ? (providerOptions?.apiKey ?? '')
    : arg.key || (aiModel === 'reverse_proxy' ? db.proxyKey : db.claudeAPIKey) || ''
  const maxTokens = arg.maxTokens
  if (!hasResolvedProfile && aiModel === 'reverse_proxy' && db.autofillRequestUrl) {
    if (replacerURL.endsWith('v1')) {
      replacerURL += '/messages'
    } else if (replacerURL.endsWith('v1/')) {
      replacerURL += 'messages'
    } else if (!(replacerURL.endsWith('messages') || replacerURL.endsWith('messages/'))) {
      if (replacerURL.endsWith('/')) {
        replacerURL += 'v1/messages'
      } else {
        replacerURL += '/v1/messages'
      }
    }
  }

  let claudeChat: Claude3Chat[] = []
  let systemPrompt: string = ''

  const addClaudeChat = (
    chat: {
      role: 'user' | 'assistant'
      content: string
      cache: boolean
    },
    multimodals?: MultiModal[],
  ) => {
    if (claudeChat.length > 0 && claudeChat[claudeChat.length - 1].role === chat.role) {
      let content = claudeChat[claudeChat.length - 1].content
      if (multimodals && multimodals.length > 0 && !Array.isArray(content)) {
        content = [
          {
            type: 'text',
            text: content,
          },
        ]
      }

      if (Array.isArray(content)) {
        let lastContent = content[content.length - 1]
        if (lastContent?.type === 'text') {
          lastContent.text += '\n\n' + chat.content
          content[content.length - 1] = lastContent
        } else {
          content.push({
            type: 'text',
            text: chat.content,
          })
        }

        if (multimodals && multimodals.length > 0) {
          for (const modal of multimodals) {
            if (modal.type === 'image') {
              const dataurl = modal.base64
              const base64 = dataurl.split(',')[1]
              const mediaType = dataurl.split(';')[0].split(':')[1]

              content.unshift({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64,
                },
              })
            }
          }
        }
      }
      if (chat.cache) {
        if (db.claude1HourCaching) {
          content[content.length - 1].cache_control = {
            type: 'ephemeral',
            ttl: '1h',
          }
        } else {
          content[content.length - 1].cache_control = {
            type: 'ephemeral',
          }
        }
      }
      claudeChat[claudeChat.length - 1].content = content
    } else {
      let formatedChat: Claude3Chat = {
        role: chat.role,
        content: [
          {
            type: 'text',
            text: chat.content,
          },
        ],
      }
      if (multimodals && multimodals.length > 0) {
        formatedChat.content = [
          {
            type: 'text',
            text: chat.content,
          },
        ]
        for (const modal of multimodals) {
          if (modal.type === 'image') {
            const dataurl = modal.base64
            const base64 = dataurl.split(',')[1]
            const mediaType = dataurl.split(';')[0].split(':')[1]

            formatedChat.content.unshift({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64,
              },
            })
          }
        }
      }
      if (chat.cache) {
        if (db.claude1HourCaching) {
          formatedChat.content[0].cache_control = {
            type: 'ephemeral',
            ttl: '1h',
          }
        } else {
          formatedChat.content[0].cache_control = {
            type: 'ephemeral',
          }
        }
      }
      claudeChat.push(formatedChat)
    }
  }
  for (const chat of formated) {
    switch (chat.role) {
      case 'user': {
        addClaudeChat(
          {
            role: 'user',
            content: chat.content,
            cache: chat.cachePoint,
          },
          chat.multimodals,
        )
        break
      }
      case 'assistant': {
        addClaudeChat(
          {
            role: 'assistant',
            content: chat.content,
            cache: chat.cachePoint,
          },
          chat.multimodals,
        )
        break
      }
      case 'system': {
        if (claudeChat.length === 0) {
          systemPrompt += '\n\n' + chat.content
        } else {
          addClaudeChat({
            role: 'user',
            content: 'System: ' + chat.content,
            cache: chat.cachePoint,
          })
        }
        break
      }
      case 'function': {
        break
      }
    }
  }
  if (claudeChat.length === 0 && systemPrompt === '') {
    return {
      type: 'fail',
      result: 'No input',
    }
  }
  if (claudeChat.length === 0 && systemPrompt !== '') {
    claudeChat.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Start',
        },
      ],
    })
    systemPrompt = ''
  }
  if (claudeChat[0].role !== 'user') {
    claudeChat.unshift({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Start',
        },
      ],
    })
  }

  //check for tool calls
  for (let j = 0; j < claudeChat.length; j++) {
    let chat = claudeChat[j]
    for (let i = 0; i < chat.content.length; i++) {
      let content = chat.content[i]
      if (content.type === 'text') {
        content.text = await replaceAsync(
          content.text,
          /<tool_call>(.*?)<\/tool_call>/g,
          async (match: string, p1: string) => {
            try {
              const parsed = await decodeToolCall(p1)
              if (parsed?.call && parsed?.response) {
                const toolUse: Claude3ToolUseBlock = {
                  type: 'tool_use',
                  id: parsed.call.id,
                  name: parsed.call.name,
                  input: parsed.call.arg,
                }
                const toolResponse: Claude3ToolResponseBlock = {
                  type: 'tool_result',
                  tool_use_id: parsed.call.id,
                  content: parsed.response.map((v: any) => {
                    if (v.type === 'text') {
                      return {
                        type: 'text',
                        text: v.text,
                      }
                    }
                    if (v.type === 'image') {
                      return {
                        type: 'image',
                        source: {
                          type: 'base64',
                          media_type: v.mimeType,
                          data: v.data,
                        },
                      }
                    }
                    return {
                      type: 'text',
                      text: `Unsupported tool response type: ${v.type}`,
                    }
                  }),
                }
                claudeChat.splice(j, 0, {
                  role: 'assistant',
                  content: [toolUse],
                })

                claudeChat.splice(j + 1, 0, {
                  role: 'user',
                  content: [toolResponse],
                })
                j += 2
                chat = claudeChat[j]
                return ''
              }
            } catch (error) {}

            return ''
          },
        )
      }
    }
  }

  let finalChat: Claude3ExtendedChat[] = claudeChat

  if (aiModel === 'reverse_proxy') {
    finalChat = claudeChat.map((v) => {
      if (v.content.length > 0 && v.content[0].type === 'text') {
        return {
          role: v.role,
          content: v.content[0].text,
        }
      }
    })
  }

  console.log(arg.modelInfo.parameters)
  const requestModel = hasResolvedProfile
    ? (providerOptions?.requestModel ?? arg.modelInfo.internalID)
    : arg.modelInfo.internalID
  let body = applyParameters(
    {
      model: requestModel,
      messages: finalChat,
      system: systemPrompt.trim(),
      max_tokens: maxTokens,
      stream: useStreaming ?? false,
    },
    arg.modelInfo.parameters,
    {
      thinking_tokens: 'thinking.budget_tokens',
    },
    arg.mode,
    {
      database: db,
      modelId: arg.modelInfo.id,
      runtimeOptions: arg.resolvedProfile?.runtimeOptions,
    },
  )

  // Handle thinking mode: off, adaptive, or budget
  if (thinkingType === 'off') {
    delete body.thinking
  } else if (thinkingType === 'adaptive' && arg.modelInfo.flags.includes(LLMFlags.claudeAdaptiveThinking)) {
    // Adaptive thinking mode
    delete body.thinking
    body.thinking = { type: 'adaptive', display: 'summarized' }
    let effort = adaptiveThinkingEffort ?? 'high'
    if (effort === 'xhigh' && !arg.modelInfo.flags.includes(LLMFlags.claudeXHighEffort)) {
      effort = 'high'
    }
    body.output_config = { effort }
  } else if (body?.thinking?.budget_tokens === 0) {
    delete body.thinking
  } else if (body?.thinking?.budget_tokens && body?.thinking?.budget_tokens > 0) {
    body.thinking.type = 'enabled'
    body.thinking.display = 'summarized'
  } else if (body?.thinking?.budget_tokens === null) {
    delete body.thinking
  }

  if (systemPrompt === '') {
    delete body.system
  }

  const bedrock = arg.modelInfo.format === LLMFormat.AWSBedrockClaude
  const additionalParams = hasResolvedProfile
    ? getRequestAdditionalParameters(
        db,
        aiModel,
        providerOptions?.additionalParams ?? [],
        providerOptions?.extraHeaders,
      )
    : getAdditionalParameters(db, aiModel)
  const hasCustomAnthropicBeta = additionalParams.some(([key]) => {
    return key.startsWith('header::') && key.slice('header::'.length).toLocaleLowerCase() === 'anthropic-beta'
  })

  if (bedrock && aiModel !== 'reverse_proxy') {
    function getCredentialParts(key: string) {
      const [accessKeyId, secretAccessKey, region] = key.split(':')

      if (!accessKeyId || !secretAccessKey || !region) {
        throw new Error(language.errors.anthropicCredentialInvalid)
      }

      return { accessKeyId, secretAccessKey, region }
    }
    const { accessKeyId, secretAccessKey, region } = getCredentialParts(apiKey)

    const AMZ_HOST = 'bedrock-runtime.%REGION%.amazonaws.com'
    const host = AMZ_HOST.replace('%REGION%', region)
    const stream = false // This path signs and parses the non-streaming InvokeModel response.

    // https://docs.claude.com/en/api/claude-on-amazon-bedrock#global-vs-regional-endpoints
    let useGlobal = false

    const datePart = Number(arg.modelInfo.internalID.match(/(\d{8})/)?.[0])
    const versionMatch = arg.modelInfo.internalID.match(/claude-(?:opus-|sonnet-|haiku-)?(\d+)-(\d+)/)

    if (datePart && !isNaN(datePart)) {
      useGlobal = datePart >= 20250929
    } else if (versionMatch) {
      const majorVersion = Number(versionMatch[1])
      const minorVersion = Number(versionMatch[2])
      useGlobal = majorVersion > 4 || (majorVersion === 4 && minorVersion >= 5)
    }

    const legacyAwsModel = useGlobal ? 'global.' + arg.modelInfo.internalID : 'us.' + arg.modelInfo.internalID
    const awsModel = hasResolvedProfile ? (providerOptions?.requestModel ?? legacyAwsModel) : legacyAwsModel

    const url = `https://${host}/model/${awsModel}/invoke${stream ? '-with-response-stream' : ''}`

    let params = { ...body }
    params.anthropic_version = 'bedrock-2023-05-31'
    delete params.model
    delete params.stream
    if (params.thinking?.type === 'enabled' || params.thinking?.type === 'adaptive') {
      params.temperature = 1.0
      delete params.top_k
      delete params.top_p
    }

    let bedrockHeaders: Record<string, string> = {
      ['Host']: host,
      ['Content-Type']: 'application/json',
      ['accept']: 'application/json',
    }

    if (additionalParams.length > 0) {
      params = applyAdditionalParameters(params, bedrockHeaders, additionalParams)
    }

    const rq = new HttpRequest({
      method: 'POST',
      protocol: 'https:',
      hostname: host,
      path: `/model/${awsModel}/invoke${stream ? '-with-response-stream' : ''}`,
      headers: bedrockHeaders,
      body: JSON.stringify(params),
    })

    const signer = new SignatureV4({
      sha256: Sha256,
      credentials: { accessKeyId, secretAccessKey },
      region,
      service: 'bedrock',
    })

    const signed = await signer.sign(rq)

    if (arg.previewBody) {
      return {
        type: 'success',
        result: JSON.stringify({
          url: url,
          body: params,
          headers: signed.headers,
        }),
      }
    }

    const res = await globalFetch(url, {
      method: 'POST',
      body: params,
      headers: signed.headers,
      plainFetchForce: true,
      chatId: arg.chatId,
      interceptor: 'anthropic_bedrock',
    })

    if (!res.ok) {
      return {
        type: 'fail',
        result: JSON.stringify(res.data),
      }
    }
    if (res.data.error) {
      return {
        type: 'fail',
        result: JSON.stringify(res.data.error),
      }
    }
    const contents = res?.data?.content
    if (!contents || contents.length === 0) {
      return {
        type: 'fail',
        result: JSON.stringify(res.data),
      }
    }
    let resText = ''
    let thinking = false
    for (const content of contents) {
      if (content.type === 'text') {
        if (thinking) {
          resText += '</Thoughts>\n\n'
          thinking = false
        }
        resText += content.text
      }
      if (content.type === 'thinking') {
        if (!thinking) {
          resText += '<Thoughts>\n'
          thinking = true
        }
        resText += content.thinking ?? ''
      }
      if (content.type === 'redacted_thinking') {
        if (!thinking) {
          resText += '<Thoughts>\n'
          thinking = true
        }
        resText += '\n{{redacted_thinking}}\n'
      }
    }

    if (thinking) {
      resText += '</Thoughts>\n\n'
    }

    if (arg.extractJson && db.jsonSchemaEnabled) {
      return {
        type: 'success',
        result: extractJSON(resText, db.jsonSchema),
      }
    }
    return {
      type: 'success',
      result: resText,
    }
  }

  let headers: {
    [key: string]: string
  } = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    accept: 'application/json',
  }

  if (ollamaCloudAnthropic) {
    headers['Authorization'] = 'Bearer ' + apiKey
    delete headers['x-api-key']
  }

  if (db.usePlainFetch) {
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  }

  if (hasResolvedProfile && providerOptions?.extraHeaders) {
    headers = {
      ...headers,
      ...providerOptions.extraHeaders,
    }
  }

  if (arg.tools && arg.tools.length > 0) {
    body.tools = arg.tools.map((v) => {
      return {
        name: v.name,
        description: v.description,
        input_schema: simplifySchema(v.inputSchema),
      }
    })
  }

  if (additionalParams.length > 0) {
    body = applyAdditionalParameters(body, headers, additionalParams)
  }

  let betas: string[] = []

  if (body.max_tokens > 8192) {
    betas.push('output-128k-2025-02-19')
  }

  if (db.claude1HourCaching) {
    betas.push('extended-cache-ttl-2025-04-11')
  }

  if (betas.length > 0 && !hasCustomAnthropicBeta) {
    headers['anthropic-beta'] = betas.join(',')
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

  if (db.claudeBatching && !ollamaCloudAnthropic) {
    if (body.stream !== undefined) {
      delete body.stream
    }
    const id = v4()
    const resp = await fetchNative(replacerURL + '/batches', {
      body: JSON.stringify({
        requests: [
          {
            custom_id: id,
            params: body,
          },
        ],
      }),
      method: 'POST',
      signal: arg.abortSignal,
      headers: headers,
      interceptor: 'anthropic_batching',
    })

    if (resp.status !== 200) {
      return {
        type: 'fail',
        result: await textifyReadableStream(resp.body),
      }
    }

    const r = await resp.json()

    if (!r.id) {
      return {
        type: 'fail',
        result: language.errors.claudeBatchResultMissing,
      }
    }

    const statusUrl = replacerURL + `/batches/${r.id}`
    const resultsUrl = replacerURL + `/batches/${r.id}/results`
    const cancelUrl = replacerURL + `/batches/${r.id}/cancel`
    const abortSignal = arg.abortSignal

    // Streaming is used in batch API to apply successful response even after abortSignal is fired
    // In order to do otherwise, `request.ts` and `index.svelte.ts` should be edited to bypass abort signal check
    const stream = new ReadableStream<StreamResponseChunk>({
      async start(controller) {
        const batchStartTime = Date.now()
        const BATCH_TIMEOUT = 24 * 60 * 60 * 1000 + 600 * 1000 // 24 hours + 10 minutes
        let cancelRequested = false

        while (true) {
          try {
            await sleep(3000)
            if (abortSignal?.aborted && !cancelRequested) {
              cancelRequested = true
              try {
                await fetchNative(cancelUrl, {
                  body: '{}',
                  method: 'POST',
                  headers: headers,
                  interceptor: 'anthropic_batching_cancel',
                })
              } catch (e) {
                // ignore cancel request errors
              }
            }
            if (Date.now() - batchStartTime > BATCH_TIMEOUT) {
              controller.error(new Error(language.errors.claudeBatchTimedOut))
              return
            }

            const statusRes = await fetchNative(statusUrl, {
              method: 'GET',
              headers: headers,
              signal: cancelRequested ? undefined : abortSignal,
              interceptor: 'anthropic_batching_status',
            })

            if (statusRes.status !== 200) {
              controller.error(new Error(await textifyReadableStream(statusRes.body)))
              return
            }

            const statusData = await statusRes.json()

            if (statusData.processing_status !== 'ended') {
              continue
            }

            const batchRes = await fetchNative(resultsUrl, {
              method: 'GET',
              headers: headers,
              signal: cancelRequested ? undefined : abortSignal,
              interceptor: 'anthropic_batching_results',
            })

            if (batchRes.status !== 200) {
              controller.error(new Error(await textifyReadableStream(batchRes.body)))
              return
            }

            //since jsonl
            const batchTextData = (await batchRes.text())
              .split('\n')
              .filter((v) => v.trim() !== '')
              .map((v) => {
                try {
                  return JSON.parse(v)
                } catch (error) {
                  return null
                }
              })
              .filter((v) => v !== null)

            for (const batchData of batchTextData) {
              const type = batchData?.result?.type
              console.log('Claude batch result type:', type)
              if (batchData?.result?.type === 'succeeded') {
                const contents = batchData.result.message.content ?? []
                let resText = ''
                let thinking = false
                for (const content of contents) {
                  if (content.type === 'text') {
                    if (thinking) {
                      resText += '</Thoughts>\n\n'
                      thinking = false
                    }
                    resText += content.text
                  }
                  if (content.type === 'thinking') {
                    if (!thinking) {
                      resText += '<Thoughts>\n'
                      thinking = true
                    }
                    resText += content.thinking ?? ''
                  }
                  if (content.type === 'redacted_thinking') {
                    if (!thinking) {
                      resText += '<Thoughts>\n'
                      thinking = true
                    }
                    resText += '\n{{redacted_thinking}}\n'
                  }
                }

                if (thinking) {
                  resText += '</Thoughts>\n\n'
                  thinking = false
                }

                controller.enqueue({ '0': resText })
                controller.close()
                return
              }
              if (batchData?.result?.type === 'errored') {
                const batchError = batchData.result.error

                const message = batchError?.error?.message
                  ? `${batchError.error.type}: ${batchError.error.message}`
                  : JSON.stringify(batchError)

                controller.error(new Error(message))
                return
              }
              if (batchData?.result?.type === 'canceled') {
                controller.close()
                return
              }
              if (batchData?.result?.type === 'expired') {
                controller.error(new Error(language.errors.claudeBatchExpired))
                return
              }
            }
          } catch (error) {
            console.error('Error while waiting for Claude batch results:', error)
          }
        }
      },
    })

    return {
      type: 'streaming',
      result: stream,
    }
  }

  if (db.claudeRetrivalCaching) {
    registerClaudeObserver({
      url: replacerURL,
      body: body,
      headers: headers,
    })
  }

  return requestClaudeHTTP(replacerURL, headers, body, arg)
}

async function requestClaudeHTTP(
  replacerURL: string,
  headers: { [key: string]: string },
  body: any,
  arg: RequestDataArgumentExtended,
): Promise<requestDataResponse> {
  const db = arg.database
  if (arg.useStreaming && arg.tools?.length && arg.serverOwnedOllamaAuth) {
    return requestClaudeToolStream(replacerURL, headers, body, arg)
  }
  if (arg.useStreaming) {
    const res = await fetchNative(replacerURL, {
      body: JSON.stringify(body),
      headers: serverOwnedOllamaHeaders(arg, headers),
      method: 'POST',
      chatId: arg.chatId,
      signal: arg.abortSignal,
      interceptor: 'anthropic_streaming',
      sensitive: !!arg.serverOwnedOllamaAuth,
    })

    if (res.status !== 200) {
      return {
        type: 'fail',
        result: await textifyReadableStream(res.body),
      }
    }
    let breakError = ''
    let thinking = false

    const stream = new ReadableStream<StreamResponseChunk>({
      async start(controller) {
        let text = ''
        let reader = res.body.getReader()
        let parserData = ''
        const decoder = new TextDecoder()
        const parseEvent = (e: string) => {
          try {
            const parsedData = JSON.parse(e)

            if (parsedData?.type === 'content_block_delta') {
              if (parsedData?.delta?.type === 'text' || parsedData.delta?.type === 'text_delta') {
                if (thinking) {
                  text += '</Thoughts>\n\n'
                  thinking = false
                }
                text += parsedData.delta?.text ?? ''
              }

              if (parsedData?.delta?.type === 'thinking' || parsedData.delta?.type === 'thinking_delta') {
                if (!thinking) {
                  text += '<Thoughts>\n'
                  thinking = true
                }
                text += parsedData.delta?.thinking ?? ''
              }

              if (parsedData?.delta?.type === 'redacted_thinking') {
                if (!thinking) {
                  text += '<Thoughts>\n'
                  thinking = true
                }
                text += '\n{{redacted_thinking}}\n'
              }
            }

            if (parsedData?.type === 'error') {
              const errormsg: string = parsedData?.error?.message
              if (errormsg && errormsg.toLocaleLowerCase().includes('overload') && db.antiServerOverloads) {
                controller.enqueue({
                  '0': 'Overload detected, retrying...',
                })

                return 'overload'
              }
              text += 'Error:' + parsedData?.error?.message
            }
          } catch (error) {}
        }
        let breakWhile = false
        let i = 0
        let prevText = ''
        while (true) {
          try {
            if (arg?.abortSignal?.aborted || breakWhile) {
              break
            }
            const { done, value } = await reader.read()
            const decoded = done ? decoder.decode() : decoder.decode(value, { stream: true })
            if (done && !decoded) {
              break
            }
            parserData += decoded
            let parts = parserData.split('\n')
            for (; i < parts.length - 1; i++) {
              prevText = text
              if (parts?.[i]?.startsWith('data: ')) {
                const d = await parseEvent(parts[i].slice(6))
                if (d === 'overload') {
                  parserData = ''
                  prevText = ''
                  text = ''
                  reader.cancel()
                  const res = await fetchNative(replacerURL, {
                    body: JSON.stringify(body),
                    headers: serverOwnedOllamaHeaders(arg, headers),
                    method: 'POST',
                    chatId: arg.chatId,
                    signal: arg.abortSignal,
                    interceptor: 'anthropic_streaming_retry',
                    sensitive: !!arg.serverOwnedOllamaAuth,
                  })

                  if (res.status !== 200) {
                    controller.enqueue({
                      '0': await textifyReadableStream(res.body),
                    })
                    breakWhile = true
                    break
                  }

                  reader = res.body.getReader()
                  break
                }
              }
            }
            i--
            text = prevText

            controller.enqueue({
              '0': text,
            })
            if (done) {
              break
            }
          } catch (error) {
            await sleep(1)
          }
        }
        if (thinking) {
          text += '</Thoughts>\n\n'
          controller.enqueue({
            '0': text,
          })
        }
        controller.close()
      },
      cancel() {},
    })

    return {
      type: 'streaming',
      result: stream,
    }
  }

  const res = await globalFetch(replacerURL, {
    body: body,
    headers: serverOwnedOllamaHeaders(arg, headers),
    method: 'POST',
    chatId: arg.chatId,
    interceptor: 'anthropic_http',
    plainFetchForce: !!arg.serverOwnedOllamaAuth,
    sensitive: !!arg.serverOwnedOllamaAuth,
  })

  if (!res.ok) {
    const stringlified = JSON.stringify(res.data)
    return {
      type: 'fail',
      result: stringlified,
      failByServerError: stringlified?.toLocaleLowerCase()?.includes('overload'),
    }
  }
  if (res.data.error) {
    const stringlified = JSON.stringify(res.data.error)
    return {
      type: 'fail',
      result: stringlified,
      failByServerError: stringlified?.toLocaleLowerCase()?.includes('overload'),
    }
  }
  const contents = res?.data?.content
  if (!contents || contents.length === 0) {
    return {
      type: 'fail',
      result: JSON.stringify(res.data),
    }
  }
  let resText = ''
  let thinking = false

  const hasToolUse = (contents as any[]).some((v) => v.type === 'tool_use')

  if (hasToolUse) {
    const messages: Claude3ExtendedChat[] = body.messages
    const response: Claude3Chat = {
      role: 'user',
      content: [],
    }

    for (const content of contents as Claude3ContentBlock[]) {
      if (messages[messages.length - 1].role !== 'assistant') {
        messages.push({
          role: 'assistant',
          content: [],
        })
      }
      if (typeof messages[messages.length - 1].content === 'string') {
        messages[messages.length - 1].content = [
          {
            type: 'text',
            text: messages[messages.length - 1].content as string,
          },
        ]
      }

      if (content.type === 'tool_use') {
        const used = await callTool(content.name, content.input)
        const r: Claude3ToolResponseBlock = {
          type: 'tool_result',
          tool_use_id: content.id,
          content: used.map((v) => {
            switch (v.type) {
              case 'text': {
                return {
                  type: 'text',
                  text: v.text,
                }
              }
              case 'image': {
                return {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: v.mimeType,
                    data: v.data,
                  },
                }
              }
              default: {
                return {
                  type: 'text',
                  text: `Unsupported tool response type: ${v.type}`,
                }
              }
            }
          }),
        }
        response.content.push(r)
        if (arg.rememberToolUsage) {
          arg.additionalOutput ??= ''
          arg.additionalOutput += await encodeToolCall({
            call: {
              id: content.id,
              name: content.name,
              arg: content.input,
            },
            response: used,
          })
        }
      }

      ;(messages[messages.length - 1] as Claude3Chat).content.push(content)
    }

    messages.push(response)

    body.messages = messages
    body.stream = false

    return requestClaudeHTTP(replacerURL, headers, body, arg)
  }
  for (const content of contents) {
    if (content.type === 'text') {
      if (thinking) {
        resText += '</Thoughts>\n\n'
        thinking = false
      }
      resText += content.text
    }
    if (content.type === 'thinking') {
      if (!thinking) {
        resText += '<Thoughts>\n'
        thinking = true
      }
      resText += content.thinking ?? ''
    }
    if (content.type === 'redacted_thinking') {
      if (!thinking) {
        resText += '<Thoughts>\n'
        thinking = true
      }
      resText += '\n{{redacted_thinking}}\n'
    }
    if (content.type === 'tool_use') {
    }
  }

  if (thinking) {
    resText += '</Thoughts>\n\n'
  }

  arg.additionalOutput ??= ''
  if (arg.extractJson && db.jsonSchemaEnabled) {
    return {
      type: 'success',
      result: arg.additionalOutput + extractJSON(resText, db.jsonSchema),
    }
  }
  return {
    type: 'success',
    result: arg.additionalOutput + resText,
  }
}

interface StreamingClaudeToolUse {
  id: string
  name: string
  partialJson: string
}

async function requestClaudeToolStream(
  replacerURL: string,
  headers: Record<string, string>,
  body: any,
  arg: RequestDataArgumentExtended,
): Promise<requestDataResponse> {
  const db = arg.database
  const stream = new ReadableStream<StreamResponseChunk>({
    async start(controller) {
      let prefix = ''

      try {
        for (let round = 0; round < ANTHROPIC_TOOL_LOOP_LIMIT; round++) {
          const response = await fetchNative(replacerURL, {
            body: JSON.stringify(body),
            headers: serverOwnedOllamaHeaders(arg, headers),
            method: 'POST',
            chatId: arg.chatId,
            signal: arg.abortSignal,
            interceptor: round === 0 ? 'anthropic_streaming' : 'anthropic_tool',
            sensitive: !!arg.serverOwnedOllamaAuth,
          })
          if (response.status !== 200 || !response.body) {
            const message = response.body ? await textifyReadableStream(response.body) : `HTTP ${response.status}`
            controller.error(new Error(message))
            return
          }

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let pending = ''
          let text = ''
          let thinking = ''
          const tools = new Map<number, StreamingClaudeToolUse>()
          const contentBlocks = new Map<number, Record<string, any>>()

          const visible = (): string => {
            const current = thinking ? `<Thoughts>\n${thinking}\n</Thoughts>\n\n${text}` : text
            return [prefix, current].filter(Boolean).join('\n\n')
          }
          const processEvent = (raw: string): void => {
            let event: any
            try {
              event = JSON.parse(raw)
            } catch {
              return
            }
            if (event?.type === 'error') {
              throw new Error(event?.error?.message || language.errors.anthropicStreamFailed)
            }
            const index = typeof event?.index === 'number' ? event.index : 0
            if (event?.type === 'content_block_start') {
              const block = event.content_block
              if (block && typeof block === 'object') contentBlocks.set(index, { ...block })
              if (block?.type === 'text' && typeof block.text === 'string') text += block.text
              if (block?.type === 'thinking' && typeof block.thinking === 'string') thinking += block.thinking
              if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
                tools.set(index, {
                  id: block.id,
                  name: block.name,
                  partialJson:
                    block.input && typeof block.input === 'object' && Object.keys(block.input).length > 0
                      ? JSON.stringify(block.input)
                      : '',
                })
              }
            }
            if (event?.type === 'content_block_delta') {
              const delta = event.delta
              const block = contentBlocks.get(index)
              if ((delta?.type === 'text' || delta?.type === 'text_delta') && typeof delta.text === 'string') {
                text += delta.text
                if (block) block.text = `${typeof block.text === 'string' ? block.text : ''}${delta.text}`
              }
              if (
                (delta?.type === 'thinking' || delta?.type === 'thinking_delta') &&
                typeof delta.thinking === 'string'
              ) {
                thinking += delta.thinking
                if (block) {
                  block.thinking = `${typeof block.thinking === 'string' ? block.thinking : ''}${delta.thinking}`
                }
              }
              if (delta?.type === 'redacted_thinking') {
                thinking += '\n{{redacted_thinking}}\n'
                if (block && typeof delta.data === 'string') block.data = delta.data
              }
              if (delta?.type === 'signature_delta' && typeof delta.signature === 'string' && block) {
                block.signature = `${typeof block.signature === 'string' ? block.signature : ''}${delta.signature}`
              }
              if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
                const tool = tools.get(index)
                if (tool) tool.partialJson += delta.partial_json
              }
            }
          }

          while (true) {
            const { done, value } = await reader.read()
            pending += done ? decoder.decode() : decoder.decode(value, { stream: true })
            const lines = pending.split('\n')
            pending = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data:')) continue
              const data = line.slice('data:'.length).trim()
              if (data && data !== '[DONE]') processEvent(data)
            }
            controller.enqueue({ '0': visible() })
            if (done) break
          }
          if (pending.startsWith('data:')) {
            const data = pending.slice('data:'.length).trim()
            if (data && data !== '[DONE]') processEvent(data)
          }

          if (tools.size === 0) {
            controller.enqueue({ '0': visible() })
            controller.close()
            return
          }

          const assistantContent = [...contentBlocks.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, block]) => block)
          const toolResultContent: Claude3ToolResponseBlock[] = []
          const callCodes: string[] = []

          for (const toolUse of tools.values()) {
            let input: Record<string, unknown> = {}
            try {
              const parsed = JSON.parse(toolUse.partialJson || '{}') as unknown
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                input = parsed as Record<string, unknown>
              }
            } catch {
              input = {}
            }
            const streamedBlock = assistantContent.find((block) => block.type === 'tool_use' && block.id === toolUse.id)
            if (streamedBlock) streamedBlock.input = input
            else assistantContent.push({ type: 'tool_use', id: toolUse.id, name: toolUse.name, input })

            const tool = arg.tools?.find((candidate) => candidate.name === toolUse.name)
            let toolResponse: Awaited<ReturnType<typeof callTool>>
            try {
              toolResponse = tool
                ? await callTool(tool.name, input)
                : [{ type: 'text', text: `No tool found with name: ${toolUse.name}` }]
            } catch (error) {
              toolResponse = [{ type: 'text', text: `Tool call failed with error: ${error}` }]
            }
            toolResultContent.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: toolResponse.map((item) =>
                item.type === 'image'
                  ? {
                      type: 'image',
                      source: { type: 'base64', media_type: item.mimeType, data: item.data },
                    }
                  : {
                      type: 'text',
                      text: item.type === 'text' ? item.text : `Unsupported tool response: ${item.type}`,
                    },
              ),
            })
            if (arg.rememberToolUsage) {
              callCodes.push(
                await encodeToolCall({
                  call: { id: toolUse.id, name: toolUse.name, arg: input },
                  response: toolResponse,
                }),
              )
            }
          }

          body.messages.push({ role: 'assistant', content: assistantContent })
          body.messages.push({ role: 'user', content: toolResultContent })
          if (!db.simplifiedToolUse && (text || thinking)) {
            const current = thinking ? `<Thoughts>\n${thinking}\n</Thoughts>\n\n${text}` : text
            prefix = [prefix, current].filter(Boolean).join('\n\n')
          }
          if (callCodes.length) prefix = [prefix, callCodes.join('\n\n')].filter(Boolean).join('\n\n')
          controller.enqueue({ '0': prefix })
        }

        controller.error(new Error(language.errors.anthropicToolCallLimit))
      } catch (error) {
        controller.error(error)
      }
    },
  })

  return { type: 'streaming', result: stream }
}
