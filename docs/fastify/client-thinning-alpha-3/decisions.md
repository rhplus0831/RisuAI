# Decisions

Date: 2026-05-28

These are starting decisions for Alpha 3. Update this file when a bucket chooses
a different implementation and lands tests proving the new contract.

## A3EC1 - Active Writer And Conflict Semantics

**Default decision:** bootstrap should have separate writer-registration and
read-only projection-refresh modes. Page-load/user-intent bootstrap may register
the active writer. Passive SSE refresh must not. Generic settings commands
should surface 409 conflicts instead of replaying the same patch.

**Why:** The active-writer guard only works if reads cannot silently become
write-ownership claims. The conflict policy also needs to be uniform; one helper
that retries conflicts can overwrite newer state even while the central command
wrapper behaves correctly.

**Acceptable alternative:** Keep bootstrap as the only projection endpoint only
if the client can explicitly choose whether a request registers writer ownership
and the server rejects registration from passive refreshes by testable contract.

## A3EC2 - Stable Ids And Repair Helpers

**Default decision:** public command routes must not call repair helpers that can
mint ids. Repair helpers are for import/bootstrap normalization only. Preset
copy/import and lorebook fallback should either require client-supplied ids or
be documented as explicit server-generated commands with audit-visible
exceptions.

**Why:** Alpha 2 closed route-local id minting, but imported repair helpers can
reintroduce the same bug class invisibly. Stable ids are the browser projection
anchor.

**Acceptable alternative:** A command may generate ids only if the route name,
payload, response, tests, and audit all classify it as server-generated and the
client does not perform an optimistic local write with a different id.

**Bucket 2 implementation:** preset copy requires the client's optimistic copy
id as `newPresetId`, preset import uses `createPresetRecord` instead of the
id-minting repair helper, and deleting the last global lorebook returns 400
instead of inserting a fallback lorebook.

## A3EC3 - Chat And Message Addressing

**Default decision:** if a route addresses a chat or message by id
without a parent id in the URL, that id must be globally unique in current-shape
data. Import/bootstrap normalization and command writes should enforce that.
Chat folders are not reopened in Alpha 3 because `normalizeGlobalChatFolderIds`
and audit rule AEC4 already cover folder global uniqueness.

**Why:** The current resolvers return the first match globally. Parent-local
uniqueness is not enough unless routes include the parent id and validate it.

**Acceptable alternative:** Convert affected routes to parent-scoped routes and
events. This is a larger public command contract change and must update the
command map, client helpers, tests, and audit.

**Bucket 3 implementation:** the public route contract remains globally
addressed. Chat ids and message ids are normalized to global uniqueness during
import/bootstrap repair, command-created/forked chats reject duplicate chat ids
and embedded duplicate message ids, and message append/replace/generation
commands reject ids already used under another chat.

## A3EC4 - Asset Ownership

**Default decision:** Fastify asset reads should only attach `risu-auth` to
same-origin Fastify asset endpoints. Server backups should preserve asset bytes.
The RisuSave asset walker and command validators should agree on whether legacy
`assets/<sha>.<ext>` references are allowed in current-shape data.

**Why:** Phase 9's asset gate is not only about writes. Reads, backups, and
exports must all preserve the same asset ownership model or the server can leak
auth, lose asset bytes, or export incomplete bundles.

**Acceptable alternative:** If a class of assets is intentionally metadata-only
or local-only, document it in the closeout and make tests prove that the UI does
not expect the server to round-trip those bytes.

## A3EC5 - Secret Placeholder Row Identity

**Default decision:** masked secret placeholders in arrays must restore by
stable row identity, not index. If no stable id exists for a row, reject masked
placeholders in reordered/partial array payloads.

**Why:** Index-based restoration is safe only when array shape and order are
unchanged. Phase 9 lets many arrays be edited/reordered by command, so index
restore can transplant secrets.

**Acceptable alternative:** Split high-risk secret arrays out of generic
settings commands and require dedicated commands that can validate row identity.

## A3EC6 - Audit Shape

**Decision:** Alpha 3 uses rule-first closeout. R1-R7 must be added before the
corresponding behavior buckets are marked closed, and each rule should fail on
the pre-fix tree and pass after the behavior fix. Alpha 3 bug classes without a
dedicated R rule must become documented, tested exclusions.

**Why:** Alpha 3 exists because the current audit passes while these issues
remain. A fix without audit coverage repeats the close/reopen cycle.

Rule map:

- R1: passive refresh cannot use writer-registering bootstrap.
- R2: conflict retry drift is forbidden outside the central command wrapper.
- R3: public command routes cannot call id-minting repair helpers.
- R4: globally resolved chat/message ids must be globally unique or
  parent-scoped.
- R5: server bundle asset walking and client asset-reference parsing must agree.
- R6: wildcard array secrets require row-identity-safe restoration or rejection.
- R7: asset reads must reject unknown references before attaching `risu-auth`.
