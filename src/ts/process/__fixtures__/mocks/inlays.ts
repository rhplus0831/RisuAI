/**
 * Mock for src/ts/process/files/inlays.
 *
 * Fixtures reference inlay assets via `{{inlay::<id>}}` markers in message
 * data. The real getInlayAsset() reads from localforage; here we return a
 * canned record for ids that look like fixture asset names.
 */
export async function getInlayAsset(id: string) {
  if (id === 'test-image') {
    return {
      type: 'image' as const,
      // 1x1 transparent PNG.
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      ext: 'png',
      name: 'test-image.png',
      width: 1,
      height: 1,
    }
  }
  return null
}

export async function getInlayAssetBlob(_id: string) {
  return null
}

/**
 * Real impl: getModelInfo(db.aiModel).flags.includes(LLMFlags.hasImageInput).
 * Fixtures that need this set `aiModel` to a custom model with the flag; we
 * return true so the multimodal path is taken. Other fixtures don't reach
 * this code (no inlay tags in their messages).
 */
export function supportsInlayImage() {
  return true
}
