import { describe, expect, it } from 'vitest'
import { encodePathSegment, signSigV4 } from '../src/generation/sigv4.js'

describe('encodePathSegment', () => {
  it('passes unreserved characters through (A-Za-z0-9-._~)', () => {
    expect(encodePathSegment('abc-XYZ_0.9~')).toBe('abc-XYZ_0.9~')
  })

  it('percent-encodes reserved characters with uppercase hex', () => {
    expect(encodePathSegment('a:b/c')).toBe('a%3Ab%2Fc')
    expect(encodePathSegment('hello world')).toBe('hello%20world')
  })

  it('encodes the colon in Bedrock-style model ids', () => {
    expect(encodePathSegment('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe(
      'anthropic.claude-3-5-sonnet-20241022-v2%3A0',
    )
  })
})

describe('signSigV4 — independent fixed vector', () => {
  // This POST vector was independently cross-checked against
  // @smithy/signature-v4 with the same request, credentials, and clock.
  it('produces a stable canonical request + signature for a fixed input', () => {
    const result = signSigV4(
      {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      },
      {
        method: 'POST',
        host: 'host.foo.com',
        path: '/',
        headers: {},
        body: '',
        region: 'us-east-1',
        service: 'host',
        date: new Date(Date.UTC(2011, 8, 9, 23, 36, 0)), // 20110909T233600Z
      },
    )
    expect(result.amzDate).toBe('20110909T233600Z')
    expect(result.credentialScope).toBe('20110909/us-east-1/host/aws4_request')
    // Canonical request shape: METHOD\n/\n\n<headers>\n\n<signed>\n<payload-hash>
    expect(result.canonicalRequest.split('\n')[0]).toBe('POST')
    expect(result.canonicalRequest.split('\n')[1]).toBe('/')
    // x-amz-content-sha256 = SHA256("") = e3b0c44...
    expect(result.canonicalRequest).toContain(
      'x-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(result.canonicalRequest).toContain('x-amz-date:20110909T233600Z')
    expect(result.canonicalRequest).toContain('host:host.foo.com')
    expect(result.signature).toBe('9d4bf94fa856bfe9ba940a3e9b0c38223199565419bb5d417d97be16490d2b2e')
    expect(result.headers['Authorization']).toContain(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20110909/us-east-1/host/aws4_request',
    )
    expect(result.headers['Authorization']).toContain(`Signature=${result.signature}`)
  })

  it('includes x-amz-security-token in signed headers when a session token is provided', () => {
    const result = signSigV4(
      {
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
        sessionToken: 'session-token-abc',
      },
      {
        method: 'POST',
        host: 'bedrock-runtime.us-east-1.amazonaws.com',
        path: '/model/test/invoke',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        region: 'us-east-1',
        service: 'bedrock',
        date: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)),
      },
    )
    expect(result.headers['x-amz-security-token']).toBe('session-token-abc')
    expect(result.canonicalRequest).toContain('x-amz-security-token:session-token-abc')
    expect(result.headers['Authorization']).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token',
    )
  })

  it('omits x-amz-security-token when sessionToken is absent', () => {
    const result = signSigV4(
      {
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
      },
      {
        method: 'POST',
        host: 'bedrock-runtime.us-east-1.amazonaws.com',
        path: '/model/test/invoke',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        region: 'us-east-1',
        service: 'bedrock',
        date: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)),
      },
    )
    expect(result.headers['x-amz-security-token']).toBeUndefined()
    expect(result.canonicalRequest).not.toContain('x-amz-security-token')
  })

  it('lowercases header keys in the canonical request and sorts them', () => {
    const result = signSigV4(
      { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
      {
        method: 'POST',
        host: 'h.example.com',
        path: '/p',
        headers: { 'X-Bbb': '2', 'Content-Type': 'application/json', 'x-Aaa': '1' },
        body: '{}',
        region: 'us-east-1',
        service: 'svc',
        date: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)),
      },
    )
    const headerSegment = result.canonicalRequest.split('\n').slice(3, -3).join('\n')
    // headerSegment contains the sorted lowercase canonical headers block
    // (followed by the empty separator line). Verify ordering of the
    // affected keys.
    const idxA = headerSegment.indexOf('x-aaa:1')
    const idxB = headerSegment.indexOf('x-bbb:2')
    const idxContent = headerSegment.indexOf('content-type:application/json')
    expect(idxContent).toBeGreaterThanOrEqual(0)
    expect(idxA).toBeGreaterThanOrEqual(0)
    expect(idxB).toBeGreaterThan(idxA)
    expect(idxA).toBeGreaterThan(idxContent)
  })

  it('compresses internal header whitespace in the canonical request', () => {
    const result = signSigV4(
      { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
      {
        method: 'POST',
        host: 'h.example.com',
        path: '/p',
        headers: { 'X-Meta': '  alpha   beta\t gamma  ' },
        body: '{}',
        region: 'us-east-1',
        service: 'svc',
        date: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)),
      },
    )

    expect(result.canonicalRequest).toContain('x-meta:alpha beta gamma\n')
    expect(result.canonicalRequest).not.toContain('alpha   beta')
  })

  it('produces deterministic signatures across two calls with the same input', () => {
    const args = {
      credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
      input: {
        method: 'POST',
        host: 'h',
        path: '/p',
        headers: { 'content-type': 'application/json' },
        body: '{"x":1}',
        region: 'us-east-1',
        service: 'bedrock',
        date: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)),
      },
    }
    const a = signSigV4(args.credentials, args.input)
    const b = signSigV4(args.credentials, args.input)
    expect(a.signature).toBe(b.signature)
  })
})
