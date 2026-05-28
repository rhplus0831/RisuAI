declare function saveAsset(data: Uint8Array, customId?: string, fileName?: string): Promise<string>

export async function saveGeneratedImage(bytes: Uint8Array): Promise<string> {
  // audit:image-default generated image bytes intentionally use default PNG metadata.
  return saveAsset(bytes, '', '')
}
