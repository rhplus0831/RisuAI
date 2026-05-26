# Phase 9 Slice - Provider And Model Scalar Direct Writes

Date: 2026-05-26

## Landed

- Replaced `BotSettings.svelte` direct model/provider tab bindings for
  `aiModel`, `subModel`, provider API keys, provider URLs, provider
  model selectors, and related toggles with `createServerBackedSettingDraft`
  drafts.
- Routed nested model/provider objects through drafts for `google`,
  `novelai`, `hordeConfig`, and `OaiCompAPIKeys`.
- Replaced direct side-effect assignments for Vertex token clearing,
  Ollama model-source/name resets, NanoGPT model/provider resets, and
  textgen streaming detection with draft updates.
- Routed the custom provider selector through the existing plugin
  provider command with a trusted optimistic projection update.
- Removed converted keys from `watchServerBackedSettings` in
  `BotSettings.svelte` to avoid duplicate dispatch after draft conversion.
- Aligned Fastify settings validation with the current numeric DB shape
  for `customAPIFormat` and `ollamaRequestFormat`.
- Added `NAIadventure` and `NAIappendName` to the Fastify provider
  settings allowlist and extended client / Fastify command coverage for
  the converted fields.

## Verification

```bash
pnpm exec vitest run src/ts/server/commands.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts
pnpm exec svelte-check --tsconfig ./tsconfig.json
```

## Historical Phase 9 Pickup

At this slice closeout, 9B was next: OpenRouter, auxiliary model, and
separate-parameter selectors. The next files called out by the runbook
were
`OpenrouterSettings.svelte`, `AuxModelSelectors.svelte`,
`SeparateParametersSection.svelte`, and matching EasyPanel shortcuts.
