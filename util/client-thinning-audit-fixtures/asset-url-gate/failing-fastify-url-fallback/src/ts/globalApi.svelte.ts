import { serverAssetUrl } from './server/assets'

export async function getFileSrc(loc: string): Promise<string> {
  return serverAssetUrl(loc) ?? loc
}
