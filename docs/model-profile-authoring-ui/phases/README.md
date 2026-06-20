# Phase Index

Active phase index for the model profile authoring UI workstream.

- [Phase 0: Contract And Schema](phase-0-contract-and-schema.md)
- [Phase 1: Resolver Runtime Status](phase-1-resolver-runtime-status.md)
- [Phase 2: Profile Commands And Conversion](phase-2-profile-commands-and-conversion.md)
- [Phase 3: Settings Model Shell](phase-3-settings-model-shell.md)
- [Phase 4: Profile Editor Providers](phase-4-profile-editor-providers.md)
- [Phase 5: Generation Guardrails](phase-5-generation-guardrails.md)
- [Phase 6: Verification And Cleanup](phase-6-verification-and-cleanup.md)

## Slice Rules

- Keep schema, resolver, commands, UI, dispatch guardrails, and final cleanup in
  separate phases where possible.
- Re-check source symbols before editing. Plan anchors are durable by concept,
  not by line number.
- Add schema/resolver tests before changing UI consumers.
- Persisted profile rows must retain stable ids because secret masking keys by
  profile `id`.
- A phase is not complete until focused tests pass or its exact test gap is
  recorded in `../status.md`.
- Profile-bound generation must not silently borrow legacy/global provider
  fields once the relevant phase lands.
- Use `pnpm dev:agent` for browser smoke when changing the live Settings ->
  Model workflow, and stop it before finishing.

