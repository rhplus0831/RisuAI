# Next Steps

Date: 2026-05-20

Use this list to pick the next slice. Keep work batches narrow:
one removal target _or_ one foundation slice, not both at once.

## Immediate

1. **Phase 0 removals - Group chat.** Done 2026-05-20. Single
   commit; the type narrowing forced types, runtime, and UI to
   land together. `isGroupChat` was preserved as a `false`
   back-compat shim for user scripts. See
   [`removals.md`](removals.md) for the as-landed inventory.

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

Phase 0 closed 2026-05-20. Phase 1 unblocks.

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
