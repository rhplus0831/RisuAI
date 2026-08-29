# Phase 10 — Plugins, Modules, MCP, And Specialized Tools

Status: Pending  
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
