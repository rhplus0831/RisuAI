export interface BranchCommentReference {
  sourceChatId: string
  sourceChatName: string
  sourceMessageId: string
}

const BRANCH_COMMENT_PREFIX = '{{specialcomment::branchedfrom::'
const BRANCH_COMMENT_SUFFIX = '::}}'
const STRUCTURED_FORMAT_PREFIX = 'json-v1::'

export function createBranchComment(reference: BranchCommentReference): string {
  const payload = encodeURIComponent(JSON.stringify(reference))
  return `${BRANCH_COMMENT_PREFIX}${STRUCTURED_FORMAT_PREFIX}${payload}${BRANCH_COMMENT_SUFFIX}`
}

export function parseBranchComment(value: string): BranchCommentReference | null {
  if (!value.startsWith(BRANCH_COMMENT_PREFIX) || !value.endsWith(BRANCH_COMMENT_SUFFIX)) {
    return null
  }

  const body = value.slice(BRANCH_COMMENT_PREFIX.length, -BRANCH_COMMENT_SUFFIX.length)
  if (body.startsWith(STRUCTURED_FORMAT_PREFIX)) {
    const structured = parseStructuredReference(body.slice(STRUCTURED_FORMAT_PREFIX.length))
    if (structured) return structured
  }

  return parseLegacyReference(body)
}

function parseStructuredReference(payload: string): BranchCommentReference | null {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(payload))
    if (!isRecord(parsed)) return null

    const { sourceChatId, sourceChatName, sourceMessageId } = parsed
    if (typeof sourceChatId !== 'string' || typeof sourceChatName !== 'string' || typeof sourceMessageId !== 'string') {
      return null
    }

    return { sourceChatId, sourceChatName, sourceMessageId }
  } catch {
    return null
  }
}

function parseLegacyReference(body: string): BranchCommentReference | null {
  const firstSeparator = body.indexOf('::')
  const lastSeparator = body.lastIndexOf('::')
  if (firstSeparator < 0 || lastSeparator <= firstSeparator) return null

  return {
    sourceChatId: body.slice(0, firstSeparator),
    sourceChatName: body.slice(firstSeparator + 2, lastSeparator),
    sourceMessageId: body.slice(lastSeparator + 2),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
