# Phase 10: Plugins, Modules, MCP, And Specialized Tools

Status: Pending; depends on Phases 0-1, Phase 7 provider/security findings, and
Phase 9 interpreter boundaries.

## Objective

Audit whether extensibility and specialized-tool tests protect permission,
sandbox, network, OAuth/tool, module lifecycle, and user-visible execution
boundaries without relying on permissive mocks or obsolete developer surfaces.

## Scope

- Plugin APIs, installation/update planning, permissions, development mode,
  storage, icons, network access, sandbox/safety, and lifecycle cleanup.
- Module activation, ordering, dependencies, settings, chat association,
  optimistic projection, and RisuAccess resources.
- MCP clients/transports, internal clients, OAuth refresh, filesystem/network
  boundaries, tool schemas/results, and connection cleanup.
- Playground execution, conversion, parser/tokenizer helpers, image/embedding/
  subtitle/transcription tools, inlay explorer, Iris, and DevTool import.
- Specialized network/proxy helpers only where the primary contract belongs to
  an extension/tool; authoritative server egress belongs to Phase 12.

Primary discovery guides:

- [`plugins-modules-and-mcp.md`](../../../tests/plugins-modules-and-mcp.md)
- [`playground-and-specialized-tools.md`](../../../tests/playground-and-specialized-tools.md)

## Audit Questions

- Do permission-denial tests prove no transport or side effect occurred?
- Are grants bound to stable plugin/module/tool identity and snapshotted intent?
- Do network and filesystem fakes preserve authoritative restrictions, redirects,
  caps, abort, cleanup, and hostile target behavior?
- Are OAuth/tool schemas and result handling validated independently from the
  mocks that produce them?
- Which developer/specialized surfaces are current, opt-in, or obsolete?
- Do UI tests prove visible success/failure and cleanup, not only service calls?

## Required Outputs

- Extension/tool capability and disposition matrix.
- Permission/egress/sandbox defense-in-depth map across client, server, and UI.
- Findings for permissive mocks, obsolete tools, untested denial side effects,
  leaked connections/resources, duplicate module matrices, and weak visible
  outcomes.
- Explicit product-support decision before removing compatibility or developer
  tool coverage.

## Exit Criteria

- Every Phase 10 test has a disposition and supported extension/tool contract.
- Unique permission, sandbox, OAuth, tool, module lifecycle, and cleanup behavior
  remains protected.
- Critical/High security findings are resolved before phase closeout.
- Removed opt-in/legacy tests have explicit reachability/support evidence.
- Count deltas and residual live-integration risks are recorded.

## Validation

- Focused frontend plugin/module/MCP/Playground/tool tests
- Focused Fastify plugin/MCP/network/route tests
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm test:server`
- Relevant browser smoke for visible extension/tool behavior
- `pnpm check` and `pnpm check:server`
- `pnpm format:check`
- `git diff --check`
