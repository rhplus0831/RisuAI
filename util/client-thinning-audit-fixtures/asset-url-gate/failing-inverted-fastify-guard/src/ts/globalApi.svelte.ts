import { serverAssetUrl } from './server/assets'

declare const isFastifyServer: boolean

// Violation: the inverted Fastify guard leaves the real Fastify branch falling
// back to `?? loc`.
export async function getFileSrc(loc: string): Promise<string> {
  if (!isFastifyServer) {
    throw new Error('browser asset loading is unavailable in this fixture')
  }
  return serverAssetUrl(loc) ?? loc
}
