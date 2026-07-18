# MCP stored OAuth refresh drops the rotated refresh token

## Summary

The server-side "stored" MCP OAuth refresh path extracts only `access_token`
from the upstream token response and never writes anything back to the stored
`authRefreshes` record. Against providers that rotate refresh tokens on use
(standard OAuth practice), the first stored refresh consumes the single-use
refresh token; the second fails, and the client falls back to the full
interactive OAuth flow at every access-token expiry. The client-side
"provided" path persists rotation, proving the behavior was intended.

## Location

- `server/fastify/src/mcpOAuthRefresh.ts:128-145` —
  `executeStoredMcpOAuthRefresh` validates and returns only `{ accessToken }`;
  any `refresh_token` in the response is discarded.
- `server/fastify/src/routes/mcpOAuthRefresh.ts:61-83` — the route returns the
  access token and never updates settings.
- `src/ts/process/mcp/mcplib.ts:1178-1229` — the client 'provided' path reads
  the rotated token via `readOAuthRefreshToken` and persists it via
  `registerRefreshToken`.
- `src/ts/process/mcp/mcp.ts:250-287,412-448` — after any reload, settings
  reads mask `authRefreshes` secrets, so
  `resolveMCPRefreshTokenSource` returns `{source:'stored'}` and all future
  refreshes use the server-side path.

## Trigger

1. Add a remote MCP module whose OAuth server rotates refresh tokens on use.
2. Complete OAuth once (the refresh record is stored).
3. Reload the page (masked secrets force the stored path from now on).
4. Wait for the access token to expire twice.

## Expected behavior

The stored refresh persists the rotated `refresh_token` returned by the token
endpoint, keeping the stored record usable indefinitely.

## Actual behavior

The first stored refresh works but invalidates the stored token upstream. The
second refresh gets a 4xx; the MCP client falls back to the interactive
authorization-code popup. The user must re-authorize at every access-token
expiry, perceiving the saved connection as lost.

## Underlying cause

The stored-refresh path was ported server-side (to work with masked secrets)
without porting the rotation-persistence half of the client flow.

## Affected data flow

1. MCP 401 → `mcplib.oauthLogin` → source `stored` (masked).
2. `POST /api/v1/mcp/oauth/refresh` → upstream grant (rotates token) → server
   returns access token only.
3. Stored `authRefreshes` record now permanently stale.
4. Next refresh 4xx → interactive OAuth modal.

## Severity and likely user impact

**Medium-high.** Silent, permanent degradation of a saved credential for any
rotating provider; the failure presents as repeated re-authorization prompts
with no explanation.

## Recommended fix

In `executeStoredMcpOAuthRefresh`, also read `data.refresh_token`; when
present and valid, update the matching `authRefreshes` row inside a targeted
settings mutation (revision bump plus the providers-group event so client
projections reconcile), then return the access token.

## Test gap

A server test whose fake token endpoint returns a new `refresh_token`,
asserting the stored record is updated and a second refresh uses the rotated
token.
