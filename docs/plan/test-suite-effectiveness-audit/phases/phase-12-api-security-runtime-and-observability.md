# Phase 12: API Security, Runtime, And Observability

Status: Pending; depends on Phases 0-1 and consumes security seams from Phases
7, 10, and 11.

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
[`api-security-and-runtime.md`](../../../tests/api-security-and-runtime.md).

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
