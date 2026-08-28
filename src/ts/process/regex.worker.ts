import { executeRegexWorkerRequest, type RegexWorkerRequest } from './regexWorkerRuntime'

interface WorkerRequestEnvelope {
  id: number
  request: RegexWorkerRequest
}

interface RegexWorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequestEnvelope>) => void): void
  postMessage(message: unknown): void
}

const workerScope = globalThis as unknown as RegexWorkerScope

workerScope.addEventListener('message', (event) => {
  const { id, request } = event.data
  try {
    workerScope.postMessage({ id, ok: true, result: executeRegexWorkerRequest(request) })
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
