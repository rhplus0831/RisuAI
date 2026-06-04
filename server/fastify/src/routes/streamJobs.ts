import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import { type AuthState, hasPassword, verifyAssertion } from '../auth.js'
import { extractRisuAuth } from '../http.js'
import {
  type JobClient,
  type JobRegistry,
  PROXY_STREAM_MAX_ACTIVE_JOBS,
  PROXY_STREAM_MAX_BODY_BASE64_BYTES,
  runStreamJob,
  sanitizeLocalTargetUrl,
} from '../streamJobs.js'
import { STREAM_CLIENT_MAX_BUFFERED_BYTES } from '../streamBackpressure.js'
import { proxyStreamCreateRateLimit } from '../routeRateLimits.js'

const ALLOWED_METHODS = new Set(['POST', 'GET', 'PUT', 'DELETE', 'PATCH'])

interface CreateJobBody {
  url?: unknown
  method?: unknown
  headers?: unknown
  bodyBase64?: unknown
  timeoutMs?: unknown
  heartbeatSec?: unknown
}

interface JobIdParams {
  id: string
}

interface WsQuerystring {
  'risu-auth'?: string
}

function wsBufferedBytes(socket: WebSocket): number {
  return Math.max(0, socket.bufferedAmount)
}

function closeWs(socket: WebSocket): void {
  try {
    socket.close()
  } catch {
    // ignore
  }
}

function sendBoundedWs(socket: WebSocket, text: string): void {
  if (socket.readyState !== socket.OPEN) return
  if (wsBufferedBytes(socket) + Buffer.byteLength(text) > STREAM_CLIENT_MAX_BUFFERED_BYTES) {
    closeWs(socket)
    return
  }
  socket.send(text, (err: unknown) => {
    if (err) closeWs(socket)
  })
}

async function checkProxyAuth(
  authState: AuthState,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (!hasPassword(authState)) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  const token = extractRisuAuth(req)
  if (!token) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  const result = await verifyAssertion(authState, token)
  if (!result.ok) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  return true
}

async function checkProxyAuthWithQuery(
  authState: AuthState,
  req: FastifyRequest<{ Querystring: WsQuerystring }>,
  reply: FastifyReply,
): Promise<boolean> {
  if (!hasPassword(authState)) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  const headerToken = extractRisuAuth(req)
  const queryToken = typeof req.query['risu-auth'] === 'string' ? req.query['risu-auth'] : ''
  const token = headerToken || queryToken
  if (!token) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  const result = await verifyAssertion(authState, token)
  if (!result.ok) {
    reply.code(401).send({ error: 'Auth required' })
    return false
  }
  return true
}

function wsToJobClient(socket: WebSocket): JobClient {
  return {
    send(text) {
      sendBoundedWs(socket, text)
    },
    close() {
      closeWs(socket)
    },
    get open() {
      return socket.readyState === socket.OPEN
    },
    get bufferedBytes() {
      return wsBufferedBytes(socket)
    },
  }
}

export function registerStreamJobRoutes(
  app: FastifyInstance,
  authState: AuthState,
  registry: JobRegistry,
): void {
  app.post(
    '/api/v1/proxy/stream-jobs',
    { config: { rateLimit: proxyStreamCreateRateLimit } },
    async (req, reply) => {
      if (!(await checkProxyAuth(authState, req, reply))) return

      const body = (req.body ?? {}) as CreateJobBody
      const targetUrl = sanitizeLocalTargetUrl(body.url)
      if (!targetUrl) {
        reply.code(400)
        return {
          error: 'Invalid target URL. Only local/private network http(s) endpoints are allowed.',
        }
      }

      const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'POST'
      if (!ALLOWED_METHODS.has(method)) {
        reply.code(400)
        return { error: 'Invalid method' }
      }

      const bodyBase64 = typeof body.bodyBase64 === 'string' ? body.bodyBase64 : ''
      if (bodyBase64.length > PROXY_STREAM_MAX_BODY_BASE64_BYTES) {
        reply.code(413)
        return { error: 'Request body too large' }
      }

      if (registry.size() >= PROXY_STREAM_MAX_ACTIVE_JOBS) {
        reply.code(429)
        return { error: 'Too many active stream jobs. Retry shortly.' }
      }

      const headers =
        body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)
          ? (body.headers as Record<string, unknown>)
          : {}
      const bodyBuffer = bodyBase64.length > 0 ? Buffer.from(bodyBase64, 'base64') : undefined

      const job = registry.create({
        timeoutMs: body.timeoutMs,
        heartbeatSec: body.heartbeatSec,
      })

      void runStreamJob(registry, job, {
        targetUrl,
        method,
        headers: headers as Record<string, string>,
        bodyBuffer,
        clientIp: req.ip,
      })

      return { jobId: job.id, heartbeatSec: job.heartbeatSec }
    },
  )

  app.delete<{ Params: JobIdParams }>('/api/v1/proxy/stream-jobs/:id', async (req, reply) => {
    if (!(await checkProxyAuth(authState, req, reply))) return
    registry.deleteJob(req.params.id)
    return { success: true }
  })

  app.get<{ Params: JobIdParams; Querystring: WsQuerystring }>(
    '/api/v1/proxy/stream-jobs/:id/ws',
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const authed = await checkProxyAuthWithQuery(authState, req, reply)
        if (!authed) return
        if (!registry.has(req.params.id)) {
          reply.code(404).send({ error: 'Job not found' })
        }
      },
    },
    (socket, req) => {
      const jobId = req.params.id
      const job = registry.get(jobId)
      if (!job) {
        socket.close()
        return
      }

      const client = wsToJobClient(socket)
      client.send(JSON.stringify({ type: 'job_accepted', jobId }))
      registry.attach(jobId, client)

      const ping = setInterval(() => {
        if (socket.readyState === socket.OPEN) {
          sendBoundedWs(socket, JSON.stringify({ type: 'ping', ts: Date.now() }))
        }
      }, job.heartbeatSec * 1000)
      ping.unref()

      const cleanup = (): void => {
        clearInterval(ping)
        registry.detach(jobId, client)
      }
      socket.on('close', cleanup)
      socket.on('error', cleanup)

      // Attaching to an already-done (in-grace) job: `attach` just flushed the
      // buffered tail and nothing else will ever close this viewer — the
      // attached client blocks both GC branches, pinning the job and the ping
      // timer until the client hangs up (audit L12). Mirror the durable
      // viewer: tear down now (the eventual socket 'close' re-running cleanup
      // is a no-op).
      if (job.done) {
        cleanup()
        closeWs(socket)
      }
    },
  )
}
