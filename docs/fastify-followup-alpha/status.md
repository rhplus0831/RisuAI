# Fastify Follow-Up Alpha Status

Date: 2026-05-27

This is the live handoff for the second audit pass over Fastify Phases
0-9. The previous `docs/fastify-followup/` closeout still records landed
work, but this alpha track reopens the findings below for task agents.

Policy note: there are no actual Fastify users yet, so do not add
compatibility migrations for intermediate Fastify shapes. Update the
current server schema, command surface, and import/export paths directly.

## Current Snapshot

- Active work: Phases 3, 6, 8, and 9 have reopened findings.
- No follow-up found in this audit: Phases 0, 1, 2, 4, 5, and 7.
- Next default pickup: Phase 9 projection-write blockers, then Phase 6
  unterminated stream handling. Phase 3 and Phase 8 can proceed in
  parallel if agents are available.
- Closeout rule: keep this file to the current snapshot. Put landed
  slice detail under `phases-completed/` and keep focused scope,
  boundaries, and exit criteria under `phases/`.

## Reopened Findings

| Phase | State | Finding | Task Doc |
| ----- | ----- | ------- | -------- |
| 0 - Removals | No follow-up | Google Drive public artifact removal still appears complete. | None |
| 1 - Foundation | No follow-up | Fastify foundation shape still matches the phase goals. | None |
| 2 - Storage / import / assets / backups | No follow-up | Baseline storage, import, asset, backup, and static route work still appears complete. | None |
| 3 - Proxy migration | Reopened | Hub passthrough does not use the documented Phase 3 response-header strip set. | [`phases/phase-3-proxy-followup-alpha.md`](phases/phase-3-proxy-followup-alpha.md) |
| 4 - sendChat tests | No follow-up | Fixture harness and coverage inventory still appear complete. | None |
| 5 - sendChat extraction | No follow-up | Browser extraction baseline still appears complete. | None |
| 6 - Server-side generation | Reopened | Unterminated provider SSE tails can still become successful `done` streams. | [`phases/phase-6-generation-followup-alpha.md`](phases/phase-6-generation-followup-alpha.md) |
| 7 - Server-side prompt assembly | No follow-up | Regenerate, provider guards, stop-trigger payloads, and route-backed fixture coverage still appear complete. | None |
| 8 - Hypa V3 memory | Reopened | Memory event subscriber failures can break committed memory work. | [`phases/phase-8-memory-followup-alpha.md`](phases/phase-8-memory-followup-alpha.md) |
| 9 - Client thinning | Reopened | Reachable UI paths still mutate projection state or aliases before command dispatch. | [`phases/phase-9-client-thinning-followup-alpha.md`](phases/phase-9-client-thinning-followup-alpha.md) |

## Verification From Audit

The audit used subagents for Phases 0-2, 3-6, 7, 8, and 9, then
locally checked the critical findings. The Fastify API suite passed in
subagent runs, focused Phase 7/8/9 suites passed, `pnpm build` passed,
and `pnpm smoke:fastify-browser` passed. Those suites do not currently
cover the reopened failure paths in this alpha handoff.

## Closeout Expectations

- Each reopened phase must include focused regression tests for the
  finding it fixes.
- Broad closeout should run `pnpm check`, `pnpm test`, `pnpm api:test`,
  and `pnpm build` unless a narrower change has explicit owner approval
  to defer the full matrix.
- Re-run `pnpm smoke:fastify-browser` before closing Phase 9 projection
  work or any future browser projection sweep.
