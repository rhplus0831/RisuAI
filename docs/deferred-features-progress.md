# Deferred Features Progress

Date started: 2026-06-25.

This document tracks remediation and decisions for the items catalogued in
`docs/deferred-features.md`.

## Workflow States

- `Pending`: not started.
- `Needs decision`: product/owner decision is needed before implementation.
- `Exploring`: explorer agent is examining the area.
- `Ready`: explorer findings are available for implementation.
- `Implementing`: implementation worker is applying the fix.
- `Verifying`: verification worker is validating the result.
- `Fixed`: verification passed and the fix was committed.
- `Blocked`: work cannot continue without a decision or external change.
- `Retired`: explicitly removed from the backlog after a no-action decision.
- `Documented`: retained as an intentional compatibility/no-port constraint.

## Actionable Items

| ID | Area | Status | Explorer | Implementation | Verification | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | Playground coming-soon tile | Needs decision | complete | pending | pending | - | UI stub exists, but the target feature is unnamed. |
| A-02 | MCP module import/update | Pending | complete | pending | pending | - | Needs a command-backed Fastify route for MCP-bearing modules; ordinary non-MCP `.risum` import is not blocked. |
| A-03 | Google Search MCP credentials | Pending | complete | pending | pending | - | Server-backed credential model is missing. |
| A-04 | MCP risuaccess asset writes | Pending | complete | pending | pending | - | Character asset reference edit/delete is unsupported in server-backed mode. |
| A-05 | MCP result persistence | Pending | complete | pending | pending | - | Remote MCP tool result payloads are not server-persisted. |
| A-06 | Plugin V3 write-only secrets | Pending | complete | pending | pending | - | `saveSecretHeader` is intentionally unavailable until write-only plugin secret storage exists. |
| A-07 | Slash/STScript command parity | Pending | complete | pending | pending | - | `/setinput` is not implemented; `/sendas` ignores sender name. |
| A-08 | Provider preview bodies | Needs decision | complete | pending | pending | - | Fastify mode disables browser-side provider dispatch, so preview-body support needs an owner decision. |
| A-09 | Completion provider coverage | Pending | complete | pending | pending | - | Add server adapters when new providers should be accepted by `/api/v1/generate/completion`. |
| A-10 | Completion streaming | Pending | complete | pending | pending | - | Streaming is rejected for buffered providers; some may remain buffered by design. |
| A-11 | Provider request-shape parity | Pending | complete | pending | pending | - | Server adapters omit richer request shapes such as tools/functions, multimodal parts, Gemini thinking config, and response schema. |
| A-12 | Hosted model tools | Pending | complete | pending | pending | - | `modelTools` reach the effective DB, but Fastify OpenAI Responses dispatch sends no hosted tool list. |
| A-13 | Logit bias | Pending | complete | pending | pending | - | Server chat assembly does not emit provider-level logit-bias rows. |
| A-14 | Token and budget accuracy | Pending | complete | pending | pending | - | Server token/preflight budgeting is text-only and omits provider-specific and multimodal accounting. |
| A-15 | CBS server adapter parity | Pending | complete | pending | pending | - | Server CBS avoids browser-only callbacks today; module/lorebook callbacks and model metadata are placeholders. |
| A-16 | Trigger/Lua parity | Pending | complete | pending | pending | - | Browser UI/persistent-resource effects no-op; interactive Lua and multimodal Lua LLM inputs are unsupported. |
| A-17 | Cold storage | Needs decision | complete | pending | pending | - | Legacy cold-storage creation/hydration is stubbed or blocked in server-backed web mode. |
| A-18 | Lorebook stubs validation | Pending | complete | pending | pending | - | Experimental setting warns that the full reader surface is not validated against stubs. |
| A-19 | Preset export parity | Pending | complete | pending | pending | - | Presets with images or regexes cannot be exported yet. |
| A-20 | Popup CBS mode | Needs decision | complete | pending | pending | - | CBS option is visible but disabled in Popup Editor. |

## Conditional Or Metric-Gated Items

| ID | Area | Status | Explorer | Implementation | Verification | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C-01 | Durable generation restart survival | Pending | complete | pending | pending | - | Persist job state/result only if restart survival becomes a release requirement. |
| C-02 | Projection narrowing | Pending | complete | pending | pending | - | Add targeted resource contracts only after diagnostics show costly full-bootstrap fallbacks. |
| C-03 | Backup/export memory profile | Pending | complete | pending | pending | - | Streaming `.risu` writer or File System Access API path needs evidence of large-export memory pressure. |
| C-04 | `.risu` remote/cache references | Pending | complete | pending | pending | - | Implement only if remote/cache reference hydration becomes a supported import target. |
| C-05 | Local GGUF tokenization | Needs decision | complete | pending | pending | - | Mostly relevant only if local model support returns to Fastify-backed web. |

## Compatibility And No-Port Constraints

| ID | Area | Status | Explorer | Implementation | Verification | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| N-01 | Fastify-only runtime scope | Documented | complete | not planned | not needed | - | Native/mobile wrappers, browser-local persistence, service workers, peer sync, Drive sync, and non-Fastify modes are not live. |
| N-02 | Server prompt assembly gates | Documented | complete | not planned | not needed | - | Group chat and Plugin V2 are no-port; non-vision caption/Lua parity can move to actionable items if product wants them. |
| N-03 | Browser/local providers | Documented | complete | not planned | not needed | - | NovelAI, NovelList, Ooba OpenAI-compatible, plugin providers, and WebLLM stay local/browser-only unless server ownership expands. |
| N-04 | Plugin execution | Documented | complete | not planned | not needed | - | Fastify stores plugin records/storage but does not execute browser plugin code; Plugin V2 edit/replacer hooks are no-port. |
| N-05 | Legacy plugin storage APIs | Documented | complete | not planned | not needed | - | Blocked or compatibility-mode-only in Fastify. |
| N-06 | Popup/default CBS primitives | Documented | complete | not planned | not needed | - | Default callbacks throw until an adapter injects real callbacks; server parity gaps are tracked by A-15. |
| N-07 | Generic internal MCP fallback | Documented | complete | not planned | not needed | - | Unknown internal MCP tool calls return a generic not-implemented message. |

## Docs Cleanup

| ID | Area | Status | Explorer | Implementation | Verification | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-01 | `.risum` import wording conflict | Pending | complete | pending | pending | - | Narrow `src/docs/client-runtime.md` wording to MCP-bearing `.risum` modules. |
| D-02 | UI stale-state audit findings | Documented | complete | not planned | not needed | - | Audit findings are historical because `docs/ui-flow-stale-state-audit-progress.md` marks all confirmed issues and risks fixed. |
| D-03 | Prompt-template phase TODOs | Documented | complete | not planned | not needed | - | Phase notes are historical; the current optional mirror cleanup is tracked separately as D-04. |
| D-04 | Prompt-template compatibility mirror | Pending | complete | pending | pending | - | Decide whether to remove or permanently document remaining `prompt_templates` compatibility writes. |
| D-05 | Model runtime-defaults placeholder | Pending | complete | pending | pending | - | Language string still says the full editor lands later, but the editor exists. |
| D-06 | External wiki WIP | Documented | complete | not planned | not needed | - | Docs-only marker, not a project feature TODO. |

## Update Rules

- Keep IDs stable. If an item splits, add a new suffixed ID and leave the old row
  pointing to the split.
- Move an item to `Fixed` only after focused verification passes and the fixing
  commit is known.
- Move an item to `Retired` only after an owner explicitly decides no action is
  needed.
- Keep `Documented` rows in this file so future deferred-feature sweeps do not
  rediscover them as fresh TODOs.
