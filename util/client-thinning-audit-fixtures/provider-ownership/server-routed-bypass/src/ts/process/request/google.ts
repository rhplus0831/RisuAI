// EC1 fixture: google.ts is no longer checked by the audit (isFastifyServer is
// unconditionally true, so there are no browser-local Vertex access-token paths).
// This file is a no-op stub kept for fixture structure.

export function persistVertexAccessToken(_token: string): void {
  // No-op: Vertex access tokens are server-owned in Fastify mode.
}
