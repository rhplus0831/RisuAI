# `@risuai/shared-core`

Browser/Node-neutral value algorithms shared by the RisuAI client and Fastify
server.

Runtime modules may use only ECMAScript value operations and reviewed modules
inside this package. They must not import protocol schemas, browser stores,
Svelte/DOM APIs, Fastify, Node built-ins, filesystem/process globals,
credentials, persistence, or aggregate application state. Serialized contracts
belong in `@risuai/protocol`; runtime-specific policy remains with its runtime.

## Navigate By Change

- Record normalization and resolution: `agentPresetRecords.ts`,
  `agentPresetResolver.ts`, `modelProfileRecords.ts`, `modelProfileResolver.ts`,
  `providerCredentialRecords.ts`, and `translatorPresets.ts`.
- Prompt and generation policy: `cbsContracts.ts`, `cbsRegistry.ts`,
  `chatGenerationSettings.ts`, `effectivePromptTemplate.ts`,
  `promptBlockRole.ts`, `promptSettings.ts`, and `providerCapability.ts`.
- Cross-runtime value helpers: `historySlots.ts`, `moduleActivation.ts`,
  `moduleIntegration.ts`, `resourceManifest.ts`, and `settingsGroups.ts`.
- Public package entrypoints are declared in `package.json`; add or update the
  narrow export when introducing a new shared owner.

Keep runtime adapters in `src/` or `server/fastify/`. A compatibility re-export
there is an import seam, not the implementation owner.

## Focused Checks

```sh
pnpm check:shared-core
pnpm check:shared-core:boundary
pnpm exec vitest run packages/shared-core/src
```

Run the nearest browser and Fastify consumer tests as well when shared behavior
changes.
