# Phase 10 — Plugins, Modules, MCP, And Specialized Tools

Status: Complete
Depends on: Phases 1, 3, 5-9

## Objective

Verify retained extension data, module/plugin import and storage, exposed APIs,
permissions, sandboxing, MCP/OAuth/tool lifecycles, and specialized integrations
while keeping standing no-port boundaries explicit.

## Audit Questions

- Do retained module/plugin artifacts preserve bytes, metadata, enablement,
  ordering, configuration, and references through import/reload/export?
- Are host APIs and events compatible where promised, with explicit browser- or
  server-only boundaries?
- Are permissions, secrets, network/file access, OAuth state, and tool arguments
  scoped and diagnosed correctly?
- Do install/enable/disable/update/remove and tool-call success/failure/cancel
  produce atomic state and visible outcomes?
- Can unsupported legacy extension behavior appear enabled, silently no-op, or
  partially mutate shared state?

## Required Outputs

- Closed-world extension type/API/event/permission/tool classification.
- Import/storage/reload/export fixtures linked to Phase 11.
- Sandbox, permission, OAuth, secret, tool-call, and lifecycle integration cases.
- Explicit unsupported/no-port controls and diagnostic tests.
- Findings/decisions for APIs whose physical browser authority moved server-side.

## Exit Criteria

- Every retained extension surface has data, lifecycle, authority, permission,
  failure, and interoperability ownership.
- Unsupported behavior is absent or explicit and cannot silently act partially.
- Secret/sandbox boundaries pass adversarial negative cases.
- Focused extension/MCP/tool, security, round-trip, and compatibility lanes pass.

## Validation

Run extension lifecycle and API fixtures, sandbox/permission/secret negative
tests, tool/OAuth integration tests without live services where possible,
affected and compatibility lanes, formatting, and `git diff --check`.

## Completion Record

- `e8bbbeea6ad400234aa4d0abad330356265c3c23` closes the exact 85-key
  Plugin V3 direct API, nine permissions, four runtime phases, seven RPC message
  types, V3-only browser/server gate, and iframe CSP boundary.
- The same structural owner closes all seven module activation sources and the
  create/import/edit/enable/reorder/select/delete/reload/export lifecycle, four
  MCP identifier classes, six internal clients, duplicate/call-only/cancel
  rules, OAuth refresh, DNS-pinned egress, and every specialized/Risu-access
  advertised tool.
- `397e06c67694f59d96a087ea1974802e5e0bd4c6` rejects partial or
  unbounded Dice notation, bounds GraphMem traversal and refuses to overwrite
  malformed durable graph state, and replaces the file-system client's
  reference to an unadvertised recovery tool with an actual initialization
  path.
- Historical `ORC-SURFACE-062` is independently re-verified against module
  picker/editor owners and remains governed by signed `ORC-DECISION-058`.
  Character/module conversion, CharX module import, and conversion controls are
  absent while `.risum` import/export remains retained.
- Category J rows `ORC-SURFACE-118` through `ORC-SURFACE-121` own Plugin V3,
  module lifecycle, MCP/OAuth, and specialized-tool surfaces. Category J is 5/5
  verified and the total inventory is 121 rows.

## Completion Validation

| Check | Result |
| --- | --- |
| Phase 10 structural gate | Passed; 1 file and 4 tests. |
| Specialized-tool and file-system regressions | Passed; 2 files and 12 tests. |
| Broad browser Plugin/module/MCP lane | Passed; 23 files and 426 tests. |
| Broad Fastify command/module/plugin-network/OAuth lane | Passed; 7 files and 308 tests. |
| `pnpm check` | Passed with 0 errors and 0 warnings. |
| `pnpm check:server` | Passed protocol, client declarations, Fastify, and browser-smoke typechecks. |
| Register gates | Passed with 121 surfaces, 67 signed decisions, 15 findings, and 12 fail-closed validator tests. |
| Prettier and `git diff --check` | Passed for Phase 10 implementation, evidence, and closure files. |

Deterministic tests own the trusted Plugin V3/CSP boundary, module lifecycle,
MCP protocol/egress seams, and specialized-tool authority. Normal CI does not
execute hostile third-party plugin code, a real remote OAuth MCP server, paid
services, or an operating-system directory picker; those explicit residuals do
not weaken the closed catalogs or mutation/failure contracts.
