import { serverAssetUrl } from './server/assets'

/**
 * Gets the source URL of a file.
 *
 * @param {string} loc - The location of the file.
 * @returns {Promise<string>} - A promise that resolves to the source URL.
 */
export async function getFileSrc(loc: string) {
  // A4EC7 / B8: in Fastify mode the Fastify branch must only return URLs
  // for shapes the server-projection asset gate documents. Unknown shapes
  // (including raw http://https:// values from a poisoned projection) are
  // rejected with an empty string so an <img src=""> renders broken
  // instead of fetching the attacker-controlled origin.
  if (loc.startsWith('/api/v1/assets/') || loc.startsWith('data:') || loc.startsWith('blob:')) {
    return loc
  }
  const resolved = serverAssetUrl(loc)
  return resolved ?? ''
}
