# Phase Index

Active phase index for the Agent Preset workstream.

The file names mirror `.archived-docs/generation-and-models/model-profile-authoring-ui/` by request;
the phase titles and contents below describe Agent Preset work.

- [Phase 0: Contract And Schema](phase-0-contract-and-schema.md)
- [Phase 1: Resolver Runtime Status](phase-1-resolver-runtime-status.md)
- [Phase 2: Agent Preset Commands And Context Cleanup](phase-2-profile-commands-and-conversion.md)
- [Phase 3: Settings Agent Preset Shell](phase-3-settings-model-shell.md)
- [Phase 4: Step Editor And Prepared Inputs](phase-4-profile-editor-providers.md)
- [Phase 5: Generation Guardrails](phase-5-generation-guardrails.md)
- [Phase 6: Verification And Cleanup](phase-6-verification-and-cleanup.md)

## Slice Rules

- Keep schema, resolver, commands, UI, generation integration, and cleanup in
  separate phases where possible.
- Re-check source symbols before editing. Plan anchors are durable by concept,
  not by line number.
- Add schema and resolver tests before changing UI consumers.
- Agent Preset ids and step ids must remain stable because diagnostics and
  saved chat selections refer to them.
- No selected Agent Preset is valid. A non-empty missing selected Agent Preset
  is an error.
- A phase is not complete until focused tests pass or its exact test gap is
  recorded in `../status.md`.
- Prompt assembly must not run the legacy Context Agent once Agent Preset
  generation integration lands.
- Use `pnpm dev:agent` for browser smoke when changing live Settings or chat
  generation workflows, and stop it before finishing.
