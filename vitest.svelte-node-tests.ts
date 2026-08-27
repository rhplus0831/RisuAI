// Transitional allowlist for tests that need Svelte transformation or runtime
// behavior without a DOM. The Happy-DOM fallback excludes every file here.
export const svelteNodeTestFiles = [
  'src/ts/parser/tests/chatVar.svelte.test.ts',
  'src/ts/stores.runtimeEffects.svelte.test.ts',
] as const
