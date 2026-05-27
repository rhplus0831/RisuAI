# Runtime Stages

## Stage 0: Entry Points

Package scripts, launchers, Docker files, and public docs should advertise one runtime path: build the client, start Fastify, and serve the API plus static assets from the Fastify server.

Phase 1 removed:

- Hono build and start scripts.
- Electron and native wrapper scripts.
- Legacy `server.sh` and `server.bat` launchers.
- Capacitor config.

Remaining focus:

- Public docs that still describe a cross-platform app.

## Stage 1: Fastify Boot

Fastify constructs the server, mounts `/api/v1/*`, serves static assets, and exposes only the globals or bootstrap payload needed by the Fastify-served client.

Cleanup focus:

- Remove `__NODE__` as a compatibility bridge.
- Keep a single server-backed signal for the client.
- Make smoke startup match Docker and local dev startup.

## Stage 2: Client Bootstrap

The client starts from a Fastify-served page and loads server-backed data. It should not fall back to local save-file mode when the Fastify bootstrap path is unavailable.

Cleanup focus:

- Collapse `src/ts/bootstrap.ts` platform branches.
- Remove standalone local initialization.
- Make authentication and storage failures explicit Fastify errors.

## Stage 3: Storage And Proxy IO

Client IO should use Fastify route contracts only.

Cleanup focus:

- Keep `/api/v1/storage/*`.
- Keep `/api/v1/proxy/*`.
- Remove legacy storage and proxy endpoints.
- Remove hosted function proxy paths.

## Stage 4: Generation Runtime

Generation, sendChat, provider, memory, and command flows should continue to run through the Fastify-backed contracts that the existing migration established.

Cleanup focus:

- Preserve existing sendChat fixture coverage.
- Ensure provider calls do not select local or hosted proxy branches.
- Keep memory and command behavior covered through Fastify route tests.

## Stage 5: Closeout

The closeout stage updates user-facing docs and archives completed phase notes.

Required closeout:

- README and Docker docs describe the same port and startup path.
- Removed platforms are listed in [removed-and-out-of-scope.md](removed-and-out-of-scope.md).
- Verification results are recorded before moving phase files to [phases-completed](phases-completed/).
