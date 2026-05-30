/**
 * Svelte-free copies of `sfc32` + `pickHashRand`. Lifted out of
 * `src/ts/util.ts` so the Fastify lorebook activation path can compute stable
 * chat-var keys for `keep_activate_after_match` / `dont_activate_after_match`
 * without pulling in `getDatabase` or any Svelte stores.
 *
 * `src/ts/util.ts` re-exports both names so existing SPA callers
 * (`cbs.ts`, `process/mcp/risuaccess/characters.ts`,
 * `process/lorebook.svelte.ts`) keep working unchanged.
 *
 * The math is identical to the SPA's pre-lift implementation — same
 * sfc32 constants, same `5515` hashAddress seed inside
 * `pickHashRand`, same `cid % 1000` advance — so chat-var keys
 * computed by the server bit-for-bit match keys computed by the
 * browser path.
 */

export function sfc32(a: number, b: number, c: number, d: number) {
  return function () {
    a |= 0
    b |= 0
    c |= 0
    d |= 0
    let t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

export function pickHashRand(cid: number, word: string) {
  let hashAddress = 5515
  const rand = (word: string) => {
    for (let counter = 0; counter < word.length; counter++) {
      hashAddress = (hashAddress << 5) + hashAddress + word.charCodeAt(counter)
    }
    return hashAddress
  }
  const randF = sfc32(rand(word), rand(word), rand(word), rand(word))
  const v = cid % 1000
  for (let i = 0; i < v; i++) {
    randF()
  }
  return randF()
}
