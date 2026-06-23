# Phase Index

Active phase index for the prompt template ownership cleanup workstream.

- [Phase 0: Contract And Decision](phase-0-contract-and-decision.md)
- [Phase 1: Effective Template Resolver](phase-1-effective-template-resolver.md)
- [Phase 2: Prompt Preset Commands And Projection](phase-2-prompt-preset-commands-and-projection.md)
- [Phase 3: Settings UI And Bridge](phase-3-settings-ui-and-bridge.md)
- [Phase 4: Legacy BotPreset Compatibility](phase-4-legacy-botpreset-compatibility.md)
- [Phase 5: Generation Loadout And Cleanup](phase-5-generation-loadout-and-cleanup.md)
- [Phase 6: Verification And Docs](phase-6-verification-and-docs.md)

## Slice Rules

- Keep contract, resolver, commands/projection, UI bridge, legacy
  compatibility, and final cleanup in separate phases where possible.
- Re-check source symbols before editing. Plan anchors are durable by concept,
  not by line number.
- Add resolver/ownership tests before changing UI consumers.
- Commands that edit prompt template rows should include stable owner identity
  once prompt presets become authoritative.
- A phase is not complete until focused tests pass or its exact test gap is
  recorded in `../status.md`.
- Generation must not silently use a stale top-level prompt template once prompt
  preset ownership lands.
- Use `pnpm dev:agent` for browser smoke when changing Settings -> Prompt or
  preset picker workflows, and stop it before finishing.
