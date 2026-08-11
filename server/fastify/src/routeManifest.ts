export type ProtocolRouteMethod = 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'OPTIONS'

export type ProtocolRoutePathMatch = 'exact' | 'prefix' | 'pattern'

export type ProtocolRouteAuthDecision = 'required' | 'public' | 'conditional'

export type ProtocolRouteActiveWriterDecision =
  | 'active-writer'
  | 'auth-session'
  | 'not-applicable'
  | 'read-only-post'
  | 'runtime-generation'
  | 'runtime-proxy'
  | 'stateless-helper'
  | 'writer-registration'

export type ProtocolRouteStreamingShape = 'none' | 'binary' | 'sse' | 'sse-optional' | 'websocket' | 'proxy'

export interface ProtocolRouteManifestEntry {
  id: string
  methods: readonly ProtocolRouteMethod[]
  path: string
  match?: ProtocolRoutePathMatch
  auth: {
    decision: ProtocolRouteAuthDecision
    reason: string
  }
  activeWriter: {
    decision: ProtocolRouteActiveWriterDecision
    reason: string
  }
  streaming: ProtocolRouteStreamingShape
  notes?: string
}

export const PROTOCOL_MUTATING_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const

const READ_METHODS = ['GET', 'HEAD'] as const
const GET_ONLY = ['GET'] as const
const HUB_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] as const

export const PROTOCOL_ROUTE_MANIFEST = [
  {
    id: 'health',
    methods: READ_METHODS,
    path: '/api/v1/health',
    auth: {
      decision: 'public',
      reason: 'Health exposes only process/schema status.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only status route.',
    },
    streaming: 'none',
    notes: 'Intentional public health and schema revision surface.',
  },
  {
    id: 'auth-status',
    methods: READ_METHODS,
    path: '/api/v1/auth/status',
    auth: {
      decision: 'public',
      reason: 'Clients need to discover whether setup or login is required.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only auth status route.',
    },
    streaming: 'none',
    notes: 'Intentional public auth-bootstrap probe.',
  },
  {
    id: 'auth-setup',
    methods: ['POST'],
    path: '/api/v1/auth/setup',
    auth: {
      decision: 'public',
      reason: 'First-run password setup happens before an authenticated browser exists.',
    },
    activeWriter: {
      decision: 'auth-session',
      reason: 'Writes auth metadata, not Risu domain state.',
    },
    streaming: 'none',
    notes: 'Intentional public exception; self-refuses once a password exists.',
  },
  {
    id: 'auth-login',
    methods: ['POST'],
    path: '/api/v1/auth/login',
    auth: {
      decision: 'public',
      reason: 'Login exchanges the password for a registered browser public key.',
    },
    activeWriter: {
      decision: 'auth-session',
      reason: 'Writes trusted public-key auth metadata, not Risu domain state.',
    },
    streaming: 'none',
    notes: 'Intentional public login endpoint.',
  },
  {
    id: 'auth-crypto',
    methods: ['POST'],
    path: '/api/v1/auth/crypto',
    auth: {
      decision: 'public',
      reason: 'Stateless compatibility hashing helper.',
    },
    activeWriter: {
      decision: 'stateless-helper',
      reason: 'Does not persist state.',
    },
    streaming: 'none',
    notes: 'Intentional public helper; request body is transformed only in memory.',
  },
  {
    id: 'bootstrap',
    methods: GET_ONLY,
    path: '/api/v1/bootstrap',
    auth: {
      decision: 'required',
      reason: 'Bootstrap returns authenticated runtime and session metadata.',
    },
    activeWriter: {
      decision: 'writer-registration',
      reason: 'Writer-intent bootstrap can latch the latest writer session; it is not gated.',
    },
    streaming: 'none',
  },
  {
    id: 'settings-read',
    methods: GET_ONLY,
    path: '/api/v1/settings',
    auth: {
      decision: 'required',
      reason: 'Settings contain private user configuration and masked provider credentials.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only settings route.',
    },
    streaming: 'none',
  },
  {
    id: 'inlay-catalog-read',
    methods: GET_ONLY,
    path: '/api/v1/inlay-assets',
    auth: {
      decision: 'required',
      reason: 'The inlay catalog contains private user asset metadata.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only inlay catalog route.',
    },
    streaming: 'none',
  },
  {
    id: 'settings-cache-read',
    methods: ['POST'],
    path: '/api/v1/settings',
    auth: {
      decision: 'required',
      reason: 'Hash-aware settings reads contain private user configuration and masked provider credentials.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Hash-aware settings reading is read-only; POST carries the client cache inventory.',
    },
    streaming: 'none',
  },
  {
    id: 'settings-group-read',
    methods: GET_ONLY,
    path: '/api/v1/settings/:group',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Targeted settings groups contain private user configuration and masked provider credentials.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only targeted settings route.',
    },
    streaming: 'none',
  },
  {
    id: 'settings-group-cache-read',
    methods: ['POST'],
    path: '/api/v1/settings/:group',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Hash-aware settings-group reads contain private user configuration and masked provider credentials.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Hash-aware settings-group reading is read-only; POST carries the client cache inventory.',
    },
    streaming: 'none',
  },
  {
    id: 'collections-read',
    methods: GET_ONLY,
    path: '/api/v1/collections',
    auth: {
      decision: 'required',
      reason: 'Collections contain private user presets, modules, plugins, and storage.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only collection route.',
    },
    streaming: 'none',
  },
  {
    id: 'collections-cache-read',
    methods: ['POST'],
    path: '/api/v1/collections',
    auth: {
      decision: 'required',
      reason: 'Hash-aware collection reads contain private user presets, modules, plugins, and storage.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Hash-aware collection reading is read-only; POST carries the client cache inventory.',
    },
    streaming: 'none',
  },
  {
    id: 'collection-read',
    methods: GET_ONLY,
    path: '/api/v1/collections/:name',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Targeted collections contain private user presets, modules, plugins, or storage.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only targeted collection route.',
    },
    streaming: 'none',
  },
  {
    id: 'collection-cache-read',
    methods: ['POST'],
    path: '/api/v1/collections/:name',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Hash-aware targeted collection reads contain private user presets, modules, plugins, or storage.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Hash-aware targeted collection reading is read-only; POST carries the client cache inventory.',
    },
    streaming: 'none',
  },
  {
    id: 'characters-read',
    methods: GET_ONLY,
    path: '/api/v1/characters',
    auth: {
      decision: 'required',
      reason: 'Character listing returns private character and chat metadata.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only character listing route.',
    },
    streaming: 'none',
  },
  {
    id: 'characters-cache-read',
    methods: ['POST'],
    path: '/api/v1/characters',
    auth: {
      decision: 'required',
      reason: 'Hash-aware character reads return private character and chat metadata.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Hash-aware character reading is read-only; POST carries the client cache inventory.',
    },
    streaming: 'none',
  },
  {
    id: 'character-order-read',
    methods: GET_ONLY,
    path: '/api/v1/characters/order',
    auth: {
      decision: 'required',
      reason: 'Character order is private user presentation state.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only character order route.',
    },
    streaming: 'none',
  },
  {
    id: 'character-selection-read',
    methods: GET_ONLY,
    path: '/api/v1/characters/:id/selection',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Character selection returns private selection and interaction state.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only character selection route.',
    },
    streaming: 'none',
  },
  {
    id: 'character-read',
    methods: GET_ONLY,
    path: '/api/v1/characters/:id',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Character detail returns private character and chat metadata.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only character detail route.',
    },
    streaming: 'none',
  },
  {
    id: 'character-greeting-translations-read',
    methods: GET_ONLY,
    path: '/api/v1/characters/:characterId/greeting-translations',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Greeting translations contain private character-derived provider output.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only greeting translation projection.',
    },
    streaming: 'none',
  },
  {
    id: 'chat-messages-read',
    methods: GET_ONLY,
    path: '/api/v1/chats/:id/messages',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Chat message reads return private conversation history.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only chat message route.',
    },
    streaming: 'none',
  },
  {
    id: 'chat-messages-bulk-read',
    methods: ['POST'],
    path: '/api/v1/chats/messages/bulk',
    auth: {
      decision: 'required',
      reason: 'Bulk chat reads return private conversation histories.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Bulk chat reading is read-only; POST carries a potentially large id list.',
    },
    streaming: 'none',
  },
  {
    id: 'character-lorebook-read',
    methods: GET_ONLY,
    path: '/api/v1/characters/:id/lorebook',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Character lorebook reads return private prompt context.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only character lorebook route.',
    },
    streaming: 'none',
  },
  {
    id: 'character-lorebook-cache-read',
    methods: ['POST'],
    path: '/api/v1/characters/:id/lorebook',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Hash-aware character lorebook reads return private prompt context.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Hash-aware character lorebook reading is read-only; POST carries the client cache inventory.',
    },
    streaming: 'none',
  },
  {
    id: 'character-lorebooks-bulk-read',
    methods: ['POST'],
    path: '/api/v1/characters/lorebooks/bulk',
    auth: {
      decision: 'required',
      reason: 'Bulk character lorebook reads return private prompt context.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Bulk lorebook reading is read-only; POST carries a potentially large id list.',
    },
    streaming: 'none',
  },
  {
    id: 'legacy-preset-read',
    methods: GET_ONLY,
    path: '/api/v1/legacy-presets/:id',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Legacy preset detail can contain private provider configuration.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only legacy preset route.',
    },
    streaming: 'none',
  },
  {
    id: 'legacy-preset-cache-read',
    methods: ['POST'],
    path: '/api/v1/legacy-presets/:id',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Hash-aware legacy preset reads can contain private provider configuration.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Hash-aware legacy preset reading is read-only; POST carries the client cache inventory.',
    },
    streaming: 'none',
  },
  {
    id: 'prompt-preset-template-read',
    methods: GET_ONLY,
    path: '/api/v1/prompt-presets/:id/template',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Prompt preset templates contain private user prompt content.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only prompt preset template route.',
    },
    streaming: 'none',
  },
  {
    id: 'prompt-preset-template-cache-read',
    methods: ['POST'],
    path: '/api/v1/prompt-presets/:id/template',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Hash-aware prompt preset template reads contain private user prompt content.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Hash-aware prompt template reading is read-only; POST carries the client cache inventory.',
    },
    streaming: 'none',
  },
  {
    id: 'risusave-import',
    methods: ['POST'],
    path: '/api/v1/import/risusave',
    auth: {
      decision: 'required',
      reason: 'Risu save import replaces repository state.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Import commits server-owned database and asset metadata.',
    },
    streaming: 'none',
  },
  {
    id: 'risusave-bundle-import',
    methods: ['POST'],
    path: '/api/v1/import/bundle',
    auth: {
      decision: 'required',
      reason: 'Bundle import replaces repository state and registers bundled assets.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Bundle import commits server-owned database and asset metadata.',
    },
    streaming: 'none',
  },
  {
    id: 'risusave-export',
    methods: GET_ONLY,
    path: '/api/v1/export/risusave',
    auth: {
      decision: 'required',
      reason: 'Export returns the persisted user database.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only repository export.',
    },
    streaming: 'binary',
  },
  {
    id: 'risusave-bundle-export',
    methods: GET_ONLY,
    path: '/api/v1/export/bundle',
    auth: {
      decision: 'required',
      reason: 'Bundle export returns the persisted user database and assets.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only repository export.',
    },
    streaming: 'binary',
  },
  {
    id: 'risusave-local-backup-export',
    methods: GET_ONLY,
    path: '/api/v1/export/local-backup',
    auth: {
      decision: 'required',
      reason: 'Local backup export returns the persisted user database and assets.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only repository export.',
    },
    streaming: 'binary',
  },
  {
    id: 'realm-character-import',
    methods: ['POST'],
    path: '/api/v1/import/realm-character',
    auth: {
      decision: 'required',
      reason: 'Realm import creates characters and stores fetched assets.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Realm import commits asset metadata and character state.',
    },
    streaming: 'sse-optional',
  },
  {
    id: 'command-mutation-receipt-ack',
    methods: ['POST'],
    path: '/api/v1/commands/mutation-receipts/ack',
    auth: {
      decision: 'required',
      reason: 'Receipt acknowledgement deletes authenticated durable command replay metadata.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Only the current writer may acknowledge durable mutation intents after local outbox deletion.',
    },
    streaming: 'none',
    notes: 'Operational idempotency metadata only; does not bump the user-data revision or emit a command event.',
  },
  {
    id: 'commands',
    methods: PROTOCOL_MUTATING_METHODS,
    path: '/api/v1/commands/',
    match: 'prefix',
    auth: {
      decision: 'required',
      reason: 'Command routes mutate revision-tracked user state.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Commands commit server-owned JSON/SQLite state.',
    },
    streaming: 'none',
  },
  {
    id: 'events',
    methods: GET_ONLY,
    path: '/api/v1/events',
    auth: {
      decision: 'required',
      reason: 'Events reveal command and memory activity for the user database.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Authenticated observe-only SSE route.',
    },
    streaming: 'sse',
    notes: 'Authenticated streaming route; intentionally not writer-gated.',
  },
  {
    id: 'asset-upload',
    methods: ['POST'],
    path: '/api/v1/assets',
    auth: {
      decision: 'required',
      reason: 'Asset upload writes repository asset metadata and blobs.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Asset upload can bump the repository revision.',
    },
    streaming: 'binary',
  },
  {
    id: 'asset-bulk-upload',
    methods: ['POST'],
    path: '/api/v1/assets/bulk',
    auth: {
      decision: 'required',
      reason: 'Bulk asset upload writes repository asset metadata and blobs.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Bulk asset upload can bump the repository revision.',
    },
    streaming: 'binary',
  },
  {
    id: 'asset-read',
    methods: READ_METHODS,
    path: '/api/v1/assets/:id',
    match: 'pattern',
    auth: {
      decision: 'public',
      reason: 'Content-addressed asset ids are immutable and safe to serve directly.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only immutable asset bytes.',
    },
    streaming: 'binary',
    notes: 'Intentional public asset read/head exception.',
  },
  {
    id: 'asset-exists',
    methods: ['POST'],
    path: '/api/v1/assets/exists',
    auth: {
      decision: 'public',
      reason: 'Existence probe reveals only missing content-addressed asset ids.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Read-only probe uses POST to carry a potentially large id list.',
    },
    streaming: 'none',
    notes: 'Intentional public read-only POST exception.',
  },
  {
    id: 'backup-mutations',
    methods: PROTOCOL_MUTATING_METHODS,
    path: '/api/v1/backups',
    match: 'prefix',
    auth: {
      decision: 'required',
      reason: 'Backup mutations create, restore, or delete persisted snapshots.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Backup mutations affect server-owned backup or repository state.',
    },
    streaming: 'none',
  },
  {
    id: 'backup-list',
    methods: READ_METHODS,
    path: '/api/v1/backups',
    auth: {
      decision: 'required',
      reason: 'Backup listing exposes persisted snapshot metadata.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only backup listing.',
    },
    streaming: 'none',
  },
  {
    id: 'request-history-list',
    methods: READ_METHODS,
    path: '/api/v1/request-history',
    auth: {
      decision: 'required',
      reason: 'Request history contains private prompts, responses, and chat metadata.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only request-history listing.',
    },
    streaming: 'none',
  },
  {
    id: 'request-history-detail',
    methods: READ_METHODS,
    path: '/api/v1/request-history/:id',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Request history records contain private prompts and responses.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only request-history detail.',
    },
    streaming: 'none',
  },
  {
    id: 'request-history-delete',
    methods: ['DELETE'],
    path: '/api/v1/request-history/:id',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Deleting a request-history record mutates private persisted history.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Only the current writer may delete persisted request-history records.',
    },
    streaming: 'none',
  },
  {
    id: 'push-vapid-public-key',
    methods: READ_METHODS,
    path: '/api/v1/push/vapid-public-key',
    auth: {
      decision: 'public',
      reason: 'The VAPID public key is intentionally public browser subscription metadata.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only push configuration route.',
    },
    streaming: 'none',
  },
  {
    id: 'push-subscription-create',
    methods: ['POST'],
    path: '/api/v1/push/subscriptions',
    auth: {
      decision: 'required',
      reason: 'Push subscriptions register an authenticated browser device.',
    },
    activeWriter: {
      decision: 'auth-session',
      reason: 'Writes browser notification credentials, not revision-tracked user state.',
    },
    streaming: 'none',
  },
  {
    id: 'push-subscription-delete',
    methods: ['DELETE'],
    path: '/api/v1/push/subscriptions',
    auth: {
      decision: 'required',
      reason: 'Push subscription removal unregisters an authenticated browser device.',
    },
    activeWriter: {
      decision: 'auth-session',
      reason: 'Writes browser notification credentials, not revision-tracked user state.',
    },
    streaming: 'none',
  },
  {
    id: 'mcp-oauth-refresh',
    methods: ['POST'],
    path: '/api/v1/mcp/oauth/refresh',
    auth: {
      decision: 'required',
      reason: 'MCP OAuth refresh uses a server-owned stored refresh credential selected by stable MCP identity.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason: 'Refreshes an upstream access token without mutating local durable state.',
    },
    streaming: 'none',
  },
  {
    id: 'embedding-operations',
    methods: ['POST'],
    path: '/api/v1/embedding-operations',
    auth: {
      decision: 'required',
      reason: 'Remote embeddings can use server-owned provider credentials.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason: 'Embedding dispatch does not mutate local durable state.',
    },
    streaming: 'none',
  },
  {
    id: 'provider-operations',
    methods: ['POST'],
    path: '/api/v1/provider-operations',
    auth: {
      decision: 'required',
      reason: 'Provider operations can use server-owned provider credentials for fixed upstream reads.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason: 'Fixed provider catalog and account reads do not mutate local durable state.',
    },
    streaming: 'none',
  },
  {
    id: 'openai-transcription',
    methods: ['POST'],
    path: '/api/v1/media/openai/transcriptions',
    auth: {
      decision: 'required',
      reason: 'Transcription uploads use a server-owned OpenAI credential and contain private media.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason: 'Transcription forwards media without mutating local durable state.',
    },
    streaming: 'none',
  },
  {
    id: 'tts-synthesis',
    methods: ['POST'],
    path: '/api/v1/tts/synthesize',
    auth: {
      decision: 'required',
      reason: 'TTS synthesis can use server-owned provider credentials and private character settings.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason: 'TTS synthesis forwards a bounded request without mutating durable state.',
    },
    streaming: 'binary',
  },
  {
    id: 'image-generation',
    methods: ['POST'],
    path: '/api/v1/image-generation',
    auth: {
      decision: 'required',
      reason: 'Image generation can use server-owned provider credentials and incur upstream cost.',
    },
    activeWriter: {
      decision: 'runtime-generation',
      reason: 'Generates an image without mutating local durable state.',
    },
    streaming: 'binary',
  },
  {
    id: 'proxy-fetch',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    path: '/api/v1/proxy/fetch',
    auth: {
      decision: 'required',
      reason: 'Generic proxy can access caller-selected upstream URLs.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason: 'Forwards a request without local durable writes.',
    },
    streaming: 'proxy',
  },
  {
    id: 'proxy-plugin-fetch',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    path: '/api/v1/proxy/plugin-fetch',
    auth: {
      decision: 'required',
      reason: 'Plugin-scoped proxy requests carry user-approved data to caller-selected public URLs.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason:
        'Forwards bounded DNS-pinned public request hops, revalidating each redirect, without local durable writes.',
    },
    streaming: 'proxy',
  },
  {
    id: 'proxy-stream-job-create',
    methods: ['POST'],
    path: '/api/v1/proxy/stream-jobs',
    auth: {
      decision: 'required',
      reason: 'Proxy stream jobs can access caller-selected local/private URLs.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason: 'Creates only process-local proxy job state.',
    },
    streaming: 'none',
  },
  {
    id: 'proxy-stream-job-cancel',
    methods: ['DELETE'],
    path: '/api/v1/proxy/stream-jobs/:id',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Proxy stream job cancellation controls an authenticated runtime job.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason: 'Deletes only process-local proxy job state.',
    },
    streaming: 'none',
  },
  {
    id: 'proxy-stream-job-websocket',
    methods: READ_METHODS,
    path: '/api/v1/proxy/stream-jobs/:id/ws',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'WebSocket attachment observes an authenticated proxy stream job.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason: 'Observe-only attachment to process-local proxy job state.',
    },
    streaming: 'websocket',
  },
  {
    id: 'hub-proxy',
    methods: HUB_METHODS,
    path: '/api/v1/hub/*',
    match: 'pattern',
    auth: {
      decision: 'conditional',
      reason: 'Public GET/HEAD/OPTIONS without override mirror legacy hub reads; all other hub requests require auth.',
    },
    activeWriter: {
      decision: 'runtime-proxy',
      reason: 'Hub routes forward upstream and do not mutate local durable state.',
    },
    streaming: 'proxy',
    notes: 'GET/HEAD/OPTIONS are public only when x-risu-node-path is absent.',
  },
  {
    id: 'legacy-storage-list',
    methods: READ_METHODS,
    path: '/api/v1/storage/list',
    auth: {
      decision: 'required',
      reason: 'Legacy storage list exposes server-owned compatibility files.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only legacy storage list.',
    },
    streaming: 'none',
  },
  {
    id: 'legacy-storage-read',
    methods: READ_METHODS,
    path: '/api/v1/storage/read',
    auth: {
      decision: 'required',
      reason: 'Legacy storage read returns server-owned compatibility file bytes.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only legacy storage read.',
    },
    streaming: 'binary',
  },
  {
    id: 'legacy-storage-exists',
    methods: READ_METHODS,
    path: '/api/v1/storage/exists',
    auth: {
      decision: 'required',
      reason: 'Legacy storage existence check reveals server-owned compatibility filenames.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only legacy storage existence check.',
    },
    streaming: 'none',
  },
  {
    id: 'legacy-storage-write',
    methods: ['POST'],
    path: '/api/v1/storage/write',
    auth: {
      decision: 'required',
      reason: 'Legacy storage write updates server-owned compatibility files.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Legacy storage write mutates server-owned compatibility files.',
    },
    streaming: 'binary',
  },
  {
    id: 'legacy-storage-remove',
    methods: ['POST'],
    path: '/api/v1/storage/remove',
    auth: {
      decision: 'required',
      reason: 'Legacy storage remove deletes server-owned compatibility files.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Legacy storage remove mutates server-owned compatibility files.',
    },
    streaming: 'none',
  },
  {
    id: 'generation-completion',
    methods: ['POST'],
    path: '/api/v1/generate/completion',
    auth: {
      decision: 'required',
      reason: 'Completion dispatch can use server-side provider secrets.',
    },
    activeWriter: {
      decision: 'runtime-generation',
      reason: 'Provider completion is a runtime request without local durable writes.',
    },
    streaming: 'sse-optional',
  },
  {
    id: 'generation-operation-submit',
    methods: ['POST'],
    path: '/api/v1/generation-operations',
    auth: {
      decision: 'required',
      reason: 'Atomic generation acceptance reads and mutates the private transcript.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Atomic generation acceptance appends and owns durable generation intent.',
    },
    streaming: 'none',
  },
  {
    id: 'generation-operation-status',
    methods: GET_ONLY,
    path: '/api/v1/generation-operations/:operationId',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Operation status exposes private accepted-send lifecycle state.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only exact operation authority probe.',
    },
    streaming: 'none',
  },
  {
    id: 'generation-operation-stream',
    methods: GET_ONLY,
    path: '/api/v1/generation-operations/:operationId/stream',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Exact-attempt reattach observes an authenticated generation stream.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only observe path for an exact operation attempt.',
    },
    streaming: 'sse',
  },
  {
    id: 'generation-operation-cancel',
    methods: ['PUT'],
    path: '/api/v1/generation-operations/:operationId/cancellation',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Operation cancellation controls private durable generation work.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Cancellation records a durable lifecycle fence.',
    },
    streaming: 'none',
  },
  {
    id: 'generation-operation-retry',
    methods: ['POST'],
    path: '/api/v1/generation-operations/:operationId/retries',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Operation retry launches an exact retained generation intent.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Retry reserves and launches a new durable attempt.',
    },
    streaming: 'none',
  },
  {
    id: 'generation-chat',
    methods: ['POST'],
    path: '/api/v1/generate/chat',
    auth: {
      decision: 'required',
      reason: 'Chat generation assembles prompts from the user database.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Chat generation can persist results and generation-time side effects.',
    },
    streaming: 'sse',
  },
  {
    id: 'generation-chat-reattach',
    methods: GET_ONLY,
    path: '/api/v1/generate/chat/:id/stream',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Reattach observes an authenticated durable chat-generation job.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only observe path for durable generation.',
    },
    streaming: 'sse',
    notes: 'Authenticated observe-only special case; intentionally not writer-gated.',
  },
  {
    id: 'generation-chat-cancel',
    methods: ['DELETE'],
    path: '/api/v1/generate/chat/:id',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Generation cancel controls an authenticated durable generation job.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Cancel is authorized by the current active writer during writer handoff.',
    },
    streaming: 'none',
  },
  {
    id: 'generation-preview-prompt',
    methods: ['POST'],
    path: '/api/v1/generate/preview-prompt',
    auth: {
      decision: 'required',
      reason: 'Prompt preview assembles from the user database and provider settings.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Prompt preview can run generation-time memory planning side effects.',
    },
    streaming: 'none',
  },
  {
    id: 'memory-job-create',
    methods: ['POST'],
    path: '/api/v1/memory/jobs',
    auth: {
      decision: 'required',
      reason: 'Memory job creation writes durable SQLite job state.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Memory job creation mutates server-owned job state.',
    },
    streaming: 'none',
  },
  {
    id: 'memory-job-list',
    methods: READ_METHODS,
    path: '/api/v1/memory/jobs',
    auth: {
      decision: 'required',
      reason: 'Memory job list exposes user chat memory job state.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only memory job listing.',
    },
    streaming: 'none',
  },
  {
    id: 'memory-job-cancel',
    methods: ['DELETE'],
    path: '/api/v1/memory/jobs/',
    match: 'prefix',
    auth: {
      decision: 'required',
      reason: 'Memory job cancellation writes durable SQLite job state.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Memory job cancellation mutates server-owned job state.',
    },
    streaming: 'none',
  },
  {
    id: 'memory-chunks',
    methods: READ_METHODS,
    path: '/api/v1/memory/chunks/:chatId',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Memory chunks expose user chat memory content.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only memory chunk route.',
    },
    streaming: 'none',
  },
  {
    id: 'memory-summaries',
    methods: READ_METHODS,
    path: '/api/v1/memory/summaries/:chatId',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Memory summaries expose user chat memory content.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only memory summary route.',
    },
    streaming: 'none',
  },
  {
    id: 'memory-summary-update',
    methods: ['PATCH'],
    path: '/api/v1/memory/summaries/:summaryId',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Memory summary editing changes user chat memory content and metadata.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Memory summary editing mutates server-owned memory state.',
    },
    streaming: 'none',
  },
  {
    id: 'memory-summary-delete',
    methods: ['DELETE'],
    path: '/api/v1/memory/summaries/:summaryId',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Memory summary deletion changes user chat memory content.',
    },
    activeWriter: {
      decision: 'active-writer',
      reason: 'Memory summary deletion mutates server-owned memory state.',
    },
    streaming: 'none',
  },
] as const satisfies readonly ProtocolRouteManifestEntry[]

const routePatternCache = new Map<string, RegExp>()

export function isProtocolMutatingMethod(method: string): boolean {
  return (PROTOCOL_MUTATING_METHODS as readonly string[]).includes(method.toUpperCase())
}

export function protocolRouteMatches(entry: ProtocolRouteManifestEntry, method: string, path: string): boolean {
  if (!(entry.methods as readonly string[]).includes(method.toUpperCase())) return false

  const match = entry.match ?? 'exact'
  if (match === 'exact') return path === entry.path
  if (match === 'prefix') return path.startsWith(entry.path)
  return routePatternRegExp(entry.path).test(path)
}

export function findProtocolRouteDecision(method: string, path: string): ProtocolRouteManifestEntry | undefined {
  return PROTOCOL_ROUTE_MANIFEST.find((entry) => protocolRouteMatches(entry, method, path))
}

export function routeRequiresActiveWriter(method: string, path: string): boolean {
  return findProtocolRouteDecision(method, path)?.activeWriter.decision === 'active-writer'
}

function routePatternRegExp(pattern: string): RegExp {
  const cached = routePatternCache.get(pattern)
  if (cached) return cached

  let source = '^'
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i]
    if (ch === ':') {
      i += 1
      while (i < pattern.length && /[A-Za-z0-9_]/.test(pattern[i] ?? '')) i += 1
      source += '[^/]+'
      continue
    }
    if (ch === '*') {
      source += '.*'
      i += 1
      continue
    }
    source += escapeRegExp(ch ?? '')
    i += 1
  }
  source += '$'

  const regexp = new RegExp(source)
  routePatternCache.set(pattern, regexp)
  return regexp
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
