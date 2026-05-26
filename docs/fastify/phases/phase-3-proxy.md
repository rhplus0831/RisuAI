# Phase 3 - Proxy Migration

Date: 2026-05-27

Status: closed 2026-05-21.

Phase 3 moved the proxy, hub passthrough, stream-job WebSocket, storage,
auth, and crypto surfaces onto Fastify, then deleted the Express server
and its `runserver` script.

Original closeout work is complete. Post-closeout audit work for
stream-job response-header filtering is tracked in
[`../../fastify-followup/phases/phase-3-proxy-followup.md`](../../fastify-followup/phases/phase-3-proxy-followup.md).
The alpha pass also closed hub response-header filtering in
[`../../fastify-followup-alpha/phases-completed/phase-3-hub-response-headers.md`](../../fastify-followup-alpha/phases-completed/phase-3-hub-response-headers.md).
Hub-route session auth for browser-loaded resources remains deferred.

Completed detail: [`../phases-completed/phase-3-proxy.md`](../phases-completed/phase-3-proxy.md).
