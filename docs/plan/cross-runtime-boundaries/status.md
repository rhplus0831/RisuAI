# Cross-Runtime Boundaries Status

Date: 2026-08-31

Status: complete and ready for archival.

## Final State

- All seven phases are complete.
- The checked cross-runtime inventory contains zero production, server-test,
  browser-smoke, runtime/mixed, non-literal, and project-reference edges.
- Shared wire contracts live under `@risuai/protocol`; audited framework-neutral
  behavior lives under `@risuai/shared-core`; host, security, persistence, and
  command policy remain Fastify-owned.
- `pnpm check:server` checks protocol, shared-core, and the architecture
  inventories before directly typechecking Fastify and browser-smoke projects.
  It does not generate or consume browser application declarations.
- No retained cross-runtime exception remains. Historical compatibility
  fixtures and browser/resource ownership are tracked by Workstreams 2 and 3,
  not by this closed import boundary.

## Closing Cursors

| Boundary | Closing evidence |
| --- | --- |
| Protocol and route-operation ownership | `33d1643ae`, `00e49d880`, `3f275e9dc`, `6a6d0ac1f` |
| Audited shared-core foundation and leaves | `d798740f7` through CBS/parser ownership at `18031f9c3` |
| Final browser/Fastify consumer decoupling | `18031f9c3` |
| Declaration-project removal | `ba7f95c09` |
| Independent strict downstream type fixes | `831361daa` |
| Zero-edge baseline and closed gates | `281d0e9f7` |
| Current architecture documentation | `d9b1f8633` |

## Phase Router

| Phase | Status |
| ---: | --- |
| 0. Boundary inventory and gates | Complete |
| 1. Protocol contract completion | Complete |
| 2. Route operation and policy catalog | Complete |
| 3. Pure shared core | Complete |
| 4. Server consumer migration | Complete |
| 5. Browser adapter migration | Complete |
| 6. Typecheck/package decoupling | Complete |
| 7. Verification and closeout | Complete |

## Handoff

Workstream 2 may continue canonical-owner, repair-boundary, and interchange
closure without a cross-runtime import prerequisite. Workstream 3 may continue
client owner cutovers without retaining a browser declaration path for Fastify.
The remaining compatibility and client-resource inventories are owned by their
respective active plans.
