# Phase 7: Providers, Models, Credentials, Translation, And Media

Status: Complete on 2026-08-29; Phases 0-1 and 6 satisfied.

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

## Completed Audit Record

Phase 7 opened with 103 category-G owners and 1,395 cases: 60 frontend
owners / 542 cases and 43 Fastify owners / 853 cases. The frozen opening set
passed before remediation. Fourteen regression cases were added, and the exact
opening set then passed 544/544 frontend cases and 864/864 Fastify cases.

Eight provider-adjacent owners and 69 cases were reclassified to D/E/F after
their complete case families were reviewed. Eight owners entering G from
Phases 4 and 6 retain those earlier complete dispositions. The current G set is
95 owners / 1,339 cases / 249 parameterized rows: 37 frontend Node owners / 323
cases, one Svelte+Node owner / 23 cases, 14 DOM owners / 129 cases, and 43
Fastify owners / 864 cases. There is no built-browser G owner.

### Provider Contract And Disposition Matrix

| Provider or owner family | Protected contract | Disposition and evidence |
| --- | --- | --- |
| OpenAI chat, completion, Responses, compatible, and legacy instruct | Canonical auth, exact endpoint identity, body/options, content blocks, SSE and terminal errors | Keep. Header-case injection and exact Responses endpoint loss are fixed with route and adapter counterexamples. |
| Anthropic | Native block conversion, attachment/cache order, options, streaming and errors | Keep. Client conversion and Fastify adapter evidence remain distinct. |
| AWS Bedrock and SigV4 | Canonical request, credential scope, signed headers, exact signature, stream/error translation | Keep. The canonical signature is pinned independently and whitespace canonicalization is covered. |
| Gemini, Google, and Vertex | Native multimodal parts, model/options, SSE events, error and terminal semantics | Keep. A 200 SSE error frame now terminates as an error rather than success. |
| Cohere, Mistral, OpenRouter, NanoGPT, and compatible catalogs | Provider-specific request/options, model identity, catalogs, free-model routing, and errors | Keep. Catalog and dispatch companions protect different boundaries. |
| Ooba, Ollama, Kobold, and local-compatible transports | Custom/local URL normalization, request shaping, stream parsing, abort, and capability policy | Keep. Ooba path normalization no longer mutates `api.*` hostnames. Structured/multimodal Ollama support remains an explicit product-policy residual. |
| Horde | Async submission, bounded polling, status/error propagation, cancellation, and cleanup | Keep. Non-OK polls now fail and cancel the remote job. |
| Profiles, roles, tokenizer, JSON controls, additional parameters, and capabilities | Stable provider/profile identity and independently observable request behavior | Keep, including eight earlier reclassifications into G. Copied-option drift is bounded by effective-request assertions. |
| Translation | Eligibility, presets, HTML/bilingual pipelines, cache identity, profile options, raw/server translation, and errors | Keep. Profile runtime options now propagate and participate in cache identity. |
| Image generation | Closed provider input, endpoint/credential binding, response decoding, polling, and size/content constraints | Keep. Stored NovelAI credentials are restricted to the official HTTPS origin. |
| TTS, audio, transcription, codecs, and Strip CoT | Credentialed synthesis, media request encoding, browser audio lifecycle, native codec shaping, and reasoning removal | Keep. VOICEVOX query values are encoded; browser playback remains simulated at unit level. |
| Request history and credential projection | Masked identity, nested metadata/error redaction, route projection, retention, and delete behavior | Keep. Provider-option secrets are redacted before SQLite persistence. |

No complete owner met the removal or merge proof. Similar provider vocabulary
does not establish overlap: client conversion, Fastify dispatch, credential
resolution, route projection, media consumption, and browser playback fail at
different boundaries.

### Credential Flow Map

| Source | Resolution and endpoint rule | Transport | Trace/history/projection rule |
| --- | --- | --- | --- |
| Stored global or profile credential | Fastify resolves the stable credential reference; provider adapters choose an allowlisted or persisted compatible endpoint | Canonical provider header is set after caller overlays | Raw values stay server-side and are redacted recursively from history metadata, responses, and errors |
| Masked browser placeholder | Parsed as a stored-reference request, never as an inline secret | Server-owned provider/image/TTS operations attach the resolved value | Browser projections retain only masked/stable identity |
| Explicit draft credential | Validated as request-scoped input and paired with the caller-selected compatible endpoint | Used only for that operation | Known values are included in the history redaction set and are not returned as configuration |
| Stored NovelAI image credential | Accepted only for exact `https://image.novelai.net` identity | Attached to the official request | Custom endpoints require an explicit draft credential |
| OAuth/provider refresh material | Server resolver owns refresh and provider identity | Refreshed token is attached at the provider boundary | Token/error fields follow sensitive-key and known-value redaction |
| Credential-free local/media request | URL is normalized without introducing credentials; VOICEVOX values use `URLSearchParams` | Direct local request with abort ownership | No secret projection claim; URL/media browser fidelity remains bounded |

### Findings, Routing, And Residuals

`TSA-P07-001` through `TSA-P07-010` close the demonstrated auth, endpoint,
stream, translation/cache, request-history, NovelAI, VOICEVOX, Horde, and SigV4
defects. `TSA-P07-011` records the eight D/E/F routing corrections, and
`TSA-P07-012` records the retained defense-in-depth layers.

`TSA-P07-013` explicitly bounds the missing recorded/live provider canary,
full stored-credential browser journey, real media-device/browser proof,
Ollama structured/multimodal support decision, and historical transport
comparison. Phase 12 owns credential/runtime observability, Phase 13 owns
bounded cross-layer composition, and Phase 14 must make the final residual and
compatibility decision. The exact pinned compatibility worktree is absent; no
substitute checkout or golden refresh was used.

### Validation Summary

The complete ordinary frontend universe passed 6,713/6,713 across 537 files;
the two isolated performance owners passed 6/6. Complete Fastify passed 3,329
cases with one intentional direct-only Realm scale skip across 154 files.
The production smoke build passed with the existing allowed diagnostics and
all 35/35 Chromium journeys passed; none is represented as provider or media
browser proof.

Both client and server typechecks passed after an initially untyped NovelAI
fetch spy was corrected. Affected selection chose inventories, frontend,
performance, Fastify, and smoke. Inventory, formatting, and diff gates passed.
Fresh lists and measured results record 700 live owners and 10,084 cases with
one direct-only skip and 1,287 parameterized rows. Live decisions are 457 Keep,
41 Reclassify, and 202 Pending.
