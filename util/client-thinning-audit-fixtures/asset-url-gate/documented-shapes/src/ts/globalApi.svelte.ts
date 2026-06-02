import { serverAssetUrl } from './server/assets'

export async function getFileSrc(loc: string): Promise<string> {
  if (
    loc.startsWith('/api/v1/assets/') ||
    loc.startsWith('data:') ||
    loc.startsWith('blob:')
  ) {
    return loc
  }
  const resolved = serverAssetUrl(loc)
  return resolved ?? ''
}
