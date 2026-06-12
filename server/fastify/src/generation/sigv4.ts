import { createHash, createHmac } from 'node:crypto'

/**
 * Pure-JS AWS SigV4 signer. Targets the subset used by Bedrock Runtime:
 * POST with a JSON body, no query string, optional session token. Mirrors
 * the canonical request / string-to-sign / signing-key derivation
 * documented at
 * https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
 *
 * AWS publishes test vectors for the "GET vanilla" example
 * (https://docs.aws.amazon.com/general/latest/gr/sigv4-signed-request-examples.html);
 * see `sigv4.test.ts` for a pinned signature against the published values.
 */

export interface SigV4Credentials {
  accessKeyId: string
  secretAccessKey: string
  /**
   * Optional STS session token. When present, included as
   * `x-amz-security-token` in the signed headers.
   */
  sessionToken?: string
}

export interface SigV4SignInput {
  method: string
  host: string
  /**
   * Path component of the URL. Must already be URI-encoded the same way
   * as the request line — pass through `encodePathSegment` for any
   * segment that may contain non-unreserved characters (e.g. ':' in
   * Bedrock model ids like `v2:0`).
   */
  path: string
  /** Final headers map (case-insensitive keys; will be lowercased internally). */
  headers: Record<string, string>
  /** Raw request body bytes. */
  body: string
  region: string
  service: string
  /** Override clock for deterministic tests. Defaults to `new Date()`. */
  date?: Date
}

export interface SigV4SignResult {
  /** Signed-and-augmented headers to send. */
  headers: Record<string, string>
  /** Exposed for tests + diagnostics. */
  amzDate: string
  /** Exposed for tests + diagnostics. */
  credentialScope: string
  /** Exposed for tests + diagnostics. */
  canonicalRequest: string
  /** Exposed for tests + diagnostics. */
  stringToSign: string
  /** Hex signature (the value following `Signature=` in the Authorization header). */
  signature: string
}

/**
 * Encode a single path segment per RFC 3986: unreserved characters
 * (`A-Za-z0-9-._~`) pass through; everything else becomes `%XX`. `/`
 * separators between segments are NOT encoded; callers concatenate
 * encoded segments with literal `/`.
 */
export function encodePathSegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9\-._~]/g, (c) => {
    const hex = c.charCodeAt(0).toString(16).toUpperCase()
    return '%' + (hex.length < 2 ? '0' + hex : hex)
  })
}

function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function formatAmzDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ — no separators.
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

function deriveSigningKey(secret: string, date: string, region: string, service: string): Buffer {
  const kSecret = `AWS4${secret}`
  const kDate = hmac(kSecret, date)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

/**
 * Build the canonical request, derive the signing key, and produce the
 * Authorization header. Returns the headers map with `x-amz-date`,
 * `x-amz-content-sha256`, optional `x-amz-security-token`, and
 * `Authorization` added on top of the caller-provided base headers.
 */
export function signSigV4(credentials: SigV4Credentials, input: SigV4SignInput): SigV4SignResult {
  const date = input.date ?? new Date()
  const amzDate = formatAmzDate(date)
  const dateStamp = amzDate.slice(0, 8) // YYYYMMDD
  const payloadHash = sha256Hex(input.body)

  // Augment headers with the SigV4-required bits the caller may not have
  // provided. We work with lowercase keys internally because the canonical
  // request demands them.
  const sourceHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.headers)) {
    sourceHeaders[k.toLowerCase()] = v
  }
  sourceHeaders['host'] = input.host
  sourceHeaders['x-amz-date'] = amzDate
  sourceHeaders['x-amz-content-sha256'] = payloadHash
  if (credentials.sessionToken !== undefined && credentials.sessionToken.length > 0) {
    sourceHeaders['x-amz-security-token'] = credentials.sessionToken
  }

  // Canonical headers: sorted by lowercase key, each line `key:trimmed-value\n`.
  const sortedKeys = Object.keys(sourceHeaders).sort()
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${sourceHeaders[k].trim()}`).join('\n') + '\n'
  const signedHeaders = sortedKeys.join(';')

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    '', // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = deriveSigningKey(credentials.secretAccessKey, dateStamp, input.region, input.service)
  const signature = hmac(signingKey, stringToSign).toString('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}` +
    `, SignedHeaders=${signedHeaders}` +
    `, Signature=${signature}`

  // Build the outgoing header map. Preserve the caller's casing on the
  // original entries (some servers care) but add the SigV4 ones in
  // canonical-lowercase. Authorization gets capital A, matching the
  // AWS docs' wire example.
  const out: Record<string, string> = { ...input.headers }
  out['x-amz-date'] = amzDate
  out['x-amz-content-sha256'] = payloadHash
  if (credentials.sessionToken !== undefined && credentials.sessionToken.length > 0) {
    out['x-amz-security-token'] = credentials.sessionToken
  }
  out['Authorization'] = authorization

  return {
    headers: out,
    amzDate,
    credentialScope,
    canonicalRequest,
    stringToSign,
    signature,
  }
}
