import type { FastifyReply, FastifyRequest } from 'fastify'

/** Maintenance has no provider deadline. Abort on disconnect; the coordinator
 * supplies server-shutdown cancellation and owns draining outstanding work. */
export function attachMaintenanceAbort(req: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController()
  const onRequestClose = () => {
    if (!req.raw.complete) controller.abort()
  }
  const onResponseClose = () => {
    if (!reply.raw.writableEnded) controller.abort()
  }
  req.raw.on('close', onRequestClose)
  reply.raw.on('close', onResponseClose)
  return {
    signal: controller.signal,
    cleanup() {
      req.raw.off('close', onRequestClose)
      reply.raw.off('close', onResponseClose)
    },
  }
}
