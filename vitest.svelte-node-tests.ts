// Transitional allowlist for tests that need Svelte transformation or runtime
// behavior without a DOM. The Happy-DOM fallback excludes every file here.
export const svelteNodeTestFiles = [
  'src/lib/Setting/Pages/BotSettings.promptToggleDurable.test.ts',
  'src/ts/characterCards.pngImport.test.ts',
  'src/ts/parser/tests/chatVar.svelte.test.ts',
  'src/ts/pluginCommands.durable.test.ts',
  'src/ts/pluginCommands.test.ts',
  'src/ts/server/assets.test.ts',
  'src/ts/server/backups.test.ts',
  'src/ts/server/bootstrap.test.ts',
  'src/ts/server/hydrationReads.test.ts',
  'src/ts/server/replacementDatabaseOwnership.test.ts',
  'src/ts/stores.runtimeEffects.svelte.test.ts',
  'src/ts/server/persistenceActivity.svelte.test.ts',
  'src/ts/server/resourceReads.test.ts',
  'src/ts/server/shellHydration.test.ts',
  'src/ts/translator/translator.cache.test.ts',
  'src/ts/process/generationEffectLedger.test.ts',
  'src/ts/process/recoveredGenerationEffects.test.ts',
] as const
