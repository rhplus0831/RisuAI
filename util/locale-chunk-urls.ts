import path from 'node:path'
import type { Plugin } from 'vite'

const localeCodes = ['cn', 'de', 'es', 'ko', 'vi', 'zh-Hant'] as const

/** Own retry URLs at build time; never derive executable URLs from error messages. */
export function createLocaleChunkUrlsPlugin(rootDir: string): Plugin {
  const owner = path.resolve(rootDir, 'src/lang/localeChunkUrls.ts')
  return {
    name: 'risu-locale-chunk-urls',
    apply: 'build',
    load(id) {
      if (path.resolve(id) !== owner) return
      const entries = localeCodes.map((code) => {
        const reference = this.emitFile({ type: 'chunk', id: path.resolve(rootDir, `src/lang/${code}.ts`) })
        // Rollup/Rolldown resolves this relative to the containing emitted
        // module, including relative-base deployments and hashed chunk names.
        return `${JSON.stringify(code)}: import.meta.ROLLUP_FILE_URL_${reference}`
      })
      return `export const localeChunkUrls = {${entries.join(',')}};`
    },
  }
}
