# Deferred Features Progress

Date started: 2026-06-25.

This document tracks remediation and decisions for the items catalogued in
`docs/deferred-features.md`.

## Workflow States

- `Pending`: not started.
- `Needs decision`: product/owner decision is needed before implementation.
- `Exploring`: explorer agent is examining the area.
- `Ready`: explorer findings are available for implementation.
- `Deferred`: owner decided not to change this now; revisit later if priorities change.
- `Implementing`: implementation worker is applying the fix.
- `Verifying`: verification worker is validating the result.
- `Fixed`: verification passed and the fix was committed.
- `Blocked`: work cannot continue without a decision or external change.
- `Retired`: explicitly removed from the backlog after a no-action decision.
- `Documented`: retained as an intentional compatibility/no-port constraint.

## Actionable Items

| ID | Area | Status | Explorer | Implementation | Verification | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | Playground coming-soon tile | Ready | complete | pending | pending | - | Owner decision: remove the unnamed coming-soon tile from Playground. |
| A-02 | MCP module import/update | Deferred | complete | pending | pending | - | Owner decision: defer MCP-bearing module import/update; ordinary non-MCP `.risum` import is not blocked. |
| A-03 | Google Search MCP credentials | Deferred | complete | pending | pending | - | Owner decision: defer server-backed Google Search MCP credential storage. |
| A-04 | MCP risuaccess asset writes | Deferred | complete | pending | pending | - | Owner decision: defer MCP Risu-access asset reference edit/delete support. |
| A-05 | MCP result persistence | Deferred | complete | pending | pending | - | Owner decision: defer durable persistence for remote MCP tool result payloads. |
| A-06 | Plugin V3 write-only secrets | Ready | complete | pending | pending | - | Owner decision: implement write-only Plugin V3 secret header storage now. |
| A-07 | Slash/STScript command parity | Deferred | complete | pending | pending | - | Owner decision: defer `/setinput` and `/sendas` compatibility parity. |
| A-08 | Provider preview bodies | Ready | complete | pending | pending | - | Owner decision: implement server-side provider request-body preview now because the app is still in development. |
| A-09 | Completion provider coverage | Deferred | complete | pending | pending | - | Owner decision: defer additional completion providers until basic app usage is more stable. |
| A-10 | Completion streaming | Deferred | complete | pending | pending | - | Owner decision: defer direct completion streaming for buffered providers. |
| A-11 | Provider request-shape parity | Deferred | complete | pending | pending | - | Owner decision: defer for now while basic usage stabilizes, but keep high priority for advanced provider parity. |
| A-12 | Hosted model tools | Ready | complete | pending | pending | - | Owner decision: implement now; narrow OpenAI Responses hosted-tool plumbing, especially `search` -> `web_search_preview`. |
| A-13 | Logit bias | Deferred | complete | pending | pending | - | Owner decision: defer server-side support for Prompt Settings -> Others -> Bias / provider logit-bias payloads. |
| A-14 | Token and budget accuracy | Deferred | complete | pending | pending | - | Owner decision: defer for now, but keep high priority because inaccurate budgeting can affect large or multimodal prompts. |
| A-15 | CBS server adapter parity | Deferred | complete | pending | pending | - | Owner decision: defer for now, but keep high priority before expanding server-side CBS behavior. |
| A-16 | Trigger/Lua parity | Fixed | complete | complete | complete | 22f279590 | Server resend parity for `sendAIprompt`/`v2SendAIprompt` is implemented and verified; browser UI/persistent-resource effects, interactive Lua, and multimodal Lua LLM inputs remain unsupported. |
| A-17 | Cold storage | Deferred | complete | pending | pending | - | Owner decision: defer full cold storage; before production, implement import-only legacy support for existing users. |
| A-18 | Lorebook stubs validation | Deferred | complete | pending | pending | - | Owner decision: defer validation of the experimental lorebook stubs setting. |
| A-19 | Preset export parity | Deferred | complete | pending | pending | - | Owner decision: defer for now, but implement preset export for images/regexes before production. |
| A-20 | Popup CBS mode | Deferred | complete | pending | pending | - | Owner decision: defer for now, but keep high priority with broader CBS support work. |

## Conditional Or Metric-Gated Items

| ID | Area | Status | Explorer | Implementation | Verification | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C-01 | Durable generation restart survival | Retired | complete | not planned | not needed | - | Owner decision: do not support generation job survival across server restarts, including before production. |
| C-02 | Projection narrowing | Deferred | complete | pending | pending | - | Owner decision: defer until metrics show costly full-bootstrap fallbacks; medium priority optimization. |
| C-03 | Backup/export memory profile | Deferred | complete | pending | pending | - | Owner decision: defer until large-export memory pressure is observed; medium priority optimization. |
| C-04 | `.risu` remote/cache references | Deferred | complete | pending | pending | - | Owner decision: defer remote/cache reference hydration; low priority unless imports require it later. |
| C-05 | Local GGUF tokenization | Deferred | complete | pending | pending | - | Owner decision: defer with the same high priority as broader token/budget accuracy work if local model support returns. |

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
| D-01 | `.risum` import wording conflict | Deferred | complete | pending | pending | - | Owner decision: defer MCP-related `.risum` wording cleanup. |
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
