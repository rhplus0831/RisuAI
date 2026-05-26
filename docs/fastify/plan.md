# Migration Plan

Date: 2026-05-27

## Goal

Move Risuai from a thick browser app that owns persistence, provider
calls, and prompt assembly into a Fastify server that owns those
concerns. The browser keeps UI ownership and nothing else.

End state:

- Fastify owns persisted generation, provider dispatch, prompt and
  lorebook assembly, Hypa V3 memory, tokenization, and outbound HTTP.
- The browser owns rendering, input, abort forwarding, and browser-only
  effects (TTS playback, image preview).
- `sendChat` is a thin bridge that forwards intent to the server and
  applies SSE patches.
- Group chat, peer multi-user chat, Risu Account Sync, Google Drive
  sync, Supa / Hypa V2 / Hanurai memory engines, and Tauri / Desktop
  support are removed.

## Completed Phases

All phases closed. Domain state uses `data/db.json`; memory uses
dedicated SQL tables. The browser is a projection of server state
with a read-only guard in server-backed mode.

0. **Removals** - deleted legacy surfaces (2026-05-20).
1. **Foundation** - Fastify scaffold, auth, health (2026-05-20).
2. **Storage** - persistence, import, assets, backups (2026-05-20).
3. **Proxy** - provider proxy, hub, stream jobs, Express deletion (2026-05-21).
4. **sendChat tests** - fixture-based characterization tests (2026-05-20).
5. **sendChat extraction** - helper module split (2026-05-22).
6. **Server-side generation** - `/completion` route (2026-05-22).
7. **Prompt assembly** - `/chat` route + dispatch (2026-05-24).
8. **Memory** - Hypa V3 server-side queue (2026-05-25).
9. **Client thinning** - command surface, projection guard (2026-05-26).
10. **Tauri / Desktop removal** - all desktop support deleted (2026-05-27).

## Non-goals

- Multi-tenant deployment. Single-user server.
- Real-time collaborative editing.
- Background workers other than Hypa V3 memory.
- Schema-driven API clients.
- Re-implementing peer sync server-side.

## Risks

- **sendChat hidden coupling.** Phase 4 fixtures discover these.
- **Provider drift.** Phase 6 ports one provider at a time with fixtures.
- **Migration scope creep.** Phase boundaries are exit criteria.

## Verification

```bash
pnpm check          # svelte-check + tsc
pnpm test           # frontend vitest
pnpm api:test       # Fastify route suite
pnpm build          # production bundle
pnpm smoke:fastify-browser
```

## References

- [`architecture.md`](architecture.md) - server module shape.
- [`phases-completed/`](phases-completed/) - historical phase details.
