import { getDatabase } from '../../storage/database.svelte'
import { getImageType } from '../imageType'
import { doLossyCompression } from './lossyCompression'

export async function compressImage(data: Uint8Array) {
  if (!getDatabase().imageCompression) {
    return data
  }

  const type = getImageType(data)
  if (type !== 'Unknown' && type !== 'WEBP' && type !== 'AVIF') {
    return await doLossyCompression(data)
  }

  return data
}
