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

3. **Phase 0 removals - Risu Account Sync + Drive sync.**
   - Delete `src/ts/storage/accountStorage.ts`,
     `src/ts/drive/accounter.ts`, `src/ts/sionyw.ts`,
     `src/ts/drive/drive.ts`, `src/ts/drive/backuplocal.ts`.
   - Strip OAuth handlers from `server/node/server.cjs`
     (`/api/oauth_login`, `/api/oauth_callback`) - they go away
     when Phase 0 lands; we are not porting them.
   - Remove the matching UI entries from
     `src/lib/Setting/Pages/UserSettings.svelte`.
   - Drop `openid-client` from `package.json` if no other consumer
     remains.

4. **Phase 0 removals - Legacy memory engines.**
   - Delete `src/ts/process/memory/{supaMemory.ts, hypav2.ts,
hanuraiMemory.ts}`.
   - Remove the matching branches from
     `src/ts/process/index.svelte.ts` (lines 1097-1142 cover the
     three legacy adapters).
   - Remove their settings UI rows.

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
