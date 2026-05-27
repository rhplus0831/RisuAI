# Fastify Client Thinning — Server-Projection Contract

Date: 2026-05-28

Status: **reopened / not complete.** The original Phase 9 *migration milestone*
(linear 0→9 client-thinning) is archived as closed under
[`../phases-completed/`](../phases-completed/) and stays closed. Client thinning
itself continues here as a **standing workstream**, because every audit pass that
treats "Phase 9 complete" as a checklist of known direct writes keeps
rediscovering a new class of server-projection violations.

This directory is the single source of truth for that workstream. It replaces
the scattered `docs/fastify-phase-9-rework/` README and the top-level wakeup
note, both of which were orphaned and re-derived the contract from audit notes.

## Why this is a workstream, not a phase

Phases 0–8 closed and stayed closed. Phase 9 did not, and the commit history
shows why:

- A first rework fixed nine concrete issues (nested secret masking,
  character-module persistence, stale trusted-write aliases, plugin DB bridge
  narrowing, welcome-setup persistence, `verbosity`, DevTool autopilot,
  malformed RISUSAVE errors, asset upload revision events).
- A follow-up audit then found a *different* class of issues: provider dispatch
  ownership, plugin-local durable storage, JSON import normalization, stable-id
  command semantics, blind conflict retry, and missing asset validation.

The agent was not missing the same item repeatedly. It was closing local
symptoms while the global invariant stayed underspecified. The fix is to make
the **invariant** the gate, and to make that gate **repeatably checkable**
(see [EC7](#exit-criteria) and [`closeout-buckets.md`](./closeout-buckets.md)).

## The invariant

> In Fastify-served web mode, the browser is only a projection of server-owned
> durable state. Bootstrap, generation, imports, plugin storage, commands,
> assets, and conflict handling must all preserve that invariant.

The old definition — "close the remaining direct-write and Fastify persistence
bugs" — lets the agent close one known bucket, rerun green tests, and declare
the phase complete. The invariant gives a stable boundary: client thinning is
complete only when the server-projection contract is true and covered by
regression tests.

## Exit criteria

Client thinning is complete only when **every** criterion is true in
Fastify-served web mode **and** covered by a committed regression test. Each
criterion maps to an open finding ([`open-findings.md`](./open-findings.md)) and
a closeout bucket ([`closeout-buckets.md`](./closeout-buckets.md)).

| #   | Exit criterion | Required regression proof |
|-----|----------------|---------------------------|
| EC1 | **Provider ownership.** Server generation is the *only* generation path in Fastify mode — the `useServerGeneration` toggle is removed (const-true); browser provider dispatch is unreachable (unsupported formats error explicitly); no client-side durable token writes (Vertex refresh moves server-side). | Fastify bootstrap → generation reaches the server path or errors; no browser dispatch; no client Vertex token write. |
| EC2 | **Durable writes go through commands/import only.** The async plugin KV is server-backed; sync `localStorage` and IndexedDB are disabled by default. An opt-in, account-wide, command-backed **Plugin Compatibility Mode** may restore *only* those two sync APIs as device-local, and never relaxes resource ownership. `pluginV2`, read-time shadowing, and `saveMethod` honesty are fixed. | With Compatibility Mode **off**, no sync-`localStorage`/IndexedDB durable path is reachable; resource ownership holds in **both** states. |
| EC3 | **Imports produce current-shape data.** JSON `{ database }` import calls the same exported `.risu` normalizer (`normalizeRisuSaveImportDatabase`); bootstrap never serves shapes public commands cannot address by stable id. | Import missing/duplicate ids through the JSON path → normalized bootstrap output or 400. |
| EC4 | **Public commands validate stable identity.** Id helpers are split into import-only `repairX` (may mint ids) and command-path `validateX` (rejects missing/duplicate, 400); no command-path helper mints ids. Prompt items are edited only via the existing `/prompt-items/*` commands — the raw `promptTemplate` settings path is removed. | Create/patch tests for missing and duplicate child ids; `promptTemplate` rejected by `/commands/prompt-settings`. |
| EC5 | **Single active writer.** In Fastify mode only the most recently bootstrapped session may mutate; stale sessions are rejected (`423`) and reload. No blind 409 replay (both wrapper sites). | A second session's mutation after a newer session registers → `423`; no command wrapper auto-replays a 409. |
| EC6 | **Asset references validated where written.** `validateCharacterAssetRefs` covers every server asset field the bundle walker treats as a reference, incl. `vits.files.*` and `gptSoVitsConfig.ref_audio_data.assetId` (create + patch). | Character create/patch tests for valid, missing, and malformed audio asset refs. |
| EC7 | **Repeatable invariant audit exists.** A ts-morph/rg audit script re-checks the invariants (no mutation route bypasses the active-session check; no command-path helper mints ids; no resource has both a typed command and a generic-settings channel; sandbox storage APIs gated; asset-walker fields covered by validators), and the full ladder is green. | Audit script committed in repo + the ladder below. |

## Verification ladder

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

`pnpm tauribuild` appears in older Phase 9 closeout docs but **no longer exists**
after the Fastify-only cleanup. Do not reintroduce it as a closeout gate.

## Document map

- [`open-findings.md`](./open-findings.md) — the open findings with evidence
  (audit-corrected), mapped to exit criteria, each with its decision pointer.
- [`decisions.md`](./decisions.md) — the recorded decision + rationale for each
  exit criterion (the "why", especially the non-obvious calls).
- [`closeout-buckets.md`](./closeout-buckets.md) — the work breakdown in
  suggested order, plus the EC7 audit-script specification.
- [`audit.md`](./audit.md) — the sub-agent audit that supplied the precision
  corrections folded into `open-findings.md`.
- [`history.md`](./history.md) — resolved findings, verification-ladder
  results, and the pointer to the archived `phase-9-*` migration slices.
