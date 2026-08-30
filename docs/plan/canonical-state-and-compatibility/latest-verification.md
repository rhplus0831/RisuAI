# Canonical State And Compatibility Retirement Latest Verification

Date: 2026-08-31

## Candidate

- Implementation commits: `c85b523c8`, `28d0bbd0a`, `bfa1b048e`,
  `29775b825`, and `c0b8776b3`
- Migration predecessor: `47146eb759a8369ad407e872ce5897604a2ae7f4`
- Phase 1 predecessor: `1e758cd22`
- Opening anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`
- Workstream 1 convention release: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 2 normal-consumer checkpoint for selected model-preset
  composition, browser prompt shape, and durable-profile tokenizer budgeting.

## Consumer-Cutover Proof

- Legacy model/provider and role-specific preset selections reset durable role
  bindings only on the effective clone used by generation, memory, and browser
  prompt assembly. Persisted top-level bindings and inline credentials are not
  copied or mutated.
- Canonical preset owner-field presence disables compatibility even when stale
  flat fields coexist; parameter-only and empty rows do not activate it.
- The compatibility baseline records the named
  `applyLegacyModelPresetCompatibilitySelection` seam. It is explicitly held
  until Phase 5 can repair inline credential ownership without copying secrets.
- Durable profile runtime tokenizer selection remains highest precedence;
  profile-local custom-API provider configuration now precedes global runtime
  defaults, preventing schema-v34 defaults from masking selected profiles.
- Browser history formatting, image capability, continue markers, system
  coalescing, chat-token overhead, maximum context, tokenizer family,
  credentials, and cache identity now derive from one resolved `chatMain`
  profile even when flat fields conflict.
- Fastify and browser budgeting share the tokenizer-selection precedence helper;
  the duplicate Fastify record-type dependency is gone.

## Commands And Results

- Focused preset composition, generation chat, memory summarization, split
  presets, model resolver, tokenizer, send-context, tokenizer-config, and
  server-preview files passed 25, 181, 19, 13, 50, 5, 23, 58, and 38 tests.
- Prompt build-history, history-format, final-render, assembly, and ownership
  files passed 11, 16, 24, 2, and 2 tests; the model-runtime ownership file
  passed 2.
- `pnpm check`, shared-core/client declarations, Fastify, browser-smoke, and
  root typechecks passed.
- Architecture inventory passed at 316 cross-runtime edges, 20 compatibility
  surfaces/42 probes, 9,889 client references/326 groups, and 56 owner-gap rows.
- Focused Prettier and `git diff --check` passed.

## Verdict

The normal-consumer checkpoint passes through `c0b8776b3`. Selected legacy
preset ownership is request-local, prompt shape and tokenizer budgeting use the
selected durable profile, and canonical configuration has shared tokenizer
precedence. The broader normal consumer cutover remains active; the model-owner
cursor is not released yet.
