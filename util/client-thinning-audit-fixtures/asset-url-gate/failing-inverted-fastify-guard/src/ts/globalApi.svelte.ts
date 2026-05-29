import { serverAssetUrl } from './server/assets'

declare const isFastifyServer: boolean

// Adversarial variant of the A4R7 shape-gate defeat: the `isFastifyServer`
// guard is inverted so the browser branch is the `then` (and happens to throw,
// satisfying the old branch-text checks), while the REAL Fastify branch — the
// statements after the early-return guard — still falls back to `?? loc`. A
// branch-text finder that latches the first `then` block latches the browser
// throw and passes; the hardened rule locates the Fastify branch by polarity.
export async function getFileSrc(loc: string): Promise<string> {
  if (!isFastifyServer) {
    throw new Error('browser asset loading is unavailable in this fixture')
  }
  return serverAssetUrl(loc) ?? loc
}
