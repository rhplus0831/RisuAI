# Next Steps

Date: 2026-05-20

Use this list to pick the next slice. Keep work batches narrow:
one removal target _or_ one foundation slice, not both at once.

## Immediate

1. **Phase 0 removals - Group chat first.**
   - Delete `src/ts/process/group.ts`.
   - Remove the `connectionOpen` / `peerSync` block from
     `src/ts/process/index.svelte.ts` lines 221-230 and the
     `groupOrder` block at line 298.
   - Strip `type === 'group'` branches from `src/ts/` and
     `src/lib/`. There are 49 + ~20 sites; do them in one
     reviewable commit per directory cluster.
   - Remove the group-creation UI entry points in
     `src/lib/SideBars/CharConfig.svelte` and the group views in
     `src/lib/ChatScreens/` / `src/lib/Mobile/`.
   - Update [`status/removals.md`](removals.md) and the relevant
     entry in [`phases/phase-0-removals.md`](../phases/phase-0-removals.md).
   - Confirm `pnpm check`, `pnpm test`, `pnpm build` stay green.

2. **Phase 0 removals - Peer multi-user chat.** Done 2026-05-20.
   See [`removals.md`](removals.md) for the as-landed inventory.

3. **Phase 0 removals - Risu Account Sync + Drive sync.** Done
   2026-05-20. Landed as a single commit. The
   `backuplocal.ts` helpers were preserved (moved to
   `src/ts/storage/backup.ts`) so the in-app local backup buttons
   keep working; the doc claim that those helpers "rode alongside
   the Drive code path" turned out to be wrong. See
   [`removals.md`](removals.md) for the as-landed inventory.

4. **Phase 0 removals - Legacy memory engines.** Done 2026-05-20.
   Two commits: V3 decoupling (rename `supaMemoryKey` →
   `hypaV3Key` with migration fallback), then the bulk removal.
   See [`removals.md`](removals.md) for the as-landed inventory.

After all four bullets close, Phase 0 is done and Phase 1 unblocks.

## Parallel track (safe to start with Phase 0)

5. **Phase 4 prep - characterization tests.**
   - Build the fixture loader that drives the current `sendChat`
     against canned databases + canned upstream responses.
   - Do NOT modify `sendChat` itself. The goal is to record what
     the function does today so removals in Phase 0 don't silently
     change behavior.
   - Inventory lives in
     [`coverage/sendchat-fixtures.md`](../coverage/sendchat-fixtures.md).

## Closed (do not reopen without a contract)

These choices are locked. Reopening means writing a short rationale
in this file and updating the relevant phase doc:

- Tauri stays as-is. Do not add or modify Tauri-specific code in
  Phase 0-9.
- Hub proxy stays. Do not delete `/hub-proxy/*` handling.
- No whole-state PUT in the Fastify API.
- Only Hypa V3 survives. Do not write code that re-introduces
  Supa / Hypa V2 / Hanurai.

## Verification before closing a slice

```bash
pnpm check
pnpm test
pnpm build
```

Add `pnpm api:test` once Phase 1 lands. Tauri build is verified
manually at phase boundaries, not per-slice.
