import { serverAssetUrl } from './server/assets'

// Violation: the function falls back to `?? loc` for unknown asset shapes.
export async function getFileSrc(loc: string): Promise<string> {
  return serverAssetUrl(loc) ?? loc
}
