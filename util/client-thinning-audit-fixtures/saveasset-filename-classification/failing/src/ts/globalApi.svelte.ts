declare function saveAsset(data: Uint8Array, customId?: string, fileName?: string): Promise<string>

export async function saveBytes(bytes: Uint8Array): Promise<string> {
  return saveAsset(bytes)
}
