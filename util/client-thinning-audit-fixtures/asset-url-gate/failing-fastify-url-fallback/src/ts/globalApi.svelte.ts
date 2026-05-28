import { serverAssetUrl } from './server/assets'

declare const isFastifyServer: boolean

export async function getFileSrc(loc: string): Promise<string> {
  if (isFastifyServer) {
    return serverAssetUrl(loc) ?? loc
  }
  return loc
}
