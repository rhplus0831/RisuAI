# Assets, Imports, Backups, Memory, And External Entrypoints Stale State Audit

Audit method: validation-agent review of every row in `docs/user-input-layer-audit/assets-imports-backups-memory.md`, with manager normalization of verdicts and terminology.

Verdicts use `Pass`, `Risk`, `Issue`, and `N/A` as defined in `docs/user-stale-state-audit/overview.md`.

| Source item | Verdict | Async boundary | Guard / rollback | Finding |
| --- | --- | --- | --- | --- |
| `saveAsset` | Pass | asset upload | active-writer and revision advance | Helper returns an asset id and does not directly overwrite local user state. |
| `saveAssets` | Pass | hash/exists/bulk upload | deterministic ids and response validation | Bulk helper writes asset metadata, not live UI draft state. |
| `postInlayAsset`, `writeInlayImage` | Pass | image decode, canvas, upload | asset-id keyed cache | Writes asset/cache metadata; caller owns composer mutation. |
| `postChatFile` | Pass | file parse/upload | helper returns tokens | Helper does not mutate composer directly. |
| Composer paste/menu file actions | Issue | file reader and `postChatFile()` | no composer/request token | Late upload can append to current `messageInput`/`fileInput` after the user typed, sent, cleared, or navigated. |
| Character avatar/additional asset/reference audio buttons | Issue | picker/upload/model registration | later command rollback may be value-scoped; upload callback is not | Upload completion can mutate live character draft/index after selection or draft changed. |
| Media settings asset buttons | Issue | picker/upload | settings rollback value-checks later; upload callback is not | Older upload can restore deleted/replaced image fields in settings drafts. |
| Module asset upload button | Issue | picker/upload plus later Save | parent command rollback is broad | Stale upload mutates `tempModule`; failed Save can restore stale module snapshot over newer edits. |
| Realm main import/chat button | Risk | server import SSE and bootstrap refresh | baseRevision guards commit; full refresh has no dirty/local edit fence | Import commit is guarded, but finish refresh can apply older projection over newer local state. |
| Realm popup import button | Risk | same Realm import path | same | Popup triggers the shared importer and shares the full-refresh risk. |
| Realm report/remove buttons | N/A | remote hub fetch | no local DB rollback | Remote moderation/removal only; no Fastify local state overwrite path. |
| Save server backup button | Pass | POST backup snapshot | active-writer; no projection apply | Creates a backup artifact only. |
| Load server backup button | Risk | restore and full resync | UI serializes backup buttons; no global edit/revision fence | Intended destructive restore can still race newer local edits before refresh applies. |
| Save local / zip backup buttons | N/A | export download | read-only | No mutation. |
| Load local backup button | Risk | upload/import and full resync | active-writer; no full-resync revision fence | Intended restore can apply stale imported state over newer local state. |
| Clean cold storage button | N/A | none live | no-op/stub | No async mutation path. |
| Backup helpers | Risk | restore/import/export helpers | active-writer; resync does not reject older local edits | Export/create are safe; restore/import share the full-resync risk. |
| Realm import helper | Pass | fetch/SSE import request | `baseRevision`, 409 handling, active-writer | Helper itself only returns result/updates cached revision; stale apply risk is in the finishing refresh. |
| Character/chat import helpers | Issue | file decode/upload and command response | chat/character rollback can be broad | Failed older import can restore stale chat/character arrays over newer edits; `.txt` branch remains a non-persistent source-row issue. |
| Cancel server memory job button | Issue | DELETE versus polling/SSE/list refresh | cancel helper narrow; list/progress consumers need ordering guard | Older in-flight list/progress response can reinsert or display a pending/running job after cancel. |
| Server memory request helpers | Pass | list/read/cancel fetches | caller-owned state; active-writer for cancel | Request helpers do not overwrite local state directly. |
| Local Hypa bulk buttons | N/A | local summarize/translate | hidden or early-return in server-backed mode | Not live with server-backed memory API. |
| Category manager controls | N/A | none live | parent does not render in server-backed mode | No live server-backed mutation path. |
| Tag manager controls | N/A | none live | parent does not render in server-backed mode | No live server-backed mutation path. |
| Modal summary item controls | N/A | local display-only async; edit controls readonly/hidden | `readOnly` gates persistent edits | Persistent summary mutation controls are disabled in server-backed mode. |

