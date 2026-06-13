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
      reason: 'Bootstrap returns the projected user database.',
    },
    activeWriter: {
      decision: 'writer-registration',
      reason: 'Writer-intent bootstrap can latch the latest writer session; it is not gated.',
    },
    streaming: 'none',
  },
  {
    id: 'projection',
    methods: GET_ONLY,
    path: '/api/v1/projection/:resource',
    match: 'pattern',
    auth: {
      decision: 'required',
      reason: 'Projection returns user database slices and hydrated chat/lore data.',
    },
    activeWriter: {
      decision: 'not-applicable',
      reason: 'Read-only projection route.',
    },
    streaming: 'none',
  },
  {
    id: 'projection-chat-messages-bulk',
    methods: ['POST'],
    path: '/api/v1/projection/chatMessages/bulk',
    auth: {
      decision: 'required',
      reason: 'Bulk chat hydration returns user chat histories for requested chat ids.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Bulk chat hydration is read-only; POST carries a potentially large id list.',
    },
    streaming: 'none',
  },
  {
    id: 'projection-character-lorebooks-bulk',
    methods: ['POST'],
    path: '/api/v1/projection/characterLorebooks/bulk',
    auth: {
      decision: 'required',
      reason: 'Bulk lorebook hydration returns user character lorebooks for requested character ids.',
    },
    activeWriter: {
      decision: 'read-only-post',
      reason: 'Bulk lorebook hydration is read-only; POST carries a potentially large id list.',
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
    id: 'proxy-fetch',
    methods: ['POST'],
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
