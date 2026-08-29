# Phase 12: API Security, Runtime, And Observability

Status: Complete; depends on Phases 0-1 and consumes security seams from Phases
7, 10, and 11. Residual composition and capacity work is routed to Phases
13-14.

## Objective

Audit whether platform tests protect authentication, authorization, untrusted
network/input boundaries, resource budgets, lifecycle, tracing, redaction, and
operational behavior at the authoritative Fastify layer.

## Scope

- First-run/password/session authentication, agent bypass, expiration, active
  writer enforcement, and route protection.
- SSRF/proxy/hub/network binding, DNS/redirect handling, plugin egress, payload
  and decompression budgets, rate/body limits, abort, and backpressure.
- App composition, config/defaults, database guards, bootstrap/resources,
  static/SPA routes, index/startup/shutdown, timers/jobs, and missing state.
- Request history, trace IDs/bodies/sidecars, redaction, metrics, startup
  telemetry, logs, and error sanitization.
- Web Push and operational endpoints.
- Legacy storage/route behavior where platform compatibility is primary.

Primary discovery guide:
[`api-security-and-runtime.md`](../../../../docs/tests/api-security-and-runtime.md).

## Completed Audit Record

Phase 12 opened with 42 category-L owners / 432 cases / 81 parameterized rows:
21 frontend owners / 162 cases and 21 Fastify owners / 270 cases. The complete
review set now passes 173/173 frontend and 285/285 Fastify cases after 26
focused regressions in those owners. One eight-case echo compatibility owner
moved from L to G, leaving current L at 41 owners. The complete reviewed set
remains 42 owners / 458 cases.

### Route/platform contract and disposition map

| Contract family | Evidence and decision |
| --------------- | --------------------- |
| Authentication, configuration, and route policy | Keep. Layer helper/session tests, explicit `buildApp` configuration rejection, setup/login smoke, live route enumeration, unauthenticated denial, and independent literal auth/writer-exception allowlists. The development bypass is loopback-only and whitespace cannot initialize a password. |
| Agent data sandbox | Keep. Real SQLite/WAL/filesystem cases now reject canonical/symlink overlap and non-directory destinations and prove staged replacement cleanup and rollback. |
| Generic, plugin, Hub, and local-stream egress | Keep the distinct policy owners. Generic proxy breadth is an explicit authenticated self-host compatibility decision; permissioned plugin and local stream paths resolve all DNS answers, pin sockets, and revalidate redirects. |
| Browser local proxy and WebSocket protocol | Keep. HTTP(S)-only classification, strict discriminated-frame parsing, cancellation/close DELETE propagation, and pre-/post-header failure behavior protect browser-owned lifecycle gaps. |
| Request/decompression/output/storage budgets | Keep. Request body and inflate owners are complemented by bounded legacy SSE writes, a 32 MiB buffered completion limit, direct inactivity and one-hour absolute job timers, and a 16 MiB durable terminal snapshot cap. |
| Import request abort | Strengthen, then Keep under the Phase 11 asset owners. Request abort now reaches post-upload decode/staging and rechecks after the safety backup but before destructive replacement. |
| Tracing, startup telemetry, and diagnostics | Keep. Redaction, omission, byte/cardinality caps, disk retention, sidecar cleanup, browser queueing, and Fastify ingestion provide distinct no-secret and operational evidence. |
| Startup, shutdown, static, polyfill, UUID, and source-map surfaces | Keep. Utility, process-signal, Fastify composition, and built-browser layers fail for different deployment and compatibility defects. |
| Web Push, notifications, service worker, retry, and teardown | Keep. Server send/prune, browser durable retry, service-worker messaging, setting synchronization, and teardown own distinct lifecycle transitions. |
| `server/fastify/__tests__/echo.test.ts` | Reclassify unchanged from L to G. Its dominant contract is legacy generation/provider completion compatibility rather than general runtime composition. |

### Security denial and observability coverage map

- Authentication denial proves no protected handler/forwarder work and pins
  every public/conditional auth and mutating writer exception independently of
  the production manifest.
- Loopback-bypass denial runs before Fastify, SQLite, or data-directory side
  effects; sandbox denial preserves the source and prior destination.
- Permissioned/local egress denial proves no public or mixed DNS answer,
  redirect pivot, caller credential, malformed client frame, or abandoned job
  crosses its policy boundary.
- Oversized/slow output proof asserts upstream abort and no overflow-token,
  replay, disk snapshot, aggregate memory, or client-message side effect.
- Import abort proof preserves live data and does not create a safety backup
  when already cancelled; route cleanup owns temp/staged artifacts.
- Trace and telemetry sentinels prove credentials/content are redacted or
  omitted and retention remains byte/cardinality bounded.

### Defense-in-depth rationale

Unit classifiers and parsers localize malformed input; Fastify injection proves
auth, route, and storage ordering; local live sockets prove DNS pinning,
redirects, backpressure, and close behavior; built Chromium proves the shipped
SPA reconnects to these runtime contracts. These layers are retained because
their failure modes are not equivalent. The audit found no pair satisfying the
mandatory merge/removal proof.

### Count and residual record

- Added 30 cases repository-wide during Phase 12 and retained 700 live owners.
  The final universe is 10,200 cases, one direct-only skip, and 1,326
  parameterized rows.
- Current categories are A=21, B=39, C=62, D=111, E=101, F=84, G=109, H=26,
  I=39, J=42, K=25, and L=41.
- Live decisions are 617 Keep and 83 Reclassify; no owner remains Pending.
  Support ownership remains 252 standalone and 64 mixed production seams.
- No unresolved confirmed Critical/High security or secret-exposure finding
  remains. Phase 13 owns large import/export materialization, absolute response
  budgets, structural route capture where practical, real browser/MCP/provider
  composition, and cross-suite consolidation. Phase 14 owns final historical,
  cross-browser/live-service, and residual-support verdicts.

## Audit Questions

- Do denial tests prove parsing, transport, storage, and side effects never
  occurred?
- Are malformed auth/session/key/algorithm/identity and writer cases broad
  enough to catch realistic bypasses?
- Do SSRF and network tests cover resolved addresses, redirects, numeric/encoded
  forms, site-owned/private targets, caps, abort, and socket validation without
  copying the production classifier?
- Are trace/history/log tests sensitive to secret or body leakage and cleanup?
- Do startup/shutdown tests expose leaked workers, timers, sockets, temp files,
  or incomplete jobs?
- Are smoke/static/echo/token tests meaningful health boundaries or mere
  execution checks?

## Required Outputs

- Route/platform contract and disposition map.
- Security denial/no-side-effect and observability-redaction coverage map.
- Findings for allow-by-default behavior, weak malformed-input matrices,
  self-copied classifiers, leakage, lifecycle cleanup, obsolete routes, and
  health tests without meaningful assertions.
- Explicit defense-in-depth rationale for overlapping unit, inject, live-server,
  and browser smoke tests.

## Exit Criteria

- Every Phase 12 test has a disposition and supported platform/security owner.
- Unique auth, authorization, egress, cap, redaction, lifecycle, and operational
  behavior remains protected.
- All Critical/High security or secret-exposure findings are resolved.
- Obsolete legacy routes/tests have an explicit compatibility decision.
- Count deltas and residual live-network/browser gaps are recorded.

All exit criteria are satisfied. Confirmed high-risk bypass, sandbox, egress,
abort, output, lifetime, and snapshot defects are fixed; residual fidelity and
capacity claims have named later-phase owners and concrete revisit conditions.

## Validation

- Focused Fastify platform/security/runtime tests
- Focused client network/push/trace consumers where affected
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:server`
- `pnpm check:server`
- Relevant browser smoke and startup matrices
- Isolated deadline/load/backpressure tests with documented worker limits
- `pnpm test:all` for app/config/runner/CI changes
- `pnpm format:check`
- `git diff --check`

The exact owner runs, complete frontend/Fastify lanes, focused budget and
lifecycle matrices, client/server typechecks, all 35 Chromium smoke journeys,
affected selection, inventories, formatting, and diff checks are recorded in
[`latest-verification.md`](../latest-verification.md).
