// EC1 fixture: browser Vertex access-token projection writes are unreachable in
// Fastify mode. The projection write is gated behind `if (!isFastifyServer)` and
// only runs through withTrustedServerProjectionWrite in browser-local mode.

declare const isFastifyServer: boolean
declare function withTrustedServerProjectionWrite(fn: () => void): void

export function persistVertexAccessToken(token: string): void {
  if (!isFastifyServer) {
    withTrustedServerProjectionWrite(() => {
      void token
    })
  }
}
