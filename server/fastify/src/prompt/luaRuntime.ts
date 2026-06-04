import { LuaFactory, type LuaEngine } from 'wasmoon'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import type {
  Chat,
  Database,
  character,
} from '../../../../src/ts/storage/database.svelte'
import type { triggerscript } from '../../../../src/ts/process/triggers'
import type { simpleCharacterArgument } from '../../../../src/ts/parser/parser.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { TriggerVarEngine } from './triggerVars.js'
import { expandVariables } from './variables.js'
import { tokenize, encodingForModel } from './tokens.js'

/**
 * Server-side Lua runtime under the single-user self-host security model.
 *
 * Ports `src/ts/process/scriptings.ts` (`runScripted` + `runLuaEditTrigger`) to the
 * Fastify server while keeping per-call engine state isolated.
 *
 * Runtime notes:
 *
 * 1. **Exec limit = wasmoon's built-in `lua_sethook` count hook (README option 1).**
 *    wasmoon 1.16.0 installs an instruction-count hook (every 1000 ops) that throws
 *    when wall-clock passes a deadline, exposed two ways: `createEngine({
 *    functionTimeout })` bounds every JS→Lua call (the dispatch: `callListenMain`,
 *    `onStart`, …) and `thread.run(argCount, { timeout })` bounds a loaded chunk. We
 *    use BOTH — `functionTimeout` for dispatch and {@link runStringWithTimeout} for
 *    the top-level user code — so a top-level `while true do end` is bounded too. No
 *    `worker_threads` fallback (README option 2) is needed. The timeout surfaces as a
 *    generic `Error` whose message contains "timeout" (the `LuaTimeoutError` class is
 *    lost across the Lua→JS error boundary), so we detect it by message.
 * 2. **`json.lua` is read from disk at boot**, path resolved relative to this module
 *    (`import.meta.url`) so it is deterministic under `pnpm api:test` regardless of
 *    cwd. Mounted once into a module-singleton {@link LuaFactory}.
 * 3. **Per-call engine isolation.** The factory (wasm + mounted json.lua) is a
 *    singleton, but `createEngine` runs per {@link runServerLua} call and is closed in
 *    `finally`, so one chat's Lua globals never leak into another. Access-control sets
 *    (`safeIds`/`lowLevelIds`/`editDisplayIds`) are per-call closures rather than the
 *    browser's module-level sets.
 * 4. **`OpenAIChat` round-trip** is byte-faithful for the text-send subset (proven by
 *    the editRequest unit test).
 */

// ── Limits (the self-host bar) ──────────────────────────────────────────────

/** Default per-run Lua execution deadline. Bounds runaway scripts. */
const DEFAULT_EXEC_TIMEOUT_MS = 3000
/** Max URL length accepted by `request()` (mirrors `scriptings.ts:330`). */
const MAX_URL_LENGTH = 120
/** `request()` calls allowed per rolling window. The browser allowed ~5-6/min
 * (`scriptings.ts:319-322`); the operator loosened this to 30/min for self-host. */
const MAX_REQUESTS_PER_WINDOW = 30
const REQUEST_WINDOW_MS = 60_000
/** Egress fetch wall-clock + response-size caps (the browser fetch has neither). */
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 2_000_000
/** `sleep()` caps: per-call and per-run (the browser caps neither). */
const MAX_SLEEP_MS = 2000
const MAX_TOTAL_SLEEP_MS = 6000

// Banned egress targets carried over from the browser (`scriptings.ts:344`).
const BANNED_URL_PREFIXES = [
  'https://realm.risuai.net',
  'https://risuai.net',
  'https://risuai.xyz',
]

// json.lua + factory singleton.

let luaFactoryPromise: Promise<LuaFactory> | null = null

/**
 * Resolve `public/lua/json.lua` from this module's location so the path holds
 * under any cwd (`pnpm api:test` runs with `root: server/fastify`). This file is
 * at `server/fastify/src/prompt/`, so the repo root is four levels up.
 */
function resolveJsonLuaPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '../../../../public/lua/json.lua')
}

/** Build (once) a `LuaFactory` with `json.lua` mounted, mirroring the browser's
 * `makeLuaFactory` (`scriptings.ts:1191-1208`) but reading from disk. */
async function getLuaFactory(): Promise<LuaFactory> {
  if (!luaFactoryPromise) {
    luaFactoryPromise = (async () => {
      const factory = new LuaFactory()
      const json = await readFile(resolveJsonLuaPath(), 'utf8')
      await factory.mountFile('json.lua', json)
      return factory
    })().catch((error) => {
      // Reset so a transient FS error can be retried on the next call.
      luaFactoryPromise = null
      throw error
    })
  }
  return luaFactoryPromise
}

// ── request() egress guard (the SSRF gate) ──────────────────────────────────

/**
 * Dependency seams for the egress guard. Production uses Node's DNS + a pinned
 * `https.request`; tests inject `lookup`/`fetchImpl`/`now` so the guard is proven
 * deterministically with no real network.
 */
export interface EgressDeps {
  /** Resolve a hostname to all of its addresses. Defaults to `dns.lookup(host, {all:true})`. */
  lookup?: (host: string) => Promise<Array<{ address: string; family: number }>>
  /** Perform the actual fetch against a pre-validated address set. Defaults to a
   * pinned `https.request`. Receives the originating request's abort signal so an
   * in-flight egress fetch dies with the request that spawned it (audit L20). */
  fetchImpl?: (
    url: string,
    addresses: string[],
    signal?: AbortSignal,
  ) => Promise<{ status: number; data: string }>
  /** Clock seam for the rate limiter. Defaults to `Date.now`. */
  now?: () => number
}

/** Rolling-window rate state. A module singleton by default (single-user host →
 * one global budget), injectable per-call for tests. */
export interface RequestRateState {
  count: number
  resetAt: number
}

const sharedRateState: RequestRateState = { count: 0, resetAt: 0 }

export type EgressVerdict =
  | { ok: true; addresses: string[] }
  | { ok: false; status: number; data: string }

/**
 * True for any address the server must not connect to: loopback, link-local
 * (incl. the cloud metadata IP `169.254.169.254`), private, CGNAT, unspecified,
 * multicast/reserved, IPv6 ULA/link-local. IPv4-mapped IPv6 is unwrapped first.
 * Unparseable input is blocked (deny-by-default).
 */
export function isBlockedAddress(addr: string): boolean {
  if (typeof addr !== 'string') return true
  let ip = addr.trim().toLowerCase()
  const zone = ip.indexOf('%')
  if (zone !== -1) ip = ip.slice(0, zone) // strip IPv6 zone id (fe80::1%eth0)
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip)
  if (mapped) ip = mapped[1]
  const family = isIP(ip)
  if (family === 4) return isBlockedV4(ip)
  if (family === 6) return isBlockedV6(ip)
  return true
}

function isBlockedV4(ip: string): boolean {
  const octets = ip.split('.').map((n) => Number(n))
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = octets
  if (a === 0) return true // 0.0.0.0/8 "this host"
  if (a === 10) return true // 10/8 private
  if (a === 127) return true // 127/8 loopback
  if (a === 169 && b === 254) return true // 169.254/16 link-local (+ metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12 private
  if (a === 192 && b === 168) return true // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true // 192.0.0/24 protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 benchmarking
  if (a >= 224) return true // 224/4 multicast, 240/4 reserved, 255.255.255.255 broadcast
  return false
}

function isBlockedV6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true // unspecified / loopback
  // fe80::/10 link-local spans fe80..febf.
  if (/^fe[89ab]/.test(ip)) return true
  // fc00::/7 unique-local (includes fd00::/8).
  if (/^f[cd]/.test(ip)) return true
  // Transition addresses embed an IPv4 target the connection ultimately
  // reaches; classify that embedded address too (audit L23). Covers
  // IPv4-mapped in hex form (`::ffff:7f00:1`), IPv4-compatible (`::7f00:1`),
  // 6to4 (`2002:7f00:1::`), and NAT64 (`64:ff9b::7f00:1`).
  const embedded = embeddedV4InV6(ip)
  if (embedded !== null) return isBlockedV4(embedded)
  return false
}

/** Expand a valid IPv6 literal (lowercase, no zone) into its 8 16-bit groups.
 *  Returns null on anything that does not parse (callers treat that as "no
 *  embedded address"; `isBlockedAddress` already denies unparseable input). */
function parseV6Groups(ip: string): number[] | null {
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const parseSide = (side: string): number[] | null => {
    if (side.length === 0) return []
    const groups: number[] = []
    const parts = side.split(':')
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part.includes('.')) {
        // Dotted-quad tail (`::ffff:127.0.0.1`) occupies the last two groups.
        if (i !== parts.length - 1) return null
        const octets = part.split('.').map((n) => Number(n))
        if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
          return null
        }
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3])
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null
      groups.push(Number.parseInt(part, 16))
    }
    return groups
  }
  const head = parseSide(halves[0])
  const tail = halves.length === 2 ? parseSide(halves[1]) : []
  if (!head || !tail) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const fill = 8 - head.length - tail.length
  if (fill < 0) return null
  return [...head, ...(Array(fill).fill(0) as number[]), ...tail]
}

/** The IPv4 address embedded in an IPv6 transition form, or null. */
function embeddedV4InV6(ip: string): string | null {
  const groups = parseV6Groups(ip)
  if (!groups) return null
  const v4 = (hi: number, lo: number): string =>
    `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  const allZero = (from: number, to: number): boolean =>
    groups.slice(from, to).every((group) => group === 0)
  // IPv4-mapped ::ffff:0:0/96 (hex form; the dotted form is unwrapped by
  // `isBlockedAddress`) and IPv4-compatible ::/96.
  if (allZero(0, 5) && (groups[5] === 0xffff || groups[5] === 0)) {
    return v4(groups[6], groups[7])
  }
  // 6to4 2002::/16 carries the IPv4 address in bits 16-48.
  if (groups[0] === 0x2002) return v4(groups[1], groups[2])
  // NAT64 well-known prefix 64:ff9b::/96.
  if (groups[0] === 0x64 && groups[1] === 0xff9b && allZero(2, 6)) {
    return v4(groups[6], groups[7])
  }
  return null
}

/**
 * Validate a `request()` URL before any socket opens: length, https-only, the
 * banned-host list, `localhost` by name, and — the SSRF guard the browser lacks —
 * DNS resolution with every resolved address classified against
 * {@link isBlockedAddress}. Returns the validated address set so the caller can
 * pin the connection to it (no DNS-rebinding window).
 */
export async function validateEgressUrl(
  url: string,
  deps: EgressDeps = {},
): Promise<EgressVerdict> {
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) {
    return { ok: false, status: 413, data: 'URL to large. max is 120 characters' }
  }
  if (!url.startsWith('https://')) {
    return { ok: false, status: 400, data: 'Only https requests are allowed' }
  }
  for (const banned of BANNED_URL_PREFIXES) {
    if (url.startsWith(banned)) {
      return { ok: false, status: 400, data: 'request to ' + url + ' is not allowed' }
    }
  }

  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return { ok: false, status: 400, data: 'Invalid URL' }
  }
  const host = hostname.replace(/^\[|\]$/g, '') // strip IPv6 literal brackets
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost')) {
    return { ok: false, status: 403, data: 'Requests to localhost are not allowed' }
  }

  // A literal IP needs no DNS — classify it directly.
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      return { ok: false, status: 403, data: 'Requests to private or reserved addresses are not allowed' }
    }
    return { ok: true, addresses: [host] }
  }

  let resolved: Array<{ address: string; family: number }>
  try {
    resolved = deps.lookup ? await deps.lookup(host) : await dnsLookup(host, { all: true })
  } catch {
    return { ok: false, status: 400, data: 'DNS resolution failed' }
  }
  if (!resolved || resolved.length === 0) {
    return { ok: false, status: 400, data: 'DNS resolution failed' }
  }
  for (const entry of resolved) {
    if (isBlockedAddress(entry.address)) {
      return { ok: false, status: 403, data: 'Requests to private or reserved addresses are not allowed' }
    }
  }
  return { ok: true, addresses: resolved.map((entry) => entry.address) }
}

/** Default egress fetch: an https GET whose DNS lookup is pinned to a
 * pre-validated address (so the socket cannot be rebound to a private IP between
 * validation and connect), with wall-clock and response-size caps. SNI/cert
 * validation still use the URL hostname. */
function pinnedHttpsFetch(
  url: string,
  addresses: string[],
  signal?: AbortSignal,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('request aborted'))
      return
    }
    const pinned = addresses[0]
    const pinnedLookup = (
      _hostname: string,
      options: unknown,
      callback?: (err: Error | null, address: string, family: number) => void,
    ) => {
      const cb = (typeof options === 'function' ? options : callback) as (
        err: Error | null,
        address: string,
        family: number,
      ) => void
      cb(null, pinned, isIP(pinned))
    }
    const req = httpsRequest(
      url,
      { method: 'GET', timeout: REQUEST_TIMEOUT_MS, lookup: pinnedLookup as never },
      (res) => {
        let body = ''
        let size = 0
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          size += chunk.length
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error('response too large'))
            return
          }
          body += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, data: body }))
      },
    )
    // Abort propagation (audit L20): when the originating request ends, the
    // in-flight egress socket is torn down instead of waiting out
    // REQUEST_TIMEOUT_MS. `destroy(err)` fires the 'error' handler → reject.
    const onAbort = (): void => {
      req.destroy(new Error('request aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('close', () => signal?.removeEventListener('abort', onAbort))
    req.on('timeout', () => req.destroy(new Error('request timeout')))
    req.on('error', (error) => reject(error))
    req.end()
  })
}

/**
 * The `request()` host-fn body: rate-limit → validate (SSRF guard) → pinned fetch.
 * Returns the same `{status, data}` JSON-string shape the browser returns
 * (`scriptings.ts:309-369`) so Lua callers are unchanged.
 */
export async function serverLuaRequest(
  url: string,
  deps: EgressDeps = {},
  rateState: RequestRateState = sharedRateState,
  signal?: AbortSignal,
): Promise<string> {
  const now = deps.now ? deps.now() : Date.now()
  if (rateState.resetAt + REQUEST_WINDOW_MS < now) {
    rateState.count = 0
    rateState.resetAt = now
  }
  if (rateState.count >= MAX_REQUESTS_PER_WINDOW) {
    return JSON.stringify({
      status: 429,
      data: 'Too many requests. you can request 30 times per minute',
    })
  }

  const verdict = await validateEgressUrl(url, deps)
  if (!verdict.ok) {
    // Narrow explicitly: this file is also type-checked under the root tsconfig
    // (the browser suite imports the server app), whose `strictNullChecks: false`
    // does not narrow `!verdict.ok` on a discriminated union; the server's strict
    // config narrows it fine. The Extract keeps both paths valid.
    const failure = verdict as Extract<EgressVerdict, { ok: false }>
    return JSON.stringify({ status: failure.status, data: failure.data })
  }
  // An abort during DNS validation must not consume the egress budget or open
  // a socket (audit L20): throw so the in-flight `:await()` terminates the run.
  if (signal?.aborted) throw new LuaAbortError('request aborted')
  // Count only validated requests (audit L25): a blocked URL must not consume
  // the egress budget, or a single misbehaving script could starve legit calls.
  rateState.count++
  try {
    const fetchImpl = deps.fetchImpl ?? pinnedHttpsFetch
    const result = await fetchImpl(url, verdict.addresses, signal)
    return JSON.stringify({ status: result.status, data: result.data })
  } catch (error) {
    // Abort is a cancellation, not a fetch failure: rethrow (audit L20) so the
    // Lua `:await()` raises and the surrounding pcall unwinds, instead of the
    // script continuing on a synthetic 400.
    if (signal?.aborted) throw new LuaAbortError('request aborted')
    if (error instanceof LuaAbortError) throw error
    return JSON.stringify({ status: 400, data: 'internal error' })
  }
}

// ── The Lua prelude (ported verbatim from `scriptings.ts:1262`) ──────────────

/**
 * The browser's `luaCodeWrapper` (`scriptings.ts:1262-1413`), copied byte-for-byte.
 * It is pure Lua — `require 'json'`, the `getChat`/`LLM`/`log` JSON wrappers,
 * `listenEdit`, `getState`/`setState`, `async`, and `callListenMain` — and is the
 * contract the edit-hook dispatch depends on, so it must stay identical for
 * `callListenMain` to round-trip.
 */
function luaCodeWrapper(code: string): string {
  return `
json = require 'json'

function getChat(id, index)
    return json.decode(getChatMain(id, index))
end

function getFullChat(id)
    return json.decode(getFullChatMain(id))
end

function setFullChat(id, value)
    setFullChatMain(id, json.encode(value))
end

function log(value)
    logMain(json.encode(value))
end

function getLoreBooks(id, search)
    return json.decode(getLoreBooksMain(id, search))
end


function loadLoreBooks(id)
    return json.decode(loadLoreBooksMain(id):await())
end

function LLM(id, prompt, useMultimodal, options)
    useMultimodal = useMultimodal or false
    options = options or {}
    return json.decode(LLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

function axLLM(id, prompt, useMultimodal, options)
    useMultimodal = useMultimodal or false
    options = options or {}
    return json.decode(axLLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

function getCharacterImage(id)
    return getCharacterImageMain(id):await()
end

function getPersonaImage(id)
    return getPersonaImageMain(id):await()
end

local editRequestFuncs = {}
local editDisplayFuncs = {}
local editInputFuncs = {}
local editOutputFuncs = {}

function listenEdit(type, func)
    if type == 'editRequest' then
        editRequestFuncs[#editRequestFuncs + 1] = func
        return
    end

    if type == 'editDisplay' then
        editDisplayFuncs[#editDisplayFuncs + 1] = func
        return
    end

    if type == 'editInput' then
        editInputFuncs[#editInputFuncs + 1] = func
        return
    end

    if type == 'editOutput' then
        editOutputFuncs[#editOutputFuncs + 1] = func
        return
    end

    throw('Invalid type')
end

function getState(id, name)
    local escapedName = "__"..name
    return json.decode(getChatVar(id, escapedName))
end

function setState(id, name, value)
    local escapedName = "__"..name
    setChatVar(id, escapedName, json.encode(value))
end

function async(callback)
    return function(...)
        local co = coroutine.create(callback)
        local safe, result = coroutine.resume(co, ...)

        return Promise.create(function(resolve, reject)
            local checkresult
            local step = function()
                if coroutine.status(co) == "dead" then
                    local send = safe and resolve or reject
                    return send(result)
                end

                safe, result = coroutine.resume(co)
                checkresult()
            end

            checkresult = function()
                if safe and result == Promise.resolve(result) then
                    result:finally(step)
                else
                    step()
                end
            end

            checkresult()
        end)
    end
end

callListenMain = async(function(type, id, value, meta)
    local realValue = json.decode(value)
    local realMeta = json.decode(meta)

    if type == 'editRequest' then
        for _, func in ipairs(editRequestFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    if type == 'editDisplay' then
        for _, func in ipairs(editDisplayFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    if type == 'editInput' then
        for _, func in ipairs(editInputFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    if type == 'editOutput' then
        for _, func in ipairs(editOutputFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    return json.encode(realValue)
end)

${code}
`
}

// ── Runtime context + state ─────────────────────────────────────────────────

/**
 * Everything the server must hand the VM in place of the browser's global stores
 * (`getCurrentChat`/`getCurrentCharacter`/`getDatabase`/`selectedCharID`).
 */
export interface ServerLuaRuntimeContext {
  /** Working chat whose `message[]` the chat host fns read and mutate. */
  chat: Chat
  /** Active database snapshot — `getGlobalVar` reads, `cbs` scope. */
  database: Database
  /** Index into `database.characters` (cbs scope + char fallbacks). */
  selectedCharID: number
  /** Index into the character's `chats` (cbs scope). */
  chatPage: number
  /**
   * The chat-var engine `getChatVar`/`setChatVar` (and thus `getState`/`setState`)
   * bind to. Pass the SAME `createTriggerVarEngine` the assembler mutates so Lua's
   * writes land in the scriptstate delta for free (README §Integration).
   */
  varEngine: TriggerVarEngine
  /** Working character (cbs `chara`, `getName`/`getDescription`, setters). */
  char?: character | simpleCharacterArgument
  /** Active model id, for `getTokens` encoding selection. */
  model?: string
  /** Egress dependency overrides (tests inject fake DNS/fetch/clock). */
  egress?: EgressDeps
  /** Shared `request()` rate-limit state; defaults to the module singleton. */
  rateState?: RequestRateState
  /**
   * Originating-request abort signal (audit L20). When it fires, in-flight
   * hook work is cancelled: the load thread's deadline is pulled to "now"
   * (cooperating with the exec-limit hook), every host-fn call throws, and
   * `sleep` wakes early. Pure-compute stretches between host calls remain
   * bounded by the exec limit.
   */
  signal?: AbortSignal
}

interface RuntimeState {
  ctx: ServerLuaRuntimeContext
  safeIds: Set<string>
  lowLevelIds: Set<string>
  editDisplayIds: Set<string>
  stopSending: boolean
  /** Set true the moment an interactive host fn (`alert*Input/Select/Confirm`) is
   * invoked — surfaced so the caller can route the send `unsupported`. */
  interactiveInvoked: boolean
  sleptMs: number
}

export interface RunServerLuaOptions {
  code: string
  mode: string
  data?: string | OpenAIChat[]
  meta?: object
  /** Grants the low-level host fns (`request`/`LLM`/`similarity`/…). Edit hooks run
   * with this `false` (browser parity, `scriptings.ts:1443`). */
  lowLevelAccess?: boolean
  /** Per-run execution deadline (ms). Defaults to {@link DEFAULT_EXEC_TIMEOUT_MS}. */
  execTimeoutMs?: number
}

export interface ServerLuaResult {
  /** A handler returned `false` or called `stopChat` — the send should stop. */
  stopSending: boolean
  /** The dispatch result (parsed object for edit modes; raw otherwise). */
  res: unknown
  /** The exec limit interrupted the script. */
  timedOut: boolean
  /** An interactive host fn was invoked (no server equivalent → `unsupported`). */
  interactiveInvoked: boolean
  /** The originating request's abort signal fired during the run (L20). */
  aborted?: boolean
  /** Captured load/dispatch error message, if any (the browser swallows these). */
  error?: string
}

function asCharacter(ctx: ServerLuaRuntimeContext): character | undefined {
  const char = ctx.char
  return char && (char as { type?: string }).type === 'character'
    ? (char as character)
    : undefined
}

/** Sleep that wakes early when `signal` fires, so an aborted request never
 *  waits out the remaining `sleep()` budget (the very next host-fn call then
 *  throws {@link LuaAbortError}). */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms)
      return
    }
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout/i.test(message)
}

/** Error thrown by interactive host fns so the dispatch can tag the result. */
class InteractiveApiError extends Error {}

/** Error thrown by every host fn once the request signal has fired (L20). */
class LuaAbortError extends Error {}

// ── Host functions (the disposition table, README §Host-function disposition) ─

/**
 * Declare the full browser host-fn surface on `engine`, bound to `state`:
 *   - **Pure** fns operate on the server's in-memory chat / vars / char / db;
 *   - **Gated** fns (`request`) run behind the SSRF guard + low-level access;
 *   - **Deferred** privileged fns (`LLM`/`similarity`/`generateImage`/image getters/
 *     lorebook loaders) return an explicit error/empty so callers do not crash;
 *   - **Interactive** fns (`alert*Input/Select/Confirm`) throw and flag the run;
 *   - **Browser-only** fns (`alertError`/`alertNormal`/`reloadDisplay`/`reloadChat`)
 *     are no-ops.
 * Mirrors the `id`-gating from `scriptings.ts` (`safeIds` for safe writes,
 * `editDisplayIds` additionally for `setChatVar`, `lowLevelIds` for privileged).
 */
function declareHostFunctions(engine: LuaEngine, state: RuntimeState): void {
  const declare = (name: string, fn: (...args: any[]) => unknown) => {
    // Every host fn is the abort checkpoint (L20): once the request signal
    // fires, the next host call throws, terminating the surrounding pcall.
    engine.global.set(name, (...args: any[]) => {
      if (state.ctx.signal?.aborted) {
        throw new LuaAbortError('request aborted')
      }
      return fn(...args)
    })
  }
  const canWrite = (id: string) => state.safeIds.has(id)
  const canWriteVar = (id: string) =>
    state.safeIds.has(id) || state.editDisplayIds.has(id)
  const canLowLevel = (id: string) => state.lowLevelIds.has(id)

  // ── Pure: chat vars (bound to the assembler's var engine) ──
  declare('getChatVar', (_id: string, key: string) => state.ctx.varEngine.getVar(key))
  declare('setChatVar', (id: string, key: string, value: string) => {
    if (!canWriteVar(id)) return
    state.ctx.varEngine.setVar(key, value)
  })
  declare('getGlobalVar', (_id: string, key: string) => {
    const value = (state.ctx.database.globalChatVariables ?? {})[key]
    return value === undefined || value === null ? 'null' : String(value)
  })

  // ── Pure: run-control + logging ──
  declare('stopChat', (id: string) => {
    if (!canWrite(id)) return
    state.stopSending = true
  })
  declare('logMain', (value: string) => {
    try {
      console.log(JSON.parse(value))
    } catch {
      console.log(value)
    }
  })

  // ── Browser-only UI: no-op (gated, like the browser) ──
  declare('alertError', (id: string) => {
    if (!canWrite(id)) return
  })
  declare('alertNormal', (id: string) => {
    if (!canWrite(id)) return
  })
  declare('reloadDisplay', (id: string) => {
    if (!canWrite(id)) return
  })
  declare('reloadChat', (id: string) => {
    if (!canWrite(id)) return
  })

  // ── Interactive: no server equivalent — flag + fail explicitly ──
  const interactive = (id: string, label: string): never | undefined => {
    if (!canWrite(id)) return undefined
    state.interactiveInvoked = true
    throw new InteractiveApiError(
      `${label} requires browser interaction and is not supported by server prompt assembly`,
    )
  }
  declare('alertInput', (id: string) => interactive(id, 'alertInput'))
  declare('alertSelect', (id: string) => interactive(id, 'alertSelect'))
  declare('alertConfirm', (id: string) => interactive(id, 'alertConfirm'))

  // ── Pure: chat message array ──
  declare('getChatMain', (_id: string, index: number) => {
    const message = state.ctx.chat.message.at(index)
    if (!message) return JSON.stringify(null)
    return JSON.stringify({ role: message.role, data: message.data, time: message.time ?? 0 })
  })
  declare('setChat', (id: string, index: number, value: string) => {
    if (!canWrite(id)) return
    const message = state.ctx.chat.message?.at(index)
    if (message) message.data = value ?? ''
  })
  declare('setChatRole', (id: string, index: number, value: string) => {
    if (!canWrite(id)) return
    const message = state.ctx.chat.message?.at(index)
    if (message) message.role = value === 'user' ? 'user' : 'char'
  })
  declare('cutChat', (id: string, start: number, end: number) => {
    if (!canWrite(id)) return
    state.ctx.chat.message = state.ctx.chat.message.slice(start, end)
  })
  declare('removeChat', (id: string, index: number) => {
    if (!canWrite(id)) return
    state.ctx.chat.message.splice(index, 1)
  })
  declare('addChat', (id: string, role: string, value: string) => {
    if (!canWrite(id)) return
    state.ctx.chat.message.push({ role: role === 'user' ? 'user' : 'char', data: value ?? '' })
  })
  declare('insertChat', (id: string, index: number, role: string, value: string) => {
    if (!canWrite(id)) return
    state.ctx.chat.message.splice(index, 0, {
      role: role === 'user' ? 'user' : 'char',
      data: value ?? '',
    })
  })
  declare('getChatLength', (_id: string) => state.ctx.chat.message.length)
  declare('getFullChatMain', (_id: string) =>
    JSON.stringify(
      state.ctx.chat.message.map((v) => ({ role: v.role, data: v.data, time: v.time ?? 0 })),
    ),
  )
  declare('setFullChatMain', (id: string, value: string) => {
    if (!canWrite(id)) return
    const parsed = JSON.parse(value) as Array<{ role: string; data: string }>
    state.ctx.chat.message = parsed.map((v) => ({
      role: v.role === 'user' ? 'user' : 'char',
      data: v.data,
    }))
  })
  declare('getCharacterLastMessage', (_id: string) => {
    const messages = state.ctx.chat.message
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'char') return messages[i].data
    }
    return asCharacter(state.ctx)?.firstMessage ?? ''
  })
  declare('getUserLastMessage', (_id: string) => {
    const messages = state.ctx.chat.message
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].data
    }
    return ''
  })

  // ── Pure: tokens / cbs / hash (server adapters) ──
  declare('getTokens', async (id: string, value: string) => {
    if (!canWrite(id)) return
    return tokenize(String(value ?? ''), encodingForModel(state.ctx.model))
  })
  declare('cbs', (value: string) =>
    expandVariables(String(value ?? ''), {
      database: state.ctx.database,
      selectedCharID: state.ctx.selectedCharID,
      chatPage: state.ctx.chatPage,
      chara: asCharacter(state.ctx),
    }).text,
  )
  declare('hash', async (_id: string, value: string) =>
    createHash('sha256').update(new TextEncoder().encode(String(value ?? ''))).digest('hex'),
  )

  // ── Pure: character / persona getters + setters ──
  declare('getName', (_id: string) => asCharacter(state.ctx)?.name ?? '')
  declare('setName', (id: string, name: string) => {
    if (!canWrite(id)) return
    const char = asCharacter(state.ctx)
    if (char && typeof name === 'string') char.name = name
  })
  declare('getDescription', (id: string) => {
    if (!canWrite(id)) return
    return asCharacter(state.ctx)?.desc ?? ''
  })
  declare('setDescription', (id: string, desc: string) => {
    if (!canWrite(id)) return
    const char = asCharacter(state.ctx)
    if (char && typeof desc === 'string') char.desc = desc
  })
  declare('getCharacterFirstMessage', (_id: string) => asCharacter(state.ctx)?.firstMessage ?? '')
  declare('setCharacterFirstMessage', (id: string, data: string) => {
    if (!canWrite(id)) return false
    const char = asCharacter(state.ctx)
    if (!char || typeof data !== 'string') return false
    char.firstMessage = data
    return true
  })
  declare('getPersonaName', (_id: string) => state.ctx.database.username ?? '')
  declare('getPersonaDescription', (_id: string) => {
    // Browser parses the persona prompt against the current char; server persona
    // assembly lives elsewhere, so this runtime returns an empty string.
    return ''
  })
  declare('getAuthorsNote', (_id: string) => state.ctx.chat?.note ?? '')
  declare('getBackgroundEmbedding', (id: string) => {
    if (!canWrite(id)) return
    return asCharacter(state.ctx)?.backgroundHTML ?? ''
  })
  declare('setBackgroundEmbedding', (id: string, data: string) => {
    if (!canWrite(id)) return false
    const char = asCharacter(state.ctx)
    if (!char || typeof data !== 'string') return false
    char.backgroundHTML = data
    return true
  })

  // ── Lore books: pure write (upsert) + empty reads ──
  declare(
    'upsertLocalLoreBook',
    (
      id: string,
      name: string,
      content: string,
      options: {
        alwaysActive?: boolean
        insertOrder?: number
        key?: string
        secondKey?: string
        regex?: boolean
      },
    ) => {
      if (!canWrite(id)) return
      const char = asCharacter(state.ctx)
      if (!char) return
      const {
        alwaysActive = false,
        insertOrder = 100,
        key = '',
        regex = false,
        secondKey = '',
      } = options ?? {}
      const chat = state.ctx.chat
      chat.localLore = (chat.localLore ?? []).filter((book) => book.comment !== name)
      chat.localLore.push({
        alwaysActive,
        comment: name,
        content,
        insertorder: insertOrder,
        mode: 'normal',
        key,
        secondkey: secondKey,
        selective: !!secondKey,
        useRegex: regex,
      } as never)
    },
  )
  // getLoreBooks/loadLoreBooks read activation state the runtime does not own;
  // return empty so callers degrade rather than crash.
  declare('getLoreBooksMain', (_id: string, _search: string) => JSON.stringify([]))
  declare('loadLoreBooksMain', async (id: string) => {
    if (!canLowLevel(id)) return
    return JSON.stringify([])
  })

  // ── Gated: SSRF-guarded egress ──
  declare('request', async (id: string, url: string) => {
    if (!canLowLevel(id)) return
    return serverLuaRequest(
      String(url ?? ''),
      state.ctx.egress,
      state.ctx.rateState ?? sharedRateState,
      state.ctx.signal,
    )
  })

  // ── Gated: sleep (capped per-call + per-run) ──
  declare('sleep', async (id: string, time: number) => {
    if (!canWrite(id)) return
    const requested = Math.max(0, Number(time) || 0)
    if (state.sleptMs >= MAX_TOTAL_SLEEP_MS) return false
    const ms = Math.min(requested, MAX_SLEEP_MS, MAX_TOTAL_SLEEP_MS - state.sleptMs)
    state.sleptMs += ms
    await delay(ms, state.ctx.signal)
    return true
  })

  // ── Deferred privileged fns: explicit error / empty (README disposition) ──
  declare('similarity', async (id: string) => {
    if (!canLowLevel(id)) return
    return [] // server embedding infra deferred to a later slice
  })
  declare('generateImage', async (id: string) => {
    if (!canLowLevel(id)) return
    return 'Error: Image generation is not supported by server prompt assembly'
  })
  declare('getCharacterImageMain', async (_id: string) => '')
  declare('getPersonaImageMain', async (_id: string) => '')
  const deferredLLM = async (id: string) => {
    if (!canLowLevel(id)) return
    return JSON.stringify({
      success: false,
      result: 'Error: LLM access is not available in server prompt assembly (deferred)',
    })
  }
  declare('LLMMain', deferredLLM)
  declare('axLLMMain', deferredLLM)
  declare('simpleLLM', async (id: string) => {
    if (!canLowLevel(id)) return
    return {
      success: false,
      result: 'Error: LLM access is not available in server prompt assembly (deferred)',
    }
  })
}

// Bounded load.

/**
 * `engine.doString` equivalent that bounds the load with a wall-clock timeout, so
 * a top-level `while true do end` in the user code is interrupted (the
 * `functionTimeout` engine option only bounds JS→Lua *calls*, not the initial
 * load). Mirrors wasmoon's own `callByteCode` (run a chunk on a child thread) but
 * passes `{ timeout }` to `thread.run`. Globals defined by the chunk persist on the
 * shared `_G`, exactly as `doString` does.
 */
async function runStringWithTimeout(
  engine: LuaEngine,
  code: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const global = engine.global
  const thread = global.newThread()
  const threadIndex = global.getTop()
  // Abort propagation (L20): pulling the thread deadline to the epoch makes the
  // run loop's next yield-boundary check throw. A pure-compute chunk that never
  // yields stays bounded by `timeoutMs` itself (the count hook's own deadline).
  const onAbort = (): void => thread.setTimeout(1)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (signal?.aborted) throw new LuaAbortError('request aborted')
    thread.loadString(code)
    await thread.run(0, { timeout: timeoutMs })
  } finally {
    signal?.removeEventListener('abort', onAbort)
    global.remove(threadIndex)
  }
}

// ── runScripted equivalent ──────────────────────────────────────────────────

/**
 * Server port of `runScripted` (`scriptings.ts:62`), Lua only. Creates a fresh
 * engine (decision 3), declares the host-fn surface, runs the wrapped user code
 * under the exec limit, mints an access key, dispatches by `mode`, and returns a
 * structured result. Load/dispatch errors are captured (not thrown) the way the
 * browser swallows them — but a timeout or interactive-API invocation is surfaced
 * on the result so callers can act on it.
 */
export async function runServerLua(
  opts: RunServerLuaOptions,
  ctx: ServerLuaRuntimeContext,
): Promise<ServerLuaResult> {
  const execTimeoutMs = opts.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS
  const data = opts.data ?? ''
  const meta = opts.meta ?? {}
  const lowLevelAccess = opts.lowLevelAccess ?? false
  const signal = ctx.signal

  // An already-cancelled request never boots an engine (L20).
  if (signal?.aborted) {
    return {
      stopSending: false,
      res: undefined,
      timedOut: false,
      interactiveInvoked: false,
      aborted: true,
      error: 'request aborted',
    }
  }

  const state: RuntimeState = {
    ctx,
    safeIds: new Set<string>(),
    lowLevelIds: new Set<string>(),
    editDisplayIds: new Set<string>(),
    stopSending: false,
    interactiveInvoked: false,
    sleptMs: 0,
  }

  const factory = await getLuaFactory()
  const engine = await factory.createEngine({
    injectObjects: true,
    functionTimeout: execTimeoutMs,
  })

  const result: ServerLuaResult = {
    stopSending: false,
    res: undefined,
    timedOut: false,
    interactiveInvoked: false,
  }

  try {
    declareHostFunctions(engine, state)

    try {
      await runStringWithTimeout(engine, luaCodeWrapper(opts.code), execTimeoutMs, signal)
    } catch (error) {
      // A load failure (syntax error or a top-level runaway loop) leaves nothing to
      // dispatch. Record it and return identity, mirroring the browser's
      // error-swallowing `runLuaEditTrigger`.
      result.error = error instanceof Error ? error.message : String(error)
      // An abort surfaces through the same deadline machinery; report it as a
      // cancellation, not an exec-limit timeout.
      result.timedOut = isTimeoutError(error) && !signal?.aborted
      return result
    }

    if (signal?.aborted) return result

    const accessKey = randomUUID()
    if (opts.mode === 'editDisplay') {
      state.editDisplayIds.add(accessKey)
    } else {
      state.safeIds.add(accessKey)
      if (lowLevelAccess) state.lowLevelIds.add(accessKey)
    }

    try {
      let res: unknown
      const get = (name: string) => engine.global.get(name) as ((...a: unknown[]) => unknown) | undefined
      switch (opts.mode) {
        case 'input': {
          const fn = get('onInput')
          if (fn) res = await fn(accessKey)
          break
        }
        case 'output': {
          const fn = get('onOutput')
          if (fn) res = await fn(accessKey)
          break
        }
        case 'start': {
          const fn = get('onStart')
          if (fn) res = await fn(accessKey)
          break
        }
        case 'onButtonClick': {
          const fn = get('onButtonClick')
          if (fn) res = await fn(accessKey, data)
          break
        }
        case 'editRequest':
        case 'editDisplay':
        case 'editInput':
        case 'editOutput': {
          const fn = get('callListenMain')
          if (fn) {
            const raw = await fn(opts.mode, accessKey, JSON.stringify(data), JSON.stringify(meta))
            res = JSON.parse(raw as string)
          }
          break
        }
        default: {
          const fn = get(opts.mode)
          if (fn) res = await fn(accessKey)
          break
        }
      }
      if (res === false) state.stopSending = true
      result.res = res
    } catch (error) {
      // Browser parity: the dispatch switch swallows errors (`scriptings.ts:1139`).
      // We additionally record the cause so a timeout / interactive abort is visible.
      result.error = error instanceof Error ? error.message : String(error)
      result.timedOut = isTimeoutError(error) && !signal?.aborted
    }

    return result
  } finally {
    result.stopSending = state.stopSending
    result.interactiveInvoked = state.interactiveInvoked
    if (signal?.aborted) result.aborted = true
    engine.global.close()
  }
}

// ── runLuaEditTrigger ───────────────────────────────────────────────────────

/** Context for {@link runLuaEditTrigger}: the runtime context (minus `char`, which
 * is the first positional arg) plus the active modules' resolved triggers. */
export interface ServerLuaEditTriggerContext extends Omit<ServerLuaRuntimeContext, 'char'> {
  /** Active modules' trigger scripts (`getModuleTriggers(getActiveModules(...))`),
   * concatenated after the character's own, mirroring the browser. */
  moduleTriggers?: triggerscript[]
}

/**
 * Server port of `runLuaEditTrigger` (`scriptings.ts:1415`). Remaps the edit-mode
 * casing, early-returns for `editprocess` (a browser no-op), then runs each
 * `triggerlua` effect on the character + active modules with `lowLevelAccess:
 * false` (browser parity, `:1452`), threading the transformed `data` forward.
 * Errors fall back to the original `content`.
 */
export async function runLuaEditTrigger<T extends string | OpenAIChat[]>(
  char: character | simpleCharacterArgument,
  mode: string,
  content: T,
  meta: object | undefined,
  ctx: ServerLuaEditTriggerContext,
): Promise<T> {
  switch (mode) {
    case 'editinput':
      mode = 'editInput'
      break
    case 'editoutput':
      mode = 'editOutput'
      break
    case 'editdisplay':
      mode = 'editDisplay'
      break
    case 'editprocess':
      return content
  }

  try {
    let data: T = content

    const ownTriggers =
      (char as { type?: string }).type === 'simple'
        ? []
        : ((char as character).triggerscript ?? [])
    const triggers = ownTriggers.concat(ctx.moduleTriggers ?? [])

    for (const trigger of triggers) {
      if (trigger?.effect?.[0]?.type === 'triggerlua') {
        const runResult = await runServerLua(
          {
            code: (trigger.effect[0] as { code: string }).code,
            mode,
            data,
            meta,
            lowLevelAccess: false,
          },
          { ...ctx, char },
        )
        data = (runResult.res as T) ?? data
      }
    }

    return data
  } catch {
    return content
  }
}
