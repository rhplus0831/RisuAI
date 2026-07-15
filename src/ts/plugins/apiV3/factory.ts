type MsgType =
  | 'CALL_ROOT'
  | 'CALL_INSTANCE'
  | 'INVOKE_CALLBACK'
  | 'CALLBACK_RETURN'
  | 'RESPONSE'
  | 'RELEASE_INSTANCE'
  | 'ABORT_SIGNAL'

interface RpcMessage {
  type: MsgType
  reqId?: string
  id?: string
  method?: string
  args?: any[]
  result?: any
  error?: string
  abortId?: string
}

interface RemoteRef {
  __type: 'REMOTE_REF'
  id: string
}

interface CallbackRef {
  __type: 'CALLBACK_REF'
  id: string
}

interface AbortSignalRef {
  __type: 'ABORT_SIGNAL_REF'
  abortId: string
  aborted: boolean
}

interface PendingCallback {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  cleanup: () => void
}

interface PendingExecution {
  handler: (event: MessageEvent) => void
  reject: (reason?: unknown) => void
}

const SANDBOX_TERMINATED_MESSAGE = 'Sandbox host terminated'

const GUEST_BRIDGE_SCRIPT = `
await (async function() {
    const pendingRequests = new Map();
    const callbackRegistry = new Map();
    const callbackIdByFunction = new WeakMap();
    const proxyRefRegistry = new Map();
    const abortControllers = new Map();

    function serializeArg(arg) {
        if (typeof arg === 'function') {
            const existingId = callbackIdByFunction.get(arg);
            if (existingId) {
                return { __type: 'CALLBACK_REF', id: existingId };
            }
            const id = 'cb_' + Math.random().toString(36).substring(2);
            callbackRegistry.set(id, arg);
            callbackIdByFunction.set(arg, id);
            return { __type: 'CALLBACK_REF', id: id };
        }
        if (arg && typeof arg === 'object') {
            const refId = proxyRefRegistry.get(arg);
            if (refId) {
                return { __type: 'REMOTE_REF', id: refId };
            }
            if (arg.constructor === Object) {
                let out = null;
                for (const [key, val] of Object.entries(arg)) {
                    if (val instanceof AbortSignal) {
                        if (!out) out = { ...arg };
                        const abortId = 'abort_' + Math.random().toString(36).substring(2);

                        if (!val.aborted) {
                            val.addEventListener('abort', () => {
                                send({ type: 'ABORT_SIGNAL', abortId });
                            }, { once: true });
                        }

                        out[key] = { __type: 'ABORT_SIGNAL_REF', abortId, aborted: val.aborted };
                    }
                }
                if (out) return out;
            }
        }
        return arg;
    }

    function deserializeResult(val) {
        if (val && typeof val === 'object' && val.__type === 'REMOTE_REF') {
            const proxy = new Proxy({}, {
                get: (target, prop) => {
                    if (prop === 'then') return undefined;
                    if (prop === 'release') {
                        return () => send({ type: 'RELEASE_INSTANCE', id: val.id });
                    }
                    return (...args) => sendRequest('CALL_INSTANCE', {
                        id: val.id,
                        method: prop,
                        args: args
                    });
                }
            });
            // Store the mapping so we can serialize it back
            proxyRefRegistry.set(proxy, val.id);
            return proxy;
        }
        if (val && typeof val === 'object' && val.__type === 'CALLBACK_STREAMS') {
            //specialType, one of
            // - Response
            // - none
            const specialType = val.__specialType;
            if (specialType === 'Response') {
                return new Response(val.value, val.init);
            }
            return val.value;
        }
        return val;
    }

    function collectTransferables(obj, transferables = [], seenObjects = new Set(), seenTransferables = new Set()) {
        if (!obj || typeof obj !== 'object') return transferables;
        if (seenObjects.has(obj)) return transferables;
        seenObjects.add(obj);

        let transferable = null;
        if (obj instanceof ArrayBuffer ||
            (typeof MessagePort !== 'undefined' && obj instanceof MessagePort) ||
            (typeof ImageBitmap !== 'undefined' && obj instanceof ImageBitmap) ||
            (typeof ReadableStream !== 'undefined' && obj instanceof ReadableStream) ||
            (typeof WritableStream !== 'undefined' && obj instanceof WritableStream) ||
            (typeof TransformStream !== 'undefined' && obj instanceof TransformStream) ||
            (typeof OffscreenCanvas !== 'undefined' && obj instanceof OffscreenCanvas)) {
            transferable = obj;
        }
        else if (ArrayBuffer.isView(obj) && obj.buffer instanceof ArrayBuffer) {
            transferable = obj.buffer;
        }
        if (transferable) {
            if (!seenTransferables.has(transferable)) {
                seenTransferables.add(transferable);
                transferables.push(transferable);
            }
            return transferables;
        }
        if (Array.isArray(obj)) {
            obj.forEach(item => collectTransferables(item, transferables, seenObjects, seenTransferables));
        }
        else if (obj.constructor === Object) {
            Object.values(obj).forEach(value => collectTransferables(value, transferables, seenObjects, seenTransferables));
        }

        return transferables;
    }

    function send(payload, transferables = []) {
        window.parent.postMessage(payload, '*', transferables);
    }

    function sendRequest(type, payload) {
        return new Promise((resolve, reject) => {
            const reqId = Math.random().toString(36).substring(7);
            pendingRequests.set(reqId, { resolve, reject });


            if (payload.args) {
                payload.args = payload.args.map(serializeArg);
            }

            const message = { type: type, reqId: reqId, ...payload };
            const transferables = collectTransferables(message);
            send(message, transferables);
        });
    }

    
    
    
    window.addEventListener('message', async (event) => {
        const data = event.data;
        if (!data) return;


        if (data.type === 'RESPONSE' && data.reqId) {
            const req = pendingRequests.get(data.reqId);
            if (req) {
                if (data.error) req.reject(new Error(data.error));
                else req.resolve(deserializeResult(data.result));
                pendingRequests.delete(data.reqId);
            }
        }

        else if (data.type === 'EXECUTE_CODE' && data.reqId) {
            const response = { type: 'EXEC_RESULT', reqId: data.reqId };
            try {
                const result = await eval('(async () => {' + data.code + '})()');
                response.result = result;
            } catch (e) {
                response.error = e.message || String(e);
            }
            send(response);
        }

        else if (data.type === 'ABORT_SIGNAL' && data.abortId) {
            const controller = abortControllers.get(data.abortId);
            if (controller) {
                controller.abort();
                abortControllers.delete(data.abortId);
            }
        }

        else if (data.type === 'INVOKE_CALLBACK' && data.id) {
            const fn = callbackRegistry.get(data.id);
            const response = { type: 'CALLBACK_RETURN', reqId: data.reqId };
            const usedAbortIds = [];

            try {
                if (!fn) throw new Error("Callback not found or released");
                const deserializedArgs = (data.args || []).map(function(a) {
                    if (a && typeof a === 'object' && a.__type === 'ABORT_SIGNAL_REF') {
                        const controller = new AbortController();
                        abortControllers.set(a.abortId, controller);
                        usedAbortIds.push(a.abortId);
                        if (a.aborted) { controller.abort(); }
                        return controller.signal;
                    }
                    return a;
                });
                const result = await fn(...deserializedArgs);
                response.result = result;
            } catch (e) {
                response.error = e.message || "Guest callback error";
            }
            // Clean up abort controllers after callback completes
            for (const id of usedAbortIds) {
                abortControllers.delete(id);
            }
            const transferables = collectTransferables(response);
            send(response, transferables);
        }
    });





    const propertyCache = new Map();

    window.risuai = new Proxy({}, {
        get: (target, prop) => {
            if (propertyCache.has(prop)) {
                return propertyCache.get(prop);
            }
            return (...args) => sendRequest('CALL_ROOT', { method: prop, args: args });
        }
    });
    window.Risuai = window.risuai;

    try {
        // Initialize cached properties
        const propsToInit = await window.risuai._getPropertiesForInitialization();
        console.log('Initializing risuai properties:', JSON.stringify(propsToInit.list));
        for (let i = 0; i < propsToInit.list.length; i++) {
            const key = propsToInit.list[i];
            const value = propsToInit[key];
            propertyCache.set(key, value);
        }

        // Initialize aliases
        const aliases = await window.risuai._getAliases();
        const aliasKeys = Object.keys(aliases);
        for (let i = 0; i < aliasKeys.length; i++) {
            const aliasKey = aliasKeys[i];
            const childrens = Object.keys(aliases[aliasKey]);
            const aliasObj = {};
            for (let j = 0; j < childrens.length; j++) {
                const childKey = childrens[j];
                aliasObj[childKey] = risuai[aliases[aliasKey][childKey]];
            }
            propertyCache.set(aliasKey, aliasObj);
        }

        // Initialize helper functions defined in the guest

        propertyCache.set('unwarpSafeArray', async (safeArray) => {
            const length = await safeArray.length();
            const result = [];
            for (let i = 0; i < length; i++) {
                const item = await safeArray.at(i);
                result.push(item);
            }
            return result;
        });
    } catch (e) {
        console.error('Failed to initialize risuai properties:', e);
    }

    window.initOldApiGlobal = () => {
        const keys = risuai._getOldKeys()
        for(const key of keys){
            window[key] = risuai[key];
        }
    }

    Object.freeze(window.postMessage);
})();
`

export const V3_SANDBOX_CSP =
  "default-src 'none'; connect-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; script-src-attr 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; form-action 'none'; navigate-to 'none'; base-uri 'none';"
export const V3_GUARD_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'none'; child-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none';"

function inlineScriptString(value: string): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

export class SandboxHost {
  private iframe: HTMLIFrameElement
  private apiFactory: any
  private csp = V3_SANDBOX_CSP

  private instanceRegistry = new Map<string, any>()
  private abortControllers = new Map<string, AbortController>()
  private callbackWrapperCache = new Map<string, Function>()

  private pendingCallbacks = new Map<string, PendingCallback>()
  private runCleanup: (() => void) | null = null
  private pendingExecutions = new Map<string, PendingExecution>()

  constructor(apiFactory: any) {
    this.apiFactory = apiFactory
  }

  public executeInIframe(code: string): Promise<any> {
    const targetWindow = this.iframe?.contentWindow
    if (!targetWindow || !this.runCleanup) {
      return Promise.reject(new Error(SANDBOX_TERMINATED_MESSAGE))
    }

    return new Promise((resolve, reject) => {
      const reqId = 'exec_' + Math.random().toString(36).substring(2)

      const handler = (event: MessageEvent) => {
        if (event.source !== targetWindow) return
        const data = event.data

        if (data.type === 'EXEC_RESULT' && data.reqId === reqId) {
          window.removeEventListener('message', handler)
          this.pendingExecutions.delete(reqId)
          if (data.error) {
            reject(new Error(data.error))
          } else {
            resolve(data.result)
          }
        }
      }

      window.addEventListener('message', handler)
      this.pendingExecutions.set(reqId, { handler, reject })

      try {
        targetWindow.postMessage(
          {
            type: 'EXECUTE_CODE',
            reqId,
            code,
          },
          '*',
        )
      } catch (error) {
        window.removeEventListener('message', handler)
        this.pendingExecutions.delete(reqId)
        reject(error)
      }
    })
  }

  private collectTransferables(
    obj: any,
    transferables: Transferable[] = [],
    seenObjects = new Set<object>(),
    seenTransferables = new Set<Transferable>(),
  ): Transferable[] {
    if (!obj || typeof obj !== 'object') return transferables
    if (seenObjects.has(obj)) return transferables
    seenObjects.add(obj)

    let transferable: Transferable | undefined
    if (
      obj instanceof ArrayBuffer ||
      (typeof MessagePort !== 'undefined' && obj instanceof MessagePort) ||
      (typeof ImageBitmap !== 'undefined' && obj instanceof ImageBitmap) ||
      (typeof ReadableStream !== 'undefined' && obj instanceof ReadableStream) ||
      (typeof WritableStream !== 'undefined' && obj instanceof WritableStream) ||
      (typeof TransformStream !== 'undefined' && obj instanceof TransformStream) ||
      (typeof OffscreenCanvas !== 'undefined' && obj instanceof OffscreenCanvas)
    ) {
      transferable = obj
    } else if (ArrayBuffer.isView(obj) && obj.buffer instanceof ArrayBuffer) {
      transferable = obj.buffer
    }
    if (transferable) {
      if (!seenTransferables.has(transferable)) {
        seenTransferables.add(transferable)
        transferables.push(transferable)
      }
      return transferables
    }
    if (Array.isArray(obj)) {
      obj.forEach((item) => this.collectTransferables(item, transferables, seenObjects, seenTransferables))
    } else if (obj.constructor === Object) {
      Object.values(obj).forEach((value) =>
        this.collectTransferables(value, transferables, seenObjects, seenTransferables),
      )
    }

    return transferables
  }

  private serialize(val: any): any {
    if (val && (typeof val === 'object' || typeof val === 'function') && val.__classType === 'REMOTE_REQUIRED') {
      if (val === null) return null
      if (Array.isArray(val)) return val

      const id = 'ref_' + Math.random().toString(36).substring(2)
      this.instanceRegistry.set(id, val)
      return { __type: 'REMOTE_REF', id } as RemoteRef
    }

    if (val instanceof Response) {
      return {
        __type: 'CALLBACK_STREAMS',
        __specialType: 'Response',
        value: val.body,
        init: {
          status: val.status,
          statusText: val.statusText,
          headers: Array.from(val.headers.entries()),
        },
      }
    }

    if (val instanceof ReadableStream || val instanceof WritableStream || val instanceof TransformStream) {
      return {
        __type: 'CALLBACK_STREAMS',
        __specialType: 'none',
        value: val,
      }
    }
    return val
  }

  private deserializeArgs(args: any[], usedAbortIds?: string[]) {
    return args.map((arg) => {
      if (arg && arg.__type === 'CALLBACK_REF') {
        const cbRef = arg as CallbackRef

        const cached = this.callbackWrapperCache.get(cbRef.id)
        if (cached) return cached

        const targetWindow = this.iframe?.contentWindow
        const lifecycle = this.runCleanup
        const wrapper = async (...innerArgs: any[]) => {
          if (!targetWindow || !lifecycle || this.runCleanup !== lifecycle) {
            throw new Error(SANDBOX_TERMINATED_MESSAGE)
          }

          return new Promise<any>((resolve, reject) => {
            const reqId = 'cb_req_' + Math.random().toString(36).substring(2)
            const abortListeners: Array<{ signal: AbortSignal; listener: () => void }> = []
            const cleanup = () => {
              for (const { signal, listener } of abortListeners) {
                signal.removeEventListener('abort', listener)
              }
            }

            // AbortSignal cannot be structured-cloned for postMessage.
            // Convert to a serializable ref and forward abort events
            // via a separate ABORT_SIGNAL message.
            const sanitizedArgs = innerArgs.map((arg) => {
              if (arg instanceof AbortSignal) {
                const abortId = 'abort_' + Math.random().toString(36).substring(2)
                const ref: AbortSignalRef = {
                  __type: 'ABORT_SIGNAL_REF',
                  abortId,
                  aborted: arg.aborted,
                }
                if (!arg.aborted) {
                  const listener = () => {
                    if (this.runCleanup !== lifecycle) return
                    try {
                      targetWindow.postMessage(
                        {
                          type: 'ABORT_SIGNAL',
                          abortId,
                        } as RpcMessage,
                        '*',
                      )
                    } catch (_) {
                      /* iframe already removed */
                    }
                  }
                  abortListeners.push({ signal: arg, listener })
                  arg.addEventListener('abort', listener, { once: true })
                }
                return ref
              }
              return arg
            })

            const message = {
              type: 'INVOKE_CALLBACK',
              id: cbRef.id,
              reqId,
              args: sanitizedArgs,
            }
            this.pendingCallbacks.set(reqId, { resolve, reject, cleanup })
            try {
              const transferables = this.collectTransferables(message)
              targetWindow.postMessage(message, '*', transferables)
            } catch (error) {
              this.pendingCallbacks.delete(reqId)
              cleanup()
              reject(error)
            }
          })
        }
        this.callbackWrapperCache.set(cbRef.id, wrapper)
        return wrapper
      }
      if (arg && arg.__type === 'REMOTE_REF') {
        const remoteRef = arg as RemoteRef
        const instance = this.instanceRegistry.get(remoteRef.id)
        if (instance) {
          return instance
        }
      }
      if (arg && typeof arg === 'object' && arg.constructor === Object) {
        let out: any = null
        for (const [key, val] of Object.entries<any>(arg)) {
          if (val && val.__type === 'ABORT_SIGNAL_REF') {
            if (!out) out = { ...arg }
            const abortRef = val as AbortSignalRef,
              controller = new AbortController()

            if (abortRef.aborted) controller.abort()
            else this.abortControllers.set(abortRef.abortId, controller)

            usedAbortIds?.push(abortRef.abortId)
            out[key] = controller.signal
          }
        }
        if (out) return out
      }
      return arg
    })
  }

  private cleanupRuntimeState() {
    for (const { handler, reject } of this.pendingExecutions.values()) {
      window.removeEventListener('message', handler)
      reject(new Error(SANDBOX_TERMINATED_MESSAGE))
    }
    this.pendingExecutions.clear()
    for (const pending of this.pendingCallbacks.values()) {
      pending.cleanup()
      pending.reject(new Error(SANDBOX_TERMINATED_MESSAGE))
    }
    this.pendingCallbacks.clear()
    for (const controller of this.abortControllers.values()) {
      controller.abort()
    }
    this.instanceRegistry.clear()
    this.abortControllers.clear()
    this.callbackWrapperCache.clear()
  }

  public run(container: HTMLElement | HTMLIFrameElement, userCode: string) {
    this.terminate()

    if (container instanceof HTMLIFrameElement) {
      this.iframe = container
    } else {
      this.iframe = document.createElement('iframe')
      container.appendChild(this.iframe)
    }

    this.iframe.style.width = '100%'
    this.iframe.style.height = '100%'
    this.iframe.style.border = 'none'

    this.iframe.style.backgroundColor = 'transparent'
    this.iframe.setAttribute('allowTransparency', 'true')

    // This outer frame contains trusted relay code only. Its CSP governs the
    // nested opaque guest and blocks later child-frame navigations. The guest
    // cannot access this same-origin guard because it does not receive
    // allow-same-origin itself.
    this.iframe.sandbox.add('allow-scripts')
    this.iframe.sandbox.add('allow-same-origin')
    this.iframe.sandbox.add('allow-modals')

    this.iframe.setAttribute('csp', V3_GUARD_CSP)

    const messageHandler = async (event: MessageEvent) => {
      if (event.source !== this.iframe.contentWindow) return
      const data = event.data as RpcMessage

      if (data.type === 'CALLBACK_RETURN') {
        const req = this.pendingCallbacks.get(data.reqId!)
        if (req) {
          this.pendingCallbacks.delete(data.reqId!)
          req.cleanup()
          if (data.error) req.reject(new Error(data.error))
          else req.resolve(data.result)
        }
        return
      }

      if (data.type === 'ABORT_SIGNAL') {
        const controller = this.abortControllers.get(data.abortId!)
        if (controller) {
          controller.abort()
          this.abortControllers.delete(data.abortId!)
        }
        return
      }

      if (data.type === 'RELEASE_INSTANCE') {
        this.instanceRegistry.delete(data.id!)
        return
      }

      if (data.type === 'CALL_ROOT' || data.type === 'CALL_INSTANCE') {
        const response: RpcMessage = { type: 'RESPONSE', reqId: data.reqId }
        const usedAbortIds: string[] = []

        try {
          const args = this.deserializeArgs(data.args || [], usedAbortIds)
          let result: any

          if (data.type === 'CALL_ROOT') {
            const fn = this.apiFactory[data.method!]
            if (typeof fn !== 'function') throw new Error(`API method ${data.method} not found`)
            result = await fn(...args)
          } else {
            const instance = this.instanceRegistry.get(data.id!)
            if (!instance) throw new Error('Instance not found or released')
            if (typeof instance[data.method!] !== 'function')
              throw new Error(`Method ${data.method} missing on instance`)
            result = await instance[data.method!](...args)
          }

          response.result = this.serialize(result)
        } catch (err: any) {
          response.error = err.message || 'Host execution error'
        } finally {
          for (const id of usedAbortIds) this.abortControllers.delete(id)
        }

        const transferables = this.collectTransferables(response)
        try {
          this.iframe.contentWindow?.postMessage(response, '*', transferables)
        } catch (error) {
          this.iframe.contentWindow?.postMessage(
            {
              type: 'RESPONSE',
              reqId: data.reqId,
              error: 'Failed to post message to iframe: ' + (error as Error).message,
            },
            '*',
          )
          console.error('Failed to post message to iframe:', error)
        }
      }
    }

    const cleanup = () => {
      if (this.runCleanup !== cleanup) return
      this.runCleanup = null
      window.removeEventListener('message', messageHandler)
      this.iframe.remove()
      this.cleanupRuntimeState()
    }

    window.addEventListener('message', messageHandler)
    this.runCleanup = cleanup

    try {
      const guestHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="${this.csp}" id="csp-meta">
        </head>
        <body>
          <style>
              body {
                  background-color: transparent;
              }
          </style>
          <script>
              document.querySelector('meta#csp-meta')?.remove();
              (async () => {
                  ${GUEST_BRIDGE_SCRIPT}

                  (async () => {
                      ${userCode}
                  })()
              })();
          </script>
        </body>
        </html>
      `
      const guestHtmlLiteral = inlineScriptString(guestHtml)
      const guestCspLiteral = inlineScriptString(this.csp)
      const guardHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="${V3_GUARD_CSP}">
          <style>
            html, body, #risu-plugin-guest {
              width: 100%;
              height: 100%;
              margin: 0;
              padding: 0;
              border: 0;
              background: transparent;
            }
          </style>
        </head>
        <body>
          <script>
            (() => {
              const collectTransferables = (
                value,
                result = [],
                seenObjects = new Set(),
                seenTransferables = new Set(),
              ) => {
                if (!value || (typeof value !== 'object' && typeof value !== 'function') || seenObjects.has(value)) {
                  return result
                }
                seenObjects.add(value)
                let transferable = null
                if (
                  value instanceof ArrayBuffer ||
                  (typeof MessagePort !== 'undefined' && value instanceof MessagePort) ||
                  (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
                  (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) ||
                  (typeof WritableStream !== 'undefined' && value instanceof WritableStream) ||
                  (typeof TransformStream !== 'undefined' && value instanceof TransformStream) ||
                  (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)
                ) {
                  transferable = value
                } else if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) {
                  transferable = value.buffer
                }
                if (transferable) {
                  if (!seenTransferables.has(transferable)) {
                    seenTransferables.add(transferable)
                    result.push(transferable)
                  }
                  return result
                }
                if (Array.isArray(value)) {
                  for (const item of value) {
                    collectTransferables(item, result, seenObjects, seenTransferables)
                  }
                } else {
                  for (const item of Object.values(value)) {
                    collectTransferables(item, result, seenObjects, seenTransferables)
                  }
                }
                return result
              }

              const guest = document.createElement('iframe')
              guest.id = 'risu-plugin-guest'
              guest.sandbox.add('allow-scripts')
              guest.sandbox.add('allow-modals')
              guest.setAttribute('allowTransparency', 'true')
              guest.setAttribute('csp', ${guestCspLiteral})
              guest.srcdoc = ${guestHtmlLiteral}

              addEventListener('message', (event) => {
                if (event.source === guest.contentWindow) {
                  parent.postMessage(event.data, '*', collectTransferables(event.data))
                } else if (event.source === parent) {
                  guest.contentWindow?.postMessage(event.data, '*', collectTransferables(event.data))
                }
              })

              document.documentElement.appendChild(guest)
            })()
          </script>
        </body>
        </html>
      `

      this.iframe.srcdoc = guardHtml
    } catch (error) {
      cleanup()
      throw error
    }

    return cleanup
  }

  public terminate() {
    const cleanup = this.runCleanup
    if (cleanup) {
      cleanup()
      return
    }
    if (this.iframe) {
      this.iframe.remove()
    }
    this.cleanupRuntimeState()
  }
}
