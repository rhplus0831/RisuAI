import { v4 } from 'uuid'
import { fetchNative, openURL } from '../../globalApi.svelte'
import { alertInput } from '../../alert'

export type MCPPrompt = {
  name: string // Unique identifier for the prompt
  description?: string // Human-readable description
  arguments?: {
    // Optional list of arguments
    name: string // Argument identifier
    description?: string // Argument description
    required?: boolean // Whether argument is required
  }[]
  url?: string
}

export type MCPTool = {
  name: string
  description: string
  inputSchema: any // JSON schema for input validation
  annotations?: any // Annotations for the tool, can be used for documentation or metadata
}

export type JsonRPC = {
  jsonrpc: '2.0'
  id: number | string
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

export type JsonPing = {
  jsonrpc: '2.0'
  id: string
  method: 'ping'
}

export type RPCRequestResult = {
  rpc: JsonRPC
  http: {
    status: number
    headers: Record<string, string>
  }
}

export type SseEventDetail = {
  mcpClientObjectId: string
  data: JsonRPC
}

export const MCP_SSE_DEDUP_ID_LIMIT = 1024
export const MCP_SSE_BUFFER_LIMIT_BYTES = 8 * 1024 * 1024
const MCP_SSE_BUFFER_LIMIT_ERROR_CODE = -32002
const MCP_SSE_STREAM_ERROR_ID = '__risu_mcp_sse_stream_error__'
const sseBufferByteCounter = new TextEncoder()

export class WindowedSseIdDedup {
  private readonly ids = new Set<string | number>()
  private readonly insertionOrder: (string | number)[] = []

  constructor(private readonly limit: number = MCP_SSE_DEDUP_ID_LIMIT) {}

  get size() {
    return this.ids.size
  }

  has(id: string | number) {
    return this.ids.has(id)
  }

  add(id: string | number) {
    if (this.ids.has(id)) {
      return false
    }
    this.ids.add(id)
    this.insertionOrder.push(id)

    while (this.insertionOrder.length > this.limit) {
      const oldest = this.insertionOrder.shift()
      if (oldest !== undefined) {
        this.ids.delete(oldest)
      }
    }
    return true
  }

  clear() {
    this.ids.clear()
    this.insertionOrder.length = 0
  }
}

const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 30000
const MCP_REQUEST_TIMEOUT_ERROR_CODE = -32001
const MCP_INTERNAL_ERROR_CODE = -32603

class MCPDeadlineError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`MCP request timed out after ${timeoutMs}ms`)
    this.name = 'MCPDeadlineError'
  }
}

class MCPSseBufferLimitError extends Error {
  constructor(
    public readonly limitBytes: number,
    public readonly bufferedBytes: number,
  ) {
    super(`MCP SSE stream exceeded ${limitBytes} bytes without an event delimiter (${bufferedBytes} bytes buffered)`)
    this.name = 'MCPSseBufferLimitError'
  }
}

type MCPRequestOptions = {
  notifications?: boolean
  initMethod?: 'init' | 'none'
  id?: string | number
  requestTimeoutMs?: number
  connectionRetryAttempted?: boolean
}

type MCPFetchOptions = {
  body?: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  signal?: AbortSignal
  requestTimeoutMs?: number
}

export type MCPRefreshTokenSource =
  | {
      source: 'stored'
    }
  | {
      source: 'provided'
      clientId: string
      clientSecret: string
      refreshToken: string
      tokenUrl: string
    }

type ActiveOAuthAttempt = {
  controller: AbortController
  promise: Promise<void>
}

type MCPCustomTransportMessageListener = (message: JsonRPC) => void | Promise<void>
type MCPCustomTransportCloseListener = (reason?: unknown) => void
type MCPCustomTransportErrorListener = (error: unknown) => void

export type MCPCustomTransport = {
  send: (message: JsonRPC) => void | Promise<void>
  addListener: (callback: MCPCustomTransportMessageListener) => void
  removeListener: (callback: MCPCustomTransportMessageListener) => void
  addCloseListener?: (callback: MCPCustomTransportCloseListener) => void
  removeCloseListener?: (callback: MCPCustomTransportCloseListener) => void
  addErrorListener?: (callback: MCPCustomTransportErrorListener) => void
  removeErrorListener?: (callback: MCPCustomTransportErrorListener) => void
}

export type RPCToolCallTextContent = {
  type: 'text'
  text: string
}

export type RPCToolCallImageAudioContent = {
  type: 'image' | 'audio'
  data: string // Base64 encoded image
  mimeType: string // e.g. 'image/png', 'image/jpeg'
}

export type RPCToolCallContentResource = {
  type: 'resource'
  resource: {
    uri: string
    mimeType: string
    text: string
  }
}

export type RPCToolCallContent = RPCToolCallTextContent | RPCToolCallImageAudioContent | RPCToolCallContentResource

export abstract class MCPToolHandler {
  abstract getTools(): MCPTool[]
  abstract handle(toolName: string, args: any): Promise<RPCToolCallContent[] | null>
}

export class MCPClient {
  mcpClientObjectId: string = v4()
  sessionId: string | null = null
  initialized: boolean = false
  debug: boolean = false
  requestTimeoutMs: number = DEFAULT_MCP_REQUEST_TIMEOUT_MS
  sseBufferLimitBytes: number = MCP_SSE_BUFFER_LIMIT_BYTES
  url: string
  sseEndpoint: string
  accessToken: string | null = null
  sseResponses: Record<string, JsonRPC> = {}
  sseIdDone = new WindowedSseIdDedup()
  protocolVersion: '2025-03-26' | '2024-11-05' = '2025-03-26'
  sses: {
    stream: ReadableStream
    abortController?: AbortController
  }[] = []
  customTransport?: MCPCustomTransport
  private pendingCustomTransportRequests = new Set<(error: Error) => void>()
  private activeOAuthAttempt: ActiveOAuthAttempt | null = null
  onDestroy: (() => void) | null = null
  serverInfo: {
    protocolVersion: string
    capabilities: {
      [key: string]: any
    }
    serverInfo: {
      name: string
      version: string
    }
    instructions?: string
  }
  cached: {
    prompts?: MCPPrompt[]
    tools?: MCPTool[]
  } = {
    prompts: [],
    tools: [],
  }
  registerRefreshToken:
    | ((arg: { clientId: string; clientSecret: string; refreshToken: string; tokenUrl: string }) => void)
    | null = null

  getRefreshToken: (() => Promise<MCPRefreshTokenSource | null>) | null = null
  refreshStoredAccessToken: ((signal: AbortSignal) => Promise<string>) | null = null

  constructor(
    url: string,
    arg: {
      accessToken?: string
      debug?: boolean
      requestTimeoutMs?: number
      sseBufferLimitBytes?: number
    } = {},
  ) {
    this.url = url
    this.debug = arg.debug === true
    this.requestTimeoutMs = this.normalizeTimeoutMs(arg.requestTimeoutMs)
    this.sseBufferLimitBytes = this.normalizeBufferLimitBytes(arg.sseBufferLimitBytes)
    if (arg.accessToken) {
      this.accessToken = arg.accessToken
    }
  }

  private normalizeTimeoutMs(timeoutMs?: number) {
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      return Math.max(1, Math.floor(timeoutMs))
    }
    return DEFAULT_MCP_REQUEST_TIMEOUT_MS
  }

  private resolveTimeoutMs(options?: Pick<MCPRequestOptions, 'requestTimeoutMs'>) {
    return this.normalizeTimeoutMs(options?.requestTimeoutMs ?? this.requestTimeoutMs)
  }

  private normalizeBufferLimitBytes(limitBytes?: number) {
    if (Number.isFinite(limitBytes) && limitBytes > 0) {
      return Math.max(1, Math.floor(limitBytes))
    }
    return MCP_SSE_BUFFER_LIMIT_BYTES
  }

  private createRpcErrorResult(
    id: string | number | undefined,
    message: string,
    {
      code = MCP_INTERNAL_ERROR_CODE,
      status = 500,
      headers = {},
      data,
    }: {
      code?: number
      status?: number
      headers?: Record<string, string>
      data?: any
    } = {},
  ): RPCRequestResult {
    return {
      rpc: {
        jsonrpc: '2.0',
        id: id ?? '',
        error: {
          code,
          message,
          ...(data !== undefined ? { data } : {}),
        },
      },
      http: {
        status,
        headers,
      },
    }
  }

  private createTimeoutResult(
    id: string | number | undefined,
    timeoutMs: number,
    data?: any,
    http?: Partial<RPCRequestResult['http']>,
  ) {
    return this.createRpcErrorResult(id, `MCP request timed out after ${timeoutMs}ms`, {
      code: MCP_REQUEST_TIMEOUT_ERROR_CODE,
      status: http?.status ?? 408,
      headers: http?.headers ?? {},
      data,
    })
  }

  private normalizeCustomTransportError(reason: unknown, fallbackMessage: string): Error {
    if (reason instanceof Error) return reason
    if (reason === undefined || reason === null || reason === '') return new Error(fallbackMessage)
    return new Error(`${fallbackMessage}: ${String(reason)}`)
  }

  private requestWithCustomTransport(
    transport: MCPCustomTransport,
    body: JsonRPC,
    notifications: boolean,
    timeoutMs: number,
  ): Promise<RPCRequestResult> {
    return new Promise<RPCRequestResult>((resolve, reject) => {
      let settled = false
      let messageListenerAdded = false
      let closeListenerAdded = false
      let errorListenerAdded = false
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      const safelyRemove = (remove: (() => void) | undefined) => {
        try {
          remove?.()
        } catch {
          // Settlement must not be blocked by a transport cleanup failure.
        }
      }

      const cleanup = () => {
        if (messageListenerAdded) {
          safelyRemove(() => transport.removeListener(messageListener))
          messageListenerAdded = false
        }
        if (closeListenerAdded) {
          safelyRemove(() => transport.removeCloseListener?.(closeListener))
          closeListenerAdded = false
        }
        if (errorListenerAdded) {
          safelyRemove(() => transport.removeErrorListener?.(errorListener))
          errorListenerAdded = false
        }
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
        this.pendingCustomTransportRequests.delete(rejectPendingRequest)
      }

      const resolveRequest = (result: RPCRequestResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      const rejectRequest = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const rejectPendingRequest = (error: Error) => {
        rejectRequest(error)
      }

      const messageListener: MCPCustomTransportMessageListener = (message) => {
        if (settled || message.id !== body.id) return
        resolveRequest({
          rpc: message,
          http: {
            status: 200,
            headers: {},
          },
        })
      }

      const closeListener: MCPCustomTransportCloseListener = (reason) => {
        rejectRequest(this.normalizeCustomTransportError(reason, 'MCP custom transport closed'))
      }

      const errorListener: MCPCustomTransportErrorListener = (error) => {
        rejectRequest(this.normalizeCustomTransportError(error, 'MCP custom transport error'))
      }

      this.pendingCustomTransportRequests.add(rejectPendingRequest)
      timeoutId = setTimeout(() => {
        rejectRequest(new MCPDeadlineError(timeoutMs))
      }, timeoutMs)

      try {
        if (!notifications) {
          messageListenerAdded = true
          transport.addListener(messageListener)
          if (settled) return
        }
        if (transport.addCloseListener && transport.removeCloseListener) {
          closeListenerAdded = true
          transport.addCloseListener(closeListener)
          if (settled) return
        }
        if (transport.addErrorListener && transport.removeErrorListener) {
          errorListenerAdded = true
          transport.addErrorListener(errorListener)
          if (settled) return
        }

        const sendResult = transport.send(body)
        void Promise.resolve(sendResult).then(
          () => {
            if (!notifications) return
            resolveRequest({
              rpc: {
                jsonrpc: '2.0',
                id: body.id ?? '',
                result: null,
              },
              http: {
                status: 200,
                headers: {},
              },
            })
          },
          (error) => {
            rejectRequest(this.normalizeCustomTransportError(error, 'MCP custom transport send failed'))
          },
        )
      } catch (error) {
        rejectRequest(this.normalizeCustomTransportError(error, 'MCP custom transport send failed'))
      }
    })
  }

  private dispatchSseStreamError(error: MCPSseBufferLimitError) {
    const detail: SseEventDetail = {
      mcpClientObjectId: this.mcpClientObjectId,
      data: {
        jsonrpc: '2.0',
        id: MCP_SSE_STREAM_ERROR_ID,
        error: {
          code: MCP_SSE_BUFFER_LIMIT_ERROR_CODE,
          message: error.message,
          data: {
            limitBytes: error.limitBytes,
            bufferedBytes: error.bufferedBytes,
          },
        },
      },
    }
    document.dispatchEvent(
      new CustomEvent('mcp-sse', {
        detail,
      }),
    )
  }

  private async fetchNativeWithDeadline(
    url: string,
    requestParams: MCPFetchOptions,
    timeoutMs: number,
    abortController: AbortController,
  ) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        abortController.abort()
        reject(new MCPDeadlineError(timeoutMs))
      }, timeoutMs)
    })

    try {
      return (await Promise.race([
        fetchNative(url, {
          ...requestParams,
          signal: abortController.signal,
          requestTimeoutMs: timeoutMs,
        }),
        timeoutPromise,
      ])) as Response
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }

  private waitForSseResponse(
    id: string | number | undefined,
    {
      timeoutMs,
      signal,
      http,
      timeoutData,
      onTimeout,
    }: {
      timeoutMs: number
      signal?: AbortSignal
      http: RPCRequestResult['http']
      timeoutData?: any
      onTimeout?: () => void
    },
  ): Promise<RPCRequestResult> {
    return new Promise<RPCRequestResult>((resolve) => {
      let settled = false
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        document.removeEventListener('mcp-sse', sseListener)
        signal?.removeEventListener('abort', abortListener)
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId)
        }
      }

      const settle = (result: RPCRequestResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      const abortListener = () => {
        settle(
          this.createRpcErrorResult(id, 'MCP request aborted before SSE response', {
            code: MCP_REQUEST_TIMEOUT_ERROR_CODE,
            status: 408,
            headers: http.headers,
            data: timeoutData,
          }),
        )
      }

      const sseListener = (event: Event) => {
        try {
          const detail = (event as CustomEvent<SseEventDetail>).detail
          if (detail?.mcpClientObjectId !== this.mcpClientObjectId) return
          const data = detail.data
          if (data?.id === MCP_SSE_STREAM_ERROR_ID && data.error) {
            settle(
              this.createRpcErrorResult(id, data.error.message, {
                code: data.error.code,
                status: 502,
                headers: http.headers,
                data: data.error.data,
              }),
            )
            return
          }
          if (data?.id !== id) return

          settle({
            rpc: data,
            http,
          })
        } catch (error) {
          settle(
            this.createRpcErrorResult(id, 'MCP SSE response listener failed', {
              status: 500,
              headers: http.headers,
              data: {
                error: String(error),
              },
            }),
          )
        }
      }

      document.addEventListener('mcp-sse', sseListener)

      if (signal?.aborted) {
        abortListener()
        return
      }

      signal?.addEventListener('abort', abortListener, { once: true })
      timeoutId = setTimeout(() => {
        settle(this.createTimeoutResult(id, timeoutMs, timeoutData, http))
        onTimeout?.()
      }, timeoutMs)
    })
  }

  async connectSSE(stream: ReadableStream, abortController?: AbortController) {
    const reader = stream.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    const sse = {
      stream: stream,
      abortController: abortController,
    }
    this.sses.push(sse)

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        let parts = buffer.split('\n\n')
        buffer = parts.pop() || ''
        const bufferedBytes = sseBufferByteCounter.encode(buffer).byteLength
        if (bufferedBytes > this.sseBufferLimitBytes) {
          throw new MCPSseBufferLimitError(this.sseBufferLimitBytes, bufferedBytes)
        }

        for (const part of parts) {
          let lines = part.split('\n')
          let data = ''
          let eventName = ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              data += line.slice(6) + '\n'
            } else if (line.startsWith('event: ')) {
              eventName = line.slice(7).trim()
            }
          }

          data = data.trim()
          if (data) {
            if (this.debug) {
              console.log('MCP SSE Data', {
                eventName: eventName,
                data: data,
              })
            }

            if (eventName === 'endpoint') {
              const sseEventDetail: SseEventDetail = {
                mcpClientObjectId: this.mcpClientObjectId,
                data: {
                  jsonrpc: '2.0',
                  id: 'connected',
                  result: {
                    endpoint: data,
                  },
                },
              }
              document.dispatchEvent(
                new CustomEvent('mcp-sse', {
                  detail: sseEventDetail,
                }),
              )
            } else {
              try {
                const jsonData = JSON.parse(data) as JsonRPC | JsonPing
                if (this.sseIdDone.has(jsonData.id)) {
                  continue
                }

                //@ts-expect-error JsonRPC type doesn't have method property, but JsonPing does
                if (jsonData.method === 'ping') {
                  await this.request(
                    'response',
                    {},
                    {
                      notifications: true,
                      initMethod: 'none',
                      id: jsonData.id,
                    },
                  )
                  this.sseIdDone.add(jsonData.id)
                  continue
                }

                const sseEventDetail: SseEventDetail = {
                  mcpClientObjectId: this.mcpClientObjectId,
                  data: jsonData,
                }
                document.dispatchEvent(
                  new CustomEvent('mcp-sse', {
                    detail: sseEventDetail,
                  }),
                )
                this.sseIdDone.add(jsonData.id)
              } catch (error) {}
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof MCPSseBufferLimitError) {
        this.dispatchSseStreamError(error)
        if (!abortController?.signal.aborted) {
          abortController?.abort()
        }
        try {
          await reader.cancel(error)
        } catch {
          // stream may already be closed by the underlying transport
        }
        this.destroy()
        if (this.debug) {
          console.warn('MCP SSE stream buffer limit exceeded', error)
        }
      } else if (this.debug && !abortController?.signal.aborted) {
        console.warn('MCP SSE stream failed', error)
      }
    } finally {
      reader.releaseLock()
      const index = this.sses.indexOf(sse)
      if (index >= 0) {
        this.sses.splice(index, 1)
      }
    }
  }

  async request(method: string, params?: any, options: MCPRequestOptions = {}): Promise<RPCRequestResult> {
    options ??= {}
    const initMethod = options.initMethod || 'none'
    const timeoutMs = this.resolveTimeoutMs(options)
    const url = this.sseEndpoint ?? this.url

    const body =
      method === 'response'
        ? {
            jsonrpc: '2.0',
            id: options?.id ?? v4(),
            result: params,
          }
        : {
            jsonrpc: '2.0',
            id: options?.id ?? v4(),
            method: method,
            params: params,
          }

    if (method !== 'response') {
      if (options.notifications) {
        delete body.params
        delete body.id
      } else if (!params) {
        delete body.params
      }
    }

    if (this.customTransport) {
      return this.requestWithCustomTransport(
        this.customTransport,
        body as JsonRPC,
        options.notifications === true,
        timeoutMs,
      )
    }

    try {
      const headers: Record<string, string> = !this.sseEndpoint
        ? {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          }
        : {
            'Content-Type': 'application/json',
            Accept: '*/*',
          }

      if (this.sessionId) {
        headers['Mcp-Session-Id'] = this.sessionId
      }

      if (this.accessToken) {
        headers['Authorization'] = `Bearer ${this.accessToken}`
      }

      const abortController = new AbortController()
      const requestParams = {
        body: JSON.stringify(body),
        method: 'POST',
        headers: headers,
        signal: abortController.signal,
        requestTimeoutMs: timeoutMs,
      } satisfies MCPFetchOptions

      let responsePromise: Promise<RPCRequestResult> | null = null
      if (this.sseEndpoint && !options.notifications) {
        responsePromise = this.waitForSseResponse(body.id, {
          timeoutMs,
          signal: abortController.signal,
          http: {
            status: 200,
            headers: {},
          },
          timeoutData: {
            method: method,
            params: params,
          },
          onTimeout: () => abortController.abort(),
        })
      }

      let response: Response
      try {
        response = await this.fetchNativeWithDeadline(url, requestParams, timeoutMs, abortController)
      } catch (error) {
        if (!abortController.signal.aborted) {
          abortController.abort()
        }

        if (error instanceof MCPDeadlineError || error?.['name'] === 'AbortError') {
          return this.createTimeoutResult(body.id, timeoutMs, {
            method: method,
            params: params,
          })
        }

        return this.createRpcErrorResult(body.id, 'Internal Error', {
          status: 500,
          data: {
            method: method,
            params: params,
          },
        })
      }

      const shouldRestoreSession =
        !options.notifications &&
        !options.connectionRetryAttempted &&
        initMethod !== 'init' &&
        !!this.sessionId &&
        response.status === 404
      const shouldRestoreAccessToken =
        !options.notifications &&
        !options.connectionRetryAttempted &&
        initMethod !== 'init' &&
        !!this.accessToken &&
        response.status === 401

      if (shouldRestoreSession || shouldRestoreAccessToken) {
        if (!abortController.signal.aborted) abortController.abort()
        if (responsePromise) await responsePromise
        await response.body?.cancel().catch(() => undefined)
        await this.restoreRejectedConnection(shouldRestoreAccessToken)
        return this.request(method, params, {
          ...options,
          connectionRetryAttempted: true,
        })
      }

      if (this.sseEndpoint && options.notifications) {
        return {
          rpc: {
            jsonrpc: '2.0',
            id: body.id,
            result: null, // No result for notifications
          },
          http: {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
          },
        }
      }

      if (response.status > 299 && responsePromise) {
        //invoke error handler
        const details: SseEventDetail = {
          mcpClientObjectId: this.mcpClientObjectId,
          data: {
            jsonrpc: '2.0',
            id: body.id,
            error: {
              code: response.status,
              message: response.statusText,
              data: {
                method: method,
                params: params,
              },
            },
          },
        }

        document.dispatchEvent(
          new CustomEvent('mcp-sse', {
            detail: details,
          }),
        )
      }

      if (responsePromise) {
        return responsePromise
      }

      const contentType = response.headers.get('Content-Type') || ''

      if (contentType.includes('text/event-stream')) {
        if (!response.body) {
          return this.createRpcErrorResult(body.id, 'Missing SSE response body', {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
          })
        }

        void this.connectSSE(response.body, abortController)

        return this.waitForSseResponse(body.id, {
          timeoutMs,
          signal: abortController.signal,
          http: {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
          },
          timeoutData: {
            method: method,
            params: params,
          },
          onTimeout: () => abortController.abort(),
        })
      }

      if (!contentType.includes('application/json')) {
        return {
          rpc: {
            jsonrpc: '2.0',
            id: body.id,
            error: {
              code: -32603,
              message: 'Invalid Content-Type',
              data: {
                contentType: contentType,
              },
            },
          },
          http: {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
          },
        }
      }

      if (response.headers.has('Mcp-Session-Id') && initMethod !== 'none') {
        this.sessionId = response.headers.get('Mcp-Session-Id')
      }
      return {
        rpc: await response.json(),
        http: {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        },
      }
    } catch (error) {
      if (error instanceof MCPDeadlineError || error?.['name'] === 'AbortError') {
        return this.createTimeoutResult(body.id, timeoutMs, {
          method: method,
          params: params,
        })
      }

      return this.createRpcErrorResult(body.id, 'Internal Error')
    }
  }

  async getCapabilities() {
    await this.checkHandshake()
    return this.serverInfo?.capabilities || {}
  }

  async loadPrompt(mcpPrompt: MCPPrompt) {
    await this.checkHandshake()
    const d = await this.request('prompts/get', {
      name: mcpPrompt.name,
    })

    return d
  }

  checkHandshake() {
    if (this.initialized) {
      return this.serverInfo
    } else {
      return this.handshake()
    }
  }

  async handshake() {
    if (this.debug) {
      console.log('MCP Handshake', this.url, this.mcpClientObjectId)
    }
    let didOAuthRetry = false

    while (true) {
      const { rpc: d, http } = await this.performHandshakeAttempt()

      if (http.status === 401) {
        if (didOAuthRetry) {
          this.destroy()
          throw new Error('MCP authentication failed after OAuth retry')
        }
        didOAuthRetry = true
        this.resetSseTransport()
        await this.oauthLogin()
        continue
      }

      if (d?.error?.code === MCP_REQUEST_TIMEOUT_ERROR_CODE) {
        throw new Error(d.error.message)
      }

      if (!d?.result?.serverInfo) {
        throw new Error('MCP Handshake Failed')
      }

      this.serverInfo = d.result
      await this.request('notifications/initialized', null, {
        notifications: true,
      })

      if (d.result.protocolVersion !== '2025-03-26' && d.result.protocolVersion !== '2024-11-05') {
        console.warn('MCP Server is using an unsupported protocol version', d.result.protocolVersion)
      } else {
        this.protocolVersion = d.result.protocolVersion
      }

      if (this.debug) {
        console.log('MCP Handshake Successful', this.serverInfo, this.mcpClientObjectId)
      }
      this.initialized = true
      return this.serverInfo
    }
  }

  private async performHandshakeAttempt(): Promise<RPCRequestResult> {
    this.protocolVersion = '2025-03-26'
    let result = await this.request(
      'initialize',
      {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: {
          name: 'RS-MCP-CLIENT',
          version: '1.0.0',
        },
      },
      { initMethod: 'init' },
    )

    if (result.http.status !== 404) return result

    console.warn('MCP: Streamed transport not supported, falling back to SSE')
    this.protocolVersion = '2024-11-05'
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`

    const timeoutMs = this.resolveTimeoutMs()
    const connectionAbortController = new AbortController()
    let connection: Response
    try {
      connection = await this.fetchNativeWithDeadline(
        this.url,
        {
          method: 'GET',
          headers,
          signal: connectionAbortController.signal,
          requestTimeoutMs: timeoutMs,
        },
        timeoutMs,
        connectionAbortController,
      )
    } catch (error) {
      connectionAbortController.abort()
      if (error instanceof MCPDeadlineError || error?.['name'] === 'AbortError') {
        throw new Error(`MCP handshake timed out after ${timeoutMs}ms`)
      }
      throw error
    }

    if (connection.status === 401) {
      await connection.body?.cancel().catch(() => undefined)
      return {
        rpc: {
          jsonrpc: '2.0',
          id: '',
          error: { code: 401, message: 'Unauthorized' },
        },
        http: {
          status: 401,
          headers: Object.fromEntries(connection.headers.entries()),
        },
      }
    }
    if (connection.status !== 200) {
      throw new Error(`Failed to connect to MCP server: ${connection.status} ${connection.statusText}`)
    }
    if (!connection.body) {
      throw new Error('Failed to connect to MCP server: missing SSE body')
    }

    void this.connectSSE(connection.body, connectionAbortController)
    const connectionResult = await this.waitForSseResponse('connected', {
      timeoutMs,
      signal: connectionAbortController.signal,
      http: {
        status: connection.status,
        headers: Object.fromEntries(connection.headers.entries()),
      },
      timeoutData: { method: 'GET', endpoint: this.url },
      onTimeout: () => connectionAbortController.abort(),
    })
    if (connectionResult.rpc.error) {
      connectionAbortController.abort()
      throw new Error(connectionResult.rpc.error.message)
    }

    const endpoint = connectionResult.rpc.result.endpoint
    if (!endpoint) throw new Error('Failed to get endpoint from MCP server')
    this.sseEndpoint = `${new URL(this.url).origin}${endpoint}`
    result = await this.request(
      'initialize',
      {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: {
          name: 'RS-MCP-CLIENT',
          version: '1.0.0',
        },
      },
      { initMethod: 'init' },
    )
    return result
  }

  private resetSseTransport(): void {
    this.sessionId = null
    this.sseEndpoint = null
    this.sseResponses = {}
    for (const sse of this.sses) sse.abortController?.abort()
    this.sseIdDone.clear()
    this.sses = []
  }

  private async restoreRejectedConnection(clearAccessToken: boolean): Promise<void> {
    this.initialized = false
    if (clearAccessToken) this.accessToken = null
    this.resetSseTransport()
    await this.handshake()
  }

  oauthLogin(): Promise<void> {
    if (this.activeOAuthAttempt) return this.activeOAuthAttempt.promise

    const attempt: ActiveOAuthAttempt = {
      controller: new AbortController(),
      promise: Promise.resolve(),
    }
    this.activeOAuthAttempt = attempt
    attempt.promise = this.oauthLoginInner(attempt).finally(() => {
      if (this.activeOAuthAttempt === attempt) this.activeOAuthAttempt = null
    })
    return attempt.promise
  }

  private async oauthLoginInner(attempt: ActiveOAuthAttempt): Promise<void> {
    let refreshSource: MCPRefreshTokenSource | null = null
    if (this.getRefreshToken) {
      try {
        refreshSource = await this.awaitOAuthStep(this.getRefreshToken(), attempt)
      } catch (error) {
        this.rethrowOAuthCancellation(error, attempt)
      }
    }

    if (refreshSource?.source === 'stored' && this.refreshStoredAccessToken) {
      try {
        const accessToken = await this.awaitOAuthStep(this.refreshStoredAccessToken(attempt.controller.signal), attempt)
        if (this.isValidOAuthAccessToken(accessToken)) {
          this.assertOAuthAttemptActive(attempt)
          this.accessToken = accessToken
          return
        }
      } catch (error) {
        this.rethrowOAuthCancellation(error, attempt)
      }
    } else if (refreshSource?.source === 'provided' && this.isValidProvidedRefreshSource(refreshSource)) {
      try {
        const tokenResponse = await this.awaitOAuthStep(
          fetchNative(refreshSource.tokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshSource.refreshToken,
              client_id: refreshSource.clientId,
              client_secret: refreshSource.clientSecret,
            }).toString(),
            signal: attempt.controller.signal,
            requestTimeoutMs: this.requestTimeoutMs,
            sensitive: true,
          }),
          attempt,
        )
        if (tokenResponse.ok) {
          const tokenData: unknown = await this.awaitOAuthStep(tokenResponse.json(), attempt)
          const accessToken = this.readOAuthAccessToken(tokenData)
          if (accessToken) {
            const rotatedRefreshToken = this.readOAuthRefreshToken(tokenData)
            if (rotatedRefreshToken && this.registerRefreshToken) {
              this.assertOAuthAttemptActive(attempt)
              this.registerRefreshToken({
                clientId: refreshSource.clientId,
                clientSecret: refreshSource.clientSecret,
                refreshToken: rotatedRefreshToken,
                tokenUrl: refreshSource.tokenUrl,
              })
            }
            this.assertOAuthAttemptActive(attempt)
            this.accessToken = accessToken
            return
          }
        }
      } catch (error) {
        this.rethrowOAuthCancellation(error, attempt)
      }
    }

    const OauthDiscovery = new URL(this.url)
    OauthDiscovery.pathname = '/.well-known/oauth-authorization-server'
    const oauthResponse = await this.awaitOAuthStep(
      fetchNative(OauthDiscovery.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: attempt.controller.signal,
        requestTimeoutMs: this.requestTimeoutMs,
      }),
      attempt,
    )

    let discoveryURLS = {
      authorization_endpoint: OauthDiscovery.origin + '/authorize',
      token_endpoint: OauthDiscovery.origin + '/token',
      registration_endpoint: OauthDiscovery.origin + '/register',
    }
    if (oauthResponse.status === 200) {
      discoveryURLS = await this.awaitOAuthStep(oauthResponse.json(), attempt)
    }

    const redirectURL = 'https://account.sionyw.com/oauthhelper'
    const registerResponse = await this.awaitOAuthStep(
      fetchNative(discoveryURLS.registration_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_name: 'RS-MCP-CLIENT',
          redirect_uris: [redirectURL],
          response_types: ['code'],
          grant_types: ['authorization_code'],
          token_endpoint_auth_method: 'client_secret_basic',
        }),
        signal: attempt.controller.signal,
        requestTimeoutMs: this.requestTimeoutMs,
      }),
      attempt,
    )
    if (registerResponse.status !== 201) {
      throw new Error('Failed to register client with OAuth server')
    }

    const clientData = await this.awaitOAuthStep(registerResponse.json(), attempt)
    const code_verifier = (v4() + v4()).replace(/-/g, '')
    const sha256 = await this.awaitOAuthStep(
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(code_verifier)),
      attempt,
    )
    const code_challenge = Buffer.from(sha256)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    const authUrl = new URL(discoveryURLS.authorization_endpoint)
    authUrl.searchParams.set('client_id', clientData.client_id)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', redirectURL)
    authUrl.searchParams.set('scope', '')
    authUrl.searchParams.set('state', v4())
    authUrl.searchParams.set('code_challenge', code_challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')

    this.assertOAuthAttemptActive(attempt)
    openURL(authUrl.toString())
    const code = await this.awaitOAuthStep(alertInput('Input Authorization Code'), attempt)

    const authHelperResponse = await this.awaitOAuthStep(
      fetchNative('https://account.sionyw.com/oauthhelper/api', {
        method: 'POST',
        body: JSON.stringify({ code }),
        headers: { Accept: 'application/json' },
        signal: attempt.controller.signal,
        requestTimeoutMs: this.requestTimeoutMs,
        sensitive: true,
      }),
      attempt,
    )
    const authHelperResponseJson = await this.awaitOAuthStep(authHelperResponse.json(), attempt)
    if (authHelperResponseJson.success !== true) {
      throw new Error('Failed to get authorization code from helper')
    }

    const payload = authHelperResponseJson.payload
    const tokenResponse = await this.awaitOAuthStep(
      fetchNative(discoveryURLS.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: payload.code || '',
          redirect_uri: redirectURL,
          client_id: clientData.client_id,
          client_secret: clientData.client_secret,
          code_verifier,
        }).toString(),
        signal: attempt.controller.signal,
        requestTimeoutMs: this.requestTimeoutMs,
        sensitive: true,
      }),
      attempt,
    )
    if (tokenResponse.status !== 200) {
      throw new Error('Failed to exchange authorization code for access token')
    }

    const tokenData = await this.awaitOAuthStep(tokenResponse.json(), attempt)
    const accessToken = this.readOAuthAccessToken(tokenData)
    const refreshToken = this.readOAuthRefreshToken(tokenData)
    if (!accessToken) throw new Error('OAuth token response was malformed')

    if (refreshToken && this.registerRefreshToken) {
      this.assertOAuthAttemptActive(attempt)
      this.registerRefreshToken({
        clientId: clientData.client_id,
        clientSecret: clientData.client_secret,
        refreshToken,
        tokenUrl: discoveryURLS.token_endpoint,
      })
    }
    this.assertOAuthAttemptActive(attempt)
    this.accessToken = accessToken
  }

  private async awaitOAuthStep<T>(step: Promise<T>, attempt: ActiveOAuthAttempt): Promise<T> {
    this.assertOAuthAttemptActive(attempt)
    const signal = attempt.controller.signal
    const value = await new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(this.oauthAbortReason(signal))
      signal.addEventListener('abort', onAbort, { once: true })
      void step.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
    this.assertOAuthAttemptActive(attempt)
    return value
  }

  private assertOAuthAttemptActive(attempt: ActiveOAuthAttempt): void {
    if (this.activeOAuthAttempt === attempt && !attempt.controller.signal.aborted) return
    throw this.oauthAbortReason(attempt.controller.signal)
  }

  private oauthAbortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new DOMException('MCP OAuth cancelled', 'AbortError')
  }

  private rethrowOAuthCancellation(error: unknown, attempt: ActiveOAuthAttempt): void {
    if (attempt.controller.signal.aborted || this.activeOAuthAttempt !== attempt) {
      this.assertOAuthAttemptActive(attempt)
    }
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof Error && error.name === 'AbortError') throw error
  }

  private isValidProvidedRefreshSource(source: Extract<MCPRefreshTokenSource, { source: 'provided' }>): boolean {
    return (
      typeof source.tokenUrl === 'string' &&
      source.tokenUrl.trim().length > 0 &&
      typeof source.clientId === 'string' &&
      source.clientId.trim().length > 0 &&
      typeof source.clientSecret === 'string' &&
      typeof source.refreshToken === 'string' &&
      source.refreshToken.trim().length > 0
    )
  }

  private isValidOAuthAccessToken(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 64 * 1024
  }

  private readOAuthAccessToken(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const accessToken = (value as Record<string, unknown>).access_token
    return this.isValidOAuthAccessToken(accessToken) ? accessToken : null
  }

  private readOAuthRefreshToken(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const refreshToken = (value as Record<string, unknown>).refresh_token
    return typeof refreshToken === 'string' && refreshToken.trim().length > 0 && refreshToken.length <= 64 * 1024
      ? refreshToken
      : null
  }

  async getPromptList(): Promise<MCPPrompt[]> {
    await this.checkHandshake()
    if (!this.serverInfo.capabilities?.prompts) {
      return []
    }
    if (this.cached.prompts.length > 0) {
      return this.cached.prompts
    }
    let prompts: MCPPrompt[] = []
    let cursor: string | null = null
    while (true) {
      const args = {
        cursor: cursor,
      } as Record<string, any>

      if (!args.cursor) {
        delete args.cursor
      }

      const response = await this.request('prompts/list', args)
      if (response.rpc.result?.prompts) {
        prompts.push(...response.rpc.result.prompts)
        if (response.rpc.result.nextCursor) {
          cursor = response.rpc.result.nextCursor
        } else {
          break
        }
      } else {
        break
      }
    }

    this.cached.prompts = prompts

    return prompts
  }

  async getToolList(): Promise<MCPTool[]> {
    await this.checkHandshake()
    if (!this.serverInfo.capabilities?.tools) {
      return []
    }
    if (this.cached.tools.length > 0) {
      return this.cached.tools
    }
    let tools: MCPTool[] = []
    let cursor: string | null = null
    while (true) {
      const args = {
        cursor: cursor,
      } as Record<string, any>

      if (!args.cursor) {
        delete args.cursor
      }

      const response = await this.request('tools/list', args)
      if (this.debug) {
        console.log('MCP Tools List Response', response)
      }
      if (response.rpc.result?.tools) {
        tools.push(...response.rpc.result.tools)
        if (response.rpc.result.nextCursor) {
          cursor = response.rpc.result.nextCursor
        } else {
          break
        }
      } else {
        break
      }
    }

    this.cached.tools = tools

    return tools
  }

  async callTool(toolName: string, args: any): Promise<RPCToolCallContent[]> {
    await this.checkHandshake()
    if (!this.serverInfo.capabilities?.tools) {
      throw new Error('MCP Server does not support tools')
    }

    const response = await this.request('tools/call', {
      name: toolName,
      arguments: args,
    })

    if (response.rpc.error) {
      return [
        {
          type: 'text',
          text: `Error calling ${toolName}: ${JSON.stringify(response.rpc.error)}`,
        },
      ]
    }

    return response.rpc?.result?.content
  }

  destroy() {
    const oauthAttempt = this.activeOAuthAttempt
    this.activeOAuthAttempt = null
    oauthAttempt?.controller.abort(new DOMException('MCP client destroyed', 'AbortError'))
    this.initialized = false
    this.accessToken = null
    this.resetSseTransport()
    const closeError = new Error('MCP custom transport closed')
    for (const rejectPendingRequest of Array.from(this.pendingCustomTransportRequests)) {
      rejectPendingRequest(closeError)
    }
    this.onDestroy?.()
  }

  ping() {
    return this.request('ping')
  }
}
