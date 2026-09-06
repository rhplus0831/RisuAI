# Phase 7 — Providers, Models, Translation, And Media

Status: Complete
Depends on: Phases 1, 5-6

Completion anchor:

- `fe7825f3da4bdd2aceb090fc6eaaa9b2cf5a6050` — closed model-format,
  provider, option, operation, translation, image, speech, and transcription
  ownership.

## Objective

Verify provider/model capability and resolution, credentials, endpoint
selection, wire requests, retries/fallbacks, translation, and retained image,
audio, and transcription behavior.

## Audit Questions

- Is every retained model/profile/provider combination classified and dispatched
  to the right native implementation?
- Are URL path/query, method, headers, body fields, roles, model, options,
  endpoint overrides, and retry/fallback order preserved?
- Do missing/default/null runtime options and legacy profile shapes resolve as
  the baseline contract requires?
- Are credentials selected server-side, redacted from projections/traces, and
  scoped to the correct provider/endpoint?
- Do translation and media actions preserve target, ordering, metadata, assets,
  failure feedback, cancellation, and paid-side-effect boundaries?

## Required Outputs

- Closed-world provider/model/capability/endpoint/option dispatch matrices.
- Sanitized request-capture fixtures and shared semantic wire assertions.
- Explicit coverage of Responses endpoint preservation and translation
  runtime/profile dispatch from the Phase 0 pilot.
- Deterministic retry/fallback/error/cancel cases; bounded live canaries only if
  separately approved.
- Secret-projection/trace negative tests and media/translation browser outcomes.

## Exit Criteria

- Every retained provider/model path has a capability, resolution, credential,
  endpoint, request, and failure owner.
- No runtime option or override is silently dropped or applied to the wrong path.
- Wire-semantic differences are fixed or individually signed.
- Focused provider, translation, media, generation, security, and compatibility
  lanes pass without normal CI requiring live paid calls.

## Validation

Run request-capture and dispatch matrices, secret/redaction tests, deterministic
provider failure/fallback tests, selected browser journeys, affected and
compatibility lanes, formatting, and `git diff --check`.

## Completion Record

### Model, Provider, Endpoint, And Option Closure

`server/fastify/__tests__/phase7CompatibilityStructure.test.ts` is the
closed-world guard for the retained provider vocabulary. It classifies all 24
`LLMFormat` values as one of 15 admitted Fastify text adapters or an explicit
browser-only path. Every server path must retain an endpoint/credential
resolver, adapter runner, dispatcher branch, and behavioral assurance owner.

The same gate closes all nine first-class profile-provider ids over dispatch,
endpoint, credentials, and provider-specific options. It also derives the exact
provider-option and runtime-option sets from the current profile interfaces and
requires a named materialization and consumption owner for every field.
`dynamicOutput` remains deliberately retained-inert under signed
`ORC-DECISION-059`; it cannot start affecting requests without changing the
classification. The curated provider catalog remains the individually signed
replacement for dynamic OpenAI registration.

Existing sanitized request-capture suites cover provider URL, method, headers,
credentials, model, roles, body options, streaming, endpoint overrides, retry,
cancel, and error behavior. The Responses path and translation runtime/profile
dispatch from the Phase 0 pilots remain included. Credential projections use
the shared secret-path owners verified in Phase 5; shared trace redaction
remains cross-owned by Phase 12. Deterministic CI does not make live paid calls.

### Fixed Operations, Translation, And Media

Every one of the 18 fixed provider operations is tied to its production
dispatcher and request-capture assurance. Translation closes over all four raw
translator kinds plus the browser pipeline/cache, message and greeting jobs,
generation-completion translation, and draft/BTW input-hook owners. The built
browser additionally proves that independent per-chat translator-preset
bindings persist across chat switches and reload-backed projections.

All eight server image providers, five TTS synthesis operations, and the fixed
Whisper VTT transcription route have bounded production and assurance owners.
Their tests cover credentials and request shape, binary/text response handling,
asset persistence, cancellation or failure cleanup, and visible browser-side
translation/speech state. Real third-party availability, remote codec support,
and autoplay policy remain deterministic fixture boundaries rather than normal
CI dependencies.

### Unsupported And Cross-Phase Boundaries

- `ORC-DECISION-006` governs the standing browser-only/nonserver provider paths;
  the format matrix prevents one from being silently admitted to Fastify.
- `ORC-DECISION-059` governs the curated model catalog and retained-inert
  `dynamicOutput` field. Provider additions must extend the closed matrices and
  request-capture evidence.
- Phase 6 owns provider-neutral prompt and generation lifecycle semantics; Phase
  8 owns detached translation/memory job durability; Phase 12 owns shared
  auth/limit/redaction/runtime behavior.
- Bounded live canaries are optional and separately approved. Their absence is
  not represented as provider-wire evidence.

No new Phase 7 divergence or maintainer decision was required. Category G rows
`ORC-SURFACE-103` through `ORC-SURFACE-105` own the model/provider, fixed
operation, and translation/media surfaces. Historical Category G rows
`ORC-SURFACE-010`, `ORC-SURFACE-030`, `ORC-SURFACE-037` through
`ORC-SURFACE-038`, `ORC-SURFACE-051` through `ORC-SURFACE-057`,
`ORC-SURFACE-063`, and `ORC-SURFACE-067` are independently re-verified by the
closed matrix and their focused behavioral owners rather than remaining at the
historical mapping state.

## Verification Evidence

| Check | Result |
| --- | --- |
| `server/fastify/__tests__/phase7CompatibilityStructure.test.ts` | Passed; 1 file and 6 closed-world tests. |
| Focused Fastify provider/operation/translation/media selection | Passed; 11 files and 249 tests. |
| Focused browser/runtime profile, translation, speech, and media selection | Passed; 11 files and 205 tests. |
| Focused `fastifyBrowserSmoke.spec.ts` translator-preset journey | Passed; 1 production-bundle browser test. |
| `pnpm check:server` | Passed at the Phase 7 implementation anchor. |
| Register, compatibility, formatting, and diff gates | Required after the Category G register update; exact final counts are recorded in `latest-verification.md`. |
