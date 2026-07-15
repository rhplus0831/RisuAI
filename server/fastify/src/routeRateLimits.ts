import type { RateLimitOptions } from '@fastify/rate-limit'

const MINUTE = '1 minute'

export const authSetupRateLimit: RateLimitOptions = {
  max: 5,
  timeWindow: MINUTE,
}

export const authLoginRateLimit: RateLimitOptions = {
  max: 10,
  timeWindow: MINUTE,
}

export const authCryptoRateLimit: RateLimitOptions = {
  max: 60,
  timeWindow: MINUTE,
}

export const proxyFetchRateLimit: RateLimitOptions = {
  max: 120,
  timeWindow: MINUTE,
}

export const proxyStreamCreateRateLimit: RateLimitOptions = {
  max: 30,
  timeWindow: MINUTE,
}

export const importRateLimit: RateLimitOptions = {
  max: 10,
  timeWindow: MINUTE,
}

export const assetUploadRateLimit: RateLimitOptions = {
  max: 120,
  timeWindow: MINUTE,
}

export const assetBulkUploadRateLimit: RateLimitOptions = {
  max: 30,
  timeWindow: MINUTE,
}

export const assetExistsRateLimit: RateLimitOptions = {
  max: 120,
  timeWindow: MINUTE,
}

export const generationSubmitRateLimit: RateLimitOptions = {
  max: 60,
  timeWindow: MINUTE,
}
