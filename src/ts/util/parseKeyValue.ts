/**
 * Svelte-free copy of `parseKeyValue`. Lifted out of `src/ts/util.ts`
 * so the Fastify trigger path (Phase 7-9b) can resolve
 * `char.defaultVariables` / `db.templateDefaultVariables` into
 * `[key, value]` pairs without pulling in `getDatabase`, the Tauri
 * dialog/fs plugins, Svelte components, or any Svelte stores.
 *
 * `src/ts/util.ts` re-exports this so existing browser callers keep
 * importing `parseKeyValue` from `../util` unchanged.
 */
export function parseKeyValue(template: string): [string, string][] {
  try {
    if (!template) {
      return []
    }

    const keyValue: [string, string][] = []

    for (const line of template.split('\n')) {
      const [key, value] = line.split('=')
      if (key && value) {
        keyValue.push([key, value])
      }
    }

    return keyValue
  } catch (error) {
    return []
  }
}
