import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const McpOAuthRefreshRequestSchema = Type.Object(
  {
    url: Type.String(),
  },
  { additionalProperties: false },
)

export const McpOAuthRefreshSuccessSchema = Type.Object(
  {
    accessToken: Type.String(),
  },
  { additionalProperties: false },
)

export type McpOAuthRefreshRequest = Static<typeof McpOAuthRefreshRequestSchema>
export type McpOAuthRefreshSuccess = Static<typeof McpOAuthRefreshSuccessSchema>

export function isMcpOAuthRefreshRequest(value: unknown): value is McpOAuthRefreshRequest {
  return Value.Check(McpOAuthRefreshRequestSchema, value)
}

export function isMcpOAuthRefreshSuccess(value: unknown): value is McpOAuthRefreshSuccess {
  return Value.Check(McpOAuthRefreshSuccessSchema, value)
}
