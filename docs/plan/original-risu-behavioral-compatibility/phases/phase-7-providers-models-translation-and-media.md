# Phase 7 — Providers, Models, Translation, And Media

Status: Pending  
Depends on: Phases 1, 5-6

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
