// This web worker runs Python code using Pyodide.

import { loadPyodide, version as pyodideVersion, type PyodideInterface } from 'pyodide'

export type PyWorkerRequest =
  | {
      type: 'init'
      id: string
      moduleFunctions: string[]
      code: string
    }
  | {
      type: 'python'
      id: string
      method: string
      args: unknown[]
    }
  | {
      type: 'functionResult'
      callId: string
      result: unknown
    }
  | {
      type: 'functionError'
      callId: string
      error: string
    }

export type PyWorkerResponse =
  | {
      type: 'result'
      id: string
      result: unknown
    }
  | {
      type: 'error'
      id: string
      error: string
    }
  | {
      type: 'call'
      callId: string
      method: string
      args: unknown[]
    }

let py: PyodideInterface
const pendingHostCalls = new Map<
  string,
  {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
  }
>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function initPyodide() {
  if (py) {
    return py
  }
  py = await loadPyodide({
    indexURL: `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`,
  })
  return py
}

function createHostModule(moduleFunctions: string[]): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const hostModule: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const method of moduleFunctions) {
    hostModule[method] = (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        const callId = crypto.randomUUID()
        pendingHostCalls.set(callId, { resolve, reject })
        try {
          self.postMessage({
            type: 'call',
            method,
            args,
            callId,
          } satisfies PyWorkerResponse)
        } catch (error) {
          pendingHostCalls.delete(callId)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    }
  }
  return hostModule
}

self.onmessage = async (event: MessageEvent<PyWorkerRequest>) => {
  const message = event.data
  try {
    switch (message.type) {
      case 'functionResult': {
        const pending = pendingHostCalls.get(message.callId)
        if (!pending) return
        pendingHostCalls.delete(message.callId)
        pending.resolve(message.result)
        return
      }
      case 'functionError': {
        const pending = pendingHostCalls.get(message.callId)
        if (!pending) return
        pendingHostCalls.delete(message.callId)
        pending.reject(new Error(message.error))
        return
      }
      case 'init': {
        const pyodide = await initPyodide()
        try {
          pyodide.unregisterJsModule('risuai')
        } catch {
          // The module is absent on the first initialization.
        }
        pyodide.registerJsModule('risuai', createHostModule(message.moduleFunctions))
        pyodide.FS.writeFile('./cd.py', message.code)
        self.postMessage({
          type: 'result',
          id: message.id,
          result: { version: pyodideVersion },
        } satisfies PyWorkerResponse)
        return
      }
      case 'python': {
        const pyodide = await initPyodide()
        const module = pyodide.pyimport('cd') as Record<string, ((...args: unknown[]) => unknown) | undefined>
        const method = module?.[message.method]
        if (typeof method !== 'function') {
          throw new Error(`Python function ${message.method} not found`)
        }
        const result = await method(...message.args)
        self.postMessage({
          type: 'result',
          id: message.id,
          result: result ?? null,
        } satisfies PyWorkerResponse)
        return
      }
    }
  } catch (error) {
    if ('id' in message) {
      self.postMessage({
        type: 'error',
        id: message.id,
        error: errorMessage(error),
      } satisfies PyWorkerResponse)
    } else {
      console.error('Python worker protocol error:', error)
    }
  }
}
