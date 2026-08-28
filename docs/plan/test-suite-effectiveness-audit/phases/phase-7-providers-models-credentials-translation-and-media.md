# Phase 7: Providers, Models, Credentials, Translation, And Media

Status: In progress on 2026-08-29; Phases 0-1 and 6 satisfied.

## Objective

Audit whether provider/model tests detect real request, stream, capability,
credential, translation, and media defects without allowing mocked upstreams or
duplicated option tables to create false confidence.

## Scope

- First-class, local, legacy, free-model, and compatibility provider adapters.
- Request headers/bodies, option dispatch, message conversion, response/stream
  shaping, content blocks, errors, abort, catalogs, and capabilities.
- Model profile resolution, roles, runtime defaults/options, fallbacks, custom
  endpoints, and stable provider/profile identity.
- Stored/draft credentials, masking, stale inline-secret migration, endpoint
  binding, provider operations, OAuth refresh, and sanitized projections.
- Translation eligibility, presets, caches, raw/server message translation,
  jobs, and UI-visible translation where transport semantics dominate.
- Image generation, TTS/audio, transcription, codecs, Strip CoT, and related
  browser media fakes.

Primary discovery guide:
[`providers-models-and-media.md`](../../../tests/providers-models-and-media.md).

## Audit Questions

- Would malformed headers, bodies, option mapping, frames, content blocks,
  errors, or abort behavior fail the current tests?
- Are adapter matrices independently derived from production contracts, or do
  tests copy the same hand-maintained table and drift together?
- Are credentials proven absent from projections, traces, errors, exports, and
  unintended endpoints while preserving stable identity?
- Which browser/media behaviors are only simulated, and which require bounded
  real-browser or recorded-response evidence?
- Are compatibility transports deliberately supported or obsolete test-only
  surface?

## Required Outputs

- Provider-by-provider contract/disposition matrix.
- Credential flow map from storage/draft through resolution, transport, trace,
  and projection.
- Findings for copied option tables, weak error/content-block coverage,
  self-fulfilling fetch mocks, obsolete adapters, secret exposure, and missing
  browser/media semantics.
- Recorded rationale for intentional adapter/security defense in depth.

## Exit Criteria

- Every Phase 7 test has a disposition and supported provider/model/media owner.
- Unique request, stream, error, abort, capability, credential, and translation
  contracts remain protected.
- Critical/High secret or egress findings are resolved before closeout.
- Removed compatibility cases have an explicit product support decision.
- Count deltas and remaining mocked-boundary risks are recorded.

## Validation

- Focused frontend provider/model/translator/media tests
- Focused Fastify provider/credential/translation/media tests
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm test:server`
- `pnpm test:compat-harness` for affected generation transports when available
- Relevant browser smoke for visible/media behavior
- `pnpm check` and `pnpm check:server`
- `pnpm format:check`
- `git diff --check`
