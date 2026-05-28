# Closeout Buckets

Date: 2026-05-28

The work breakdown for the open findings, in suggested order, encoding the
decisions in [`decisions.md`](./decisions.md). Each bucket closes one exit
criterion ([`README.md`](./README.md)) and its finding
([`open-findings.md`](./open-findings.md)). A bucket is done only when its
finding is resolved **and** the exit criterion's regression proof is committed.

Current pickup: **Bucket 5 — Single active-writer session lock (EC5/F5)**.
Buckets 1, 2, 3, and 4 closed on 2026-05-28; see
[`history.md`](./history.md#provider-ownership-ec1f1).

| Order | Bucket                                             | Closes | Finding | Status            |
| ----- | -------------------------------------------------- | ------ | ------- | ----------------- |
| 1     | Provider ownership (server-only generation)        | EC1    | F1      | Closed 2026-05-28 |
| 2     | Plugin durable storage + Compatibility Mode        | EC2    | F2      | Closed 2026-05-28 |
| 3     | Import current-shape normalization                 | EC3    | F3      | Closed 2026-05-28 |
| 4     | Stable-id validation + prompt-item semantics       | EC4    | F4      | Closed 2026-05-28 |
| 5     | Single active-writer session lock                  | EC5    | F5      | Open              |
| 6     | Character asset-reference validation               | EC6    | F6      | Open              |
| 7     | Repeatable audit script + full verification ladder | EC7    | —       | Open              |

1. **Provider ownership (EC1=A) — closed 2026-05-28.** Server generation is now
   mandatory in Fastify mode: `useServerGeneration` no longer gates dispatch or
   appears in the Fastify settings command maps, unsupported provider/preview
   paths return explicit Fastify server-mode errors instead of falling through to
   browser dispatch, and the browser Vertex token refresh no longer writes to the
   server projection in Fastify mode. Focused proof:
   `pnpm test src/ts/process/request/tests/serverCompletion.test.ts -- --run`.
2. **Plugin durable storage (EC2=B + Compatibility Mode) — closed 2026-05-28.**
   Fastify mode now disables the three device-local sandbox APIs by default —
   `SafeLocalStorage`, `SafeIdbFactory`, and
   `getLocalPluginStorage()`/`SafeLocalPluginStorage` — with explicit unsupported
   errors. `pluginCompatibilityMode` is a command-backed Advanced setting that
   restores only those device-local APIs; `risuai.pluginStorage` remains
   server-backed regardless. `pluginV2` is blocked as an unsupported bridge key
   in Fastify mode, V2 `getDatabase` no longer reads server-owned names from
   `pluginCustomStorage`, and V3 runtime info reports `saveMethod: "server"` plus
   `deviceLocalPluginStorage`. Focused proof:
   `pnpm test src/ts/plugins/plugins.test.ts src/ts/server/commands.test.ts -- --run`
   and `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`.
3. **Import normalization (EC3=A) — closed 2026-05-28.** The JSON path in
   `save.ts` now passes the returned normalized clone from the exported
   `normalizeRisuSaveImportDatabase` to `applyImportedDatabase`, matching the
   multipart `.risu` import path. The narrow route-local normalizer was removed,
   JSON imports of non-object database payloads now return 400, and bootstrap
   tests now expect current-shape output after JSON import. Focused proof:
   `pnpm api:test server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts -- --run`.
4. **Stable-id validation + prompt items (EC4) — closed 2026-05-28.** Command
   paths now reject missing/duplicate child ids instead of repairing them:
   prompt-item create requires `promptItem.id`, message append/replace/generation
   result requires `chatId`, lorebook entry replacement validates entry ids, and
   script/trigger replacement validates definition ids. Repair/minting remains in
   import/bootstrap normalizers (`repair*` helpers). The `promptTemplate`
   prompt-settings channel was removed; `/prompt-items/*` owns prompt item edits,
   including the new `/prompt-items/enable` command used by the Bot Settings
   enable toggle. Focused proof:
   `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`,
   `pnpm test src/ts/server/commands.test.ts -- --run`, and `pnpm check`.
5. **Single active-writer session lock (EC5).** Port the `Risuai-NodeOnly`
   reference (`1c1d7bc6`): mint a per-page-load session id; register the active
   writer on **bootstrap** (last-loader-wins); reject non-active sessions with
   **423** on **every server-owned mutating route** — `/api/v1/commands/*`,
   import (`save.ts`), asset upload (`assets.ts`), backups (`backups.ts`), and
   legacy storage writes (`legacyStorage.ts`); read routes are untouched. The
   client reacts on 423 by notifying the user and reloading (re-bootstrap +
   re-register). Still remove the blind 409 replay at `commands.ts:2152` and
   `:1038` as a backstop; a stray same-session 409 surfaces a plain error/reload.
   No conflict-resolution page; no retry-safety classification.
6. **Asset-reference validation (EC6).** Extend `validateCharacterAssetRefs`
   (`characters.ts:371`) to iterate the `vits.files` dynamic map (report
   `vits.files.<key>`) and validate `gptSoVitsConfig.ref_audio_data.assetId`,
   reusing `validateOptionalServerAssetRef`. Shared by create and patch already;
   reject-on-missing. Tests: valid/missing/malformed on both paths. Scope is the
   character **audio** refs only — the broader walker-vs-validator drift class
   (e.g. `characterOrder.img` vs `imgFile`) is left to EC7's audit.
7. **Repeatable audit + ladder (EC7).** Land the audit script below, then run the
   full ladder. No audit/invariant package script and no `ts-morph` dependency
   exist yet (`package.json`); both must be added and wired (the ladder scripts
   already exist; `tauribuild` is correctly absent).

## EC7: audit-script specification

The point of EC7 is to stop the "closed, then rediscovered" cycle by turning the
invariants into repeatable structural checks. `ts-morph` is more useful here than
LSP/`pnpm check`: most remaining failures are semantic contract gaps, not type
errors, so `pnpm check` can pass while the contract is still wrong.

Candidate checks (ts-morph + `rg`):

- **EC5:** assert **no `/api/v1/commands/*` mutation route or import/asset-write
  route bypasses the active-session check** (every mutating handler runs the
  guard). Replaces the previous "classify retry safety" check, which the
  session-lock decision made unnecessary.
- **EC4:** find **command-path helpers that call `randomUUID()`** / otherwise mint
  ids (must be none; repair lives only in import/bootstrap `repairX` helpers).
- **EC4:** find resources reachable through **both** a typed command **and** a
  generic-settings/whole-array channel (the `promptTemplate`-style dual path).
- **EC2:** with Compatibility Mode off, assert **no sandbox path exposes sync
  `localStorage`/IndexedDB durable writes** (the browser smoke currently patches
  IndexedDB/OPFS, not `localStorage` — extend it or scope the assertion to match);
  compare `allowedDbKeys`,
  `unsupportedServerBridgeKeys`, settings maps, and command dispatch tables for
  drift; flag `pluginV2`-style allowed keys with no command path.
- **EC6:** compare the **asset-reference walker fields** against the owning command
  validators (no walker field without a validator).
- **EC1:** flag **browser provider-dispatch fallbacks** reachable without server
  ownership, and durable writes inside `withTrustedServerProjectionWrite` with no
  command/import follow-up.

The script decides no semantic policy on its own; it makes the audit repeatable
so a future "complete" claim is checkable rather than re-derived by hand.

## On tooling

- **TypeScript/Svelte LSP** helps navigation, hover, references, and editor
  diagnostics. It does not close this workstream by itself.
- **ts-morph** is the right tool for the standing audit (above).
