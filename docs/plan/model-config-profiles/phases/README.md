# Phase Index

Active phase index for the model config profiles workstream.

- [Phase 0: Current Contracts](phase-0-current-contracts.md)
- [Phase 1: Read-Only Profile Resolver](phase-1-read-only-profile-resolver.md)
- [Phase 2: Preset Composition](phase-2-preset-composition.md)
- [Phase 3: Generation Dispatch](phase-3-generation-dispatch.md)
- [Phase 4: UI & Command Adapter](phase-4-ui-and-command-adapter.md)
- [Phase 5: Custom, Secrets & Auxiliary](phase-5-custom-secrets-and-auxiliary.md)
- [Phase 6: Persisted Profiles](phase-6-persisted-profiles.md)
- [Phase 7: Verification & Cleanup](phase-7-verification-and-cleanup.md)

## Slice Rules

- Keep resolution, runtime dispatch, preset composition, UI migration, and
  durable storage in separate phases where possible.
- Re-check source symbols before editing. Plan anchors are durable by concept,
  not by line number.
- Add resolver tests before changing runtime consumers.
- Persisted profile rows must have stable ids before they can carry secrets.
- A phase is not complete until focused tests pass or its exact test gap is
  recorded in `../status.md`.
- Server and browser dispatch parity must be proved for each provider family
  before flat fallback behavior is removed.
