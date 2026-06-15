# UI/UX Behavioral Audit — Results

Audit plan: [`docs/AUDIT-PLAN.md`](../AUDIT-PLAN.md).
Date: 2026-06-13. Tree: branch `fastify` at `35559c767`.

This audit measures **rendered-state divergence**: a user-driven transition that
leaves the painted DOM disagreeing with a *correct* store value. It is deliberately
distinct from the V2/V3/V4 stability audits, which verify the logic/store layer.
Logic/value bugs (where the store itself is wrong) are out of scope here and route to
the static-test track.

## Status

| Stage | State |
| --- | --- |
| Phase 0 proof slice (journeys 1–4) | **Done** |
| Phase 0 acceptance gate (Tier 1 **and** Tier 2) | **GREEN — proven** |
| Phase 1+ inventory gap analysis | **Done** — 7 areas, 1 confirmed finding ([`phase1-gap-analysis.md`](phase1-gap-analysis.md)) |
| Findings register | **1 confirmed (M) & FIXED, 2 routed off-audit, 7 verified-no-divergence** ([`findings-register.md`](findings-register.md)) |
| Remediation plan | Grouped by §5 family ([`remediation-plan.md`](remediation-plan.md)) |
| Visible State Contract graduation | See [`visible-state-contract-recommendation.md`](visible-state-contract-recommendation.md) |

### Headline finding — UIA-001 (M), FIXED

`DefaultChatScreen.svelte` crashed rendering an inactive character's greeting when that
character was still a *bootstrap shell* (`alternateGreetings.length` read with no shell
guard). The store was a correct lazy shell; the render assumed a complete character.
Reachable via the keyboard prev/next-char hotkey while a chat is open. Confirmed with a red
DOM repro (`src/lib/ChatScreens/DefaultChatScreen.shellGreeting.dom.test.ts`) and **fixed in
this audit**: the greeting block is now gated on `!isServerCharacterShell(currentCharacter)`,
and the repro stands as a green regression guarantee. The Phase 0 gate and all three Tier-2
journeys were re-verified green after the rebuild.

Per the plan, fan-out past Phase 0 was unblocked only after the gate went green on
both tiers.

## Deliverables produced

1. **DOM-oracle differential helper** — `src/lib/_audit/domStateOracle.ts`. A pure
   classifier (`classifyDifferential`) plus `data-risu-*` DOM readers, with no
   vitest/svelte/playwright imports so Tier 1 and Tier 2 share one oracle.
2. **Phase 0 tests** (journeys 1–4), committed with the inverse-fix proof
   ([`phase0-acceptance-gate.md`](phase0-acceptance-gate.md)):
   - Tier 1: `src/lib/_audit/phase0Journey4Grouping.dom.test.ts` (J4 grouped toggles),
     `src/lib/_audit/phase0Journey2TogglePaint.dom.test.ts` (J2 optimistic paint).
   - Tier 2: `server/fastify/browser-smoke/phase0VisibleState.spec.ts`
     (J1 chat-switch→picker, J2 settle, J3 GATE tab stability).
3. **Findings register** in the §7 format with severity tallies —
   [`findings-register.md`](findings-register.md).
4. **Remediation plan** grouped by §5 root family — [`remediation-plan.md`](remediation-plan.md).
5. **Visible State Test Contract graduation recommendation** —
   [`visible-state-contract-recommendation.md`](visible-state-contract-recommendation.md).

## How to run

```bash
# Tier 1 (happy-dom, ~20s each)
pnpm exec vitest run src/lib/_audit/phase0Journey4Grouping.dom.test.ts
pnpm exec vitest run src/lib/_audit/phase0Journey2TogglePaint.dom.test.ts

# Tier 2 (real Fastify-served browser). Build once with the smoke flag, then run.
pnpm exec cross-env VITE_FASTIFY_BROWSER_SMOKE=TRUE VITE_RISU_LEGAL_CONFIGURED=TRUE pnpm build:site
pnpm exec playwright test -c playwright.fastify-smoke.config.ts phase0VisibleState
```

## Method note (deviations, stated honestly)

- The plan's journey table lists **Journey 1 as Tier 1**. It is implemented at **Tier 2**
  because the measured transition (click chat row → `navigate` → `applyRouteToStores` →
  `changeChatTo` → controls repaint) cannot be reproduced faithfully in happy-dom without
  *faking* the result (mocking `changeChatTo` to set `chatPage` directly is exactly the
  store-driven shortcut the plan forbids). Tier 2 is the lowest tier that reproduces it
  honestly — the plan says "Pick the lowest tier that can reproduce the bug."
- **Journey 3**'s refreeze is driven by a full projection resync (a state import →
  `state.imported` → `forceServerProjectionResync`), not a fine-grained toggle save. On
  the current tree, toggle saves use `mergeServerProjectionCharacterRow` (a fine-grained
  merge that does **not** reassign `DBState.db`), so they no longer re-fire the
  route-application `$effect`. The `untrack` bug only manifests when a refreeze reassigns
  the whole projection. The gate still pins the exact `untrack` hunk from `09eae20d3`.
  See [`phase0-acceptance-gate.md`](phase0-acceptance-gate.md) for the full reasoning.
