# Phase 12 — Runtime, Platform, Limits, And Diagnostics

Status: Complete
Depends on: Phases 1-11

## Objective

Verify shared runtime behavior and visible platform boundaries across auth and
writer policy, browser/server environment changes, network behavior, limits,
diagnostics, startup/shutdown, trace safety, and retained Web Push behavior.

## Audit Questions

- Do browser/server authority changes preserve observable success, rejection,
  retry, timeout, offline, and reconnect behavior?
- Are auth/writer/session rules explicit and do they avoid silent loss when the
  wrong client attempts a mutation?
- Are size, count, time, concurrency, and payload limits compatible or visibly
  diagnosed before partial mutation?
- Do startup, migration, shutdown, crash, and restart preserve/reconcile durable
  state and pending work?
- Are logs, traces, diagnostics, health, and error responses useful without
  exposing credentials, prompt contents, private assets, or unsupported internals?
- Is retained Push subscription/delivery behavior compatible, with platform-only
  exclusions explicit?

## Required Outputs

- Platform/auth/writer/limit/error/diagnostic vocabulary classification.
- Deterministic network, timeout, oversize, concurrency, startup/shutdown, and
  restart fault cases.
- Unsupported platform matrix with visible UI/API diagnostics.
- Trace/log redaction and production-bundle negative tests.
- Push lifecycle evidence where retained; standing no-port evidence elsewhere.

## Exit Criteria

- Runtime/platform differences are behaviorally compatible or individually
  signed and visible.
- Limits and authority rejection cannot cause silent partial mutation or paid
  side effects.
- Startup/shutdown/restart and diagnostics meet recovery and secrecy contracts.
- Focused runtime/platform/security/recovery and compatibility lanes pass.

## Validation

Run in-process runtime and fault tests, startup/shutdown/restart cases,
redaction/production-bundle checks, selected browser journeys, affected and
compatibility lanes, formatting, and `git diff --check`.

## Completion Record

- `1430b714855f4df208a07f54df4653a681a04351` closes the exact route
  method/path/auth/writer/streaming policies, 15 rate-limit declarations, shared
  byte/count/time/concurrency bounds, 19 startup steps, five readiness
  capabilities, trace/history/startup/generation diagnostics, nine baseline
  runtime features, and Web Push browser/server lifecycle owners.
- `8820b3e8c2cd1452b155b56167c66292e3029cdf` moves Push mutation auth
  ahead of parsing, caps POST/DELETE bodies at 16 KiB, accepts only bounded
  credential-free HTTPS endpoints/keys, gives delivery a 10-second socket
  timeout, and adds persisted fallback-session/VAPID/subscription reopen proof.
- `140c04d24724fcb09cef9ad57fd38bcc976054f6` pins four individually
  authorized no-port products without broadening them: native wrapper runtimes,
  PeerJS rooms, Risu Account/Drive cloud sync, and standalone browser-local
  authoritative persistence. Responsive mobile web, command/SSE sync,
  server/portable backups, scoped browser recovery/cache state, PWA
  presentation, and Web Push remain explicitly supported.
- `ORC-DECISION-068` through `ORC-DECISION-071` reconstruct the exact RH+
  sources for those four cohesive boundaries. The later archived umbrella is
  only standing guidance and is not used as decision authority.
- Category L rows `ORC-SURFACE-125` through `ORC-SURFACE-134` own route policy,
  limits, lifecycle/recovery, diagnostics, supported environments, Push, and the
  four signed no-port products. Category L is 10/10 verified, the total
  inventory is 134 rows, and all 71 decisions are signed.

## Completion Validation

| Check | Result |
| --- | --- |
| Phase 12 structural and no-port gate | Passed; 1 file and 4 tests. |
| Focused auth/Push/structure selection | Passed; 3 files and 24 tests before the no-port assertion; the 4-test structural file passed again afterward. |
| Expanded Fastify runtime/diagnostic selection | Passed; 6 files and 54 tests. |
| Browser platform/diagnostic selection | Passed; 6 files and 57 tests. |
| `pnpm check` | Passed with 0 errors and 0 warnings. |
| `pnpm check:server` | Passed protocol, client declarations, Fastify, and browser-smoke typechecks. |
| Register gates | Passed with 134 surfaces, 71 signed decisions, 15 findings, and all historical raw mappings. |
| Prettier and `git diff --check` | Passed for Phase 12 implementation, evidence, and closure files. |

External Push provider/OS display remains mocked, and normal CI cannot prove
third-party availability. Two stale Korean Drive strings have no non-language
consumer; the signed cloud-sync boundary is enforced by absent modules,
controls, worker, dependency, and authority branches rather than by deleting
historical localization text.
