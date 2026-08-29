# Phase 10: Plugins, Modules, MCP, And Specialized Tools

Status: Complete on 2026-08-29; Phases 0-1, Phase 7 provider/security findings,
and Phase 9 interpreter boundaries satisfied.

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

- [`plugins-modules-and-mcp.md`](../../../../docs/tests/plugins-modules-and-mcp.md)
- [`playground-and-specialized-tools.md`](../../../../docs/tests/playground-and-specialized-tools.md)

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

## Completed Audit Record

Phase 10 opened with 47 category-J owners and 601 cases, including 47
parameterized rows: 42 frontend owners / 528 cases and five Fastify owners / 73
cases. Both frozen opening sets passed before remediation. Eighteen regressions
were added inside opening owners, and the exact reviewed set then passed 546/546
frontend and 73/73 Fastify cases.

Five unchanged owners / 39 cases were reclassified to B/C/G/K after complete
review. The current J set is 42 owners / 580 cases / 51 parameterized rows: 38
frontend owners / 521 cases and four Fastify owners / 59 cases. There is no
built-browser J owner.

### Extension And Tool Contract Map

| Boundary | Current evidence and protected contract | Disposition |
| --- | --- | --- |
| Plugin permissions and lifecycle | Stable script/capability identity, denial without transport, sandbox RPC, timers/listeners/registrations, unload and hot reload | Keep; delayed keyboard callbacks fixed |
| Plugin network/update/import | Client preflight, permission snapshots, HTTPS/update caps, server DNS/redirect/body enforcement, durable import rollback | Keep layered evidence; Chromium icon suspicion closed |
| Module lifecycle | Import staging, activation/namespace/order, commands, memoization, chat/persona association, optimistic state | Keep; in-place identity invalidation fixed |
| RisuAccess | Schema/read/pagination plus permissioned character/module lore, regex, Lua, info, projection and rollback | Keep; stable post-confirmation owner fences added |
| MCP transports and OAuth | HTTP/SSE/custom transport, body/frame/page budgets, OAuth/session recovery, registry identity and cleanup | Keep; deadline/framing/pagination gaps fixed |
| Internal clients | Mutation-safe catalogs, filesystem/media bounds, credential boundaries and supported operations | Keep; unsupported watch advertisement removed |
| Playground and specialized UI | Stable inputs/targets, visible success/failure, partial results, retry, cancellation, asset/media cleanup | Keep distinct UI/service owners; image teardown fixed |
| Extension-adjacent browser/provider/assets | Draft recovery, command range, provider response/dashboard, save/asset analysis | Reclassify five owners to B/C/G/K with J seams |

No owner met the mandatory merge or removal proof. Sandbox, permission,
transport, durable command, mounted UI, and authoritative Fastify layers share
extension vocabulary but catch different failures.

### Findings And Remediation

- `TSA-P10-001` cancels delayed Plugin V3 keyboard callbacks during explicit
  removal and lifecycle cleanup.
- `TSA-P10-002` bounds JSON bodies and prompt/tool pagination, parses standard
  SSE line forms, and turns malformed frames into deterministic errors.
- `TSA-P10-003` fences permission-delayed RisuAccess mutations to the exact
  current row; `TSA-P10-004` invalidates module activation memoization on
  in-place ID/namespace edits.
- `TSA-P10-005` aborts image translation on unmount and fences late feedback;
  `TSA-P10-006` removes the unsupported filesystem watch advertisement.
- `TSA-P10-007` records all five B/C/G/K routing corrections;
  `TSA-P10-008` and `TSA-P10-009` preserve intentional plugin and specialized
  UI/service defense in depth. `TSA-P10-010` updates the discovery guidance.

`TSA-P10-011` bounds uploaded-asset cleanup, plugin proxy threat modeling,
independent MCP/OAuth interoperability, real browser filesystem/canvas/codec
behavior, support policy, and historical compatibility. Phases 11-14 own those
explicit residuals.

### Validation Summary

The complete ordinary frontend universe passed 6,759/6,759; the two isolated
performance owners passed 6/6. Complete Fastify passed 3,351 cases with one
intentional direct-only Realm scale skip. The exact reviewed opening set passed
619/619 cases after remediation. Focused plugin, module, RisuAccess, MCP,
filesystem, Playground, routing, and real-Chromium icon probes also passed.

Client and server typechecks, affected selection, linked inventories,
formatting, and diff checks passed. The production smoke build passed with the
existing allowed diagnostics and all 35/35 Chromium journeys passed. Because
no J browser owner executes a real plugin iframe, MCP server, filesystem
permission, or canvas/media workflow, smoke remains application/lazy-route
evidence rather than full extension/tool interoperability proof.

Current-only compatibility passed 18/18. Full differential compatibility is
blocked by the absent exact pinned worktree; no substitute checkout or golden
refresh was used.

Fresh lists and measured results record 700 live owners and 10,152 cases with
one direct-only skip and 1,314 parameterized rows. Live decisions are 563 Keep,
67 Reclassify, and 70 Pending. No test owner, fixture, or golden was removed.
