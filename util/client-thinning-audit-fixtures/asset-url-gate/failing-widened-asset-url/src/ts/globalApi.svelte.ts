import { serverAssetUrl } from './server/assets'

// The URL-getter is correct here; the defeat lives in the widened
// `serverAssetUrl` gate helper.
export async function getFileSrc(loc: string): Promise<string> {
  if (loc.startsWith('/api/v1/assets/') || loc.startsWith('data:') || loc.startsWith('blob:')) {
    return loc
  }
  const resolved = serverAssetUrl(loc)
  return resolved ?? ''
}
