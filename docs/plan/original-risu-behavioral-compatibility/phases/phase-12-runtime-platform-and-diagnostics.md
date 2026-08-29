# Phase 12 — Runtime, Platform, Limits, And Diagnostics

Status: Pending  
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
