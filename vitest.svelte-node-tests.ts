// Transitional allowlist for tests that need Svelte transformation or runtime
// behavior without a DOM. The Happy-DOM fallback excludes every file here.
export const svelteNodeTestFiles = [
  'src/lib/Setting/Pages/BotSettings.promptToggleDurable.test.ts',
  'src/ts/characterCards.pngImport.test.ts',
  'src/ts/parser/tests/chatVar.svelte.test.ts',
  'src/ts/server/assets.test.ts',
  'src/ts/server/backups.test.ts',
  'src/ts/server/bootstrap.test.ts',
  'src/ts/server/hydrationReads.test.ts',
  'src/ts/server/replacementDatabaseOwnership.test.ts',
  'src/ts/stores.runtimeEffects.svelte.test.ts',
] as const
