import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const BARDWIKI_PROTOCOL_VERSION = 1 as const

export const BardWikiDocumentKindSchema = Type.Union([
  Type.Literal('event'),
  Type.Literal('character'),
  Type.Literal('location'),
  Type.Literal('scene'),
  Type.Literal('faction'),
  Type.Literal('item'),
  Type.Literal('concept'),
  Type.Literal('other'),
])
export const BardWikiContextPolicySchema = Type.Union([
  Type.Literal('never'),
  Type.Literal('relevant'),
  Type.Literal('always'),
  Type.Literal('pinned'),
])
export const BardWikiReviewStateSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('needs_review'),
  Type.Literal('archived'),
])
export const BardWikiMemoryModeSchema = Type.Union([
  Type.Literal('hypa'),
  Type.Literal('bardwiki'),
  Type.Literal('hybrid'),
])
export const BardWikiConfirmationPolicySchema = Type.Union([Type.Literal('manual'), Type.Literal('automatic')])
export const BardWikiReceiptStateSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('processing'),
  Type.Literal('applied'),
  Type.Literal('failed'),
  Type.Literal('obsolete'),
  Type.Literal('stale'),
  Type.Literal('needs_review'),
])
export const BardWikiJobKindSchema = Type.Union([
  Type.Literal('apply_turn'),
  Type.Literal('reconcile_receipt'),
  Type.Literal('rebuild_chat'),
])
export const BardWikiJobStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
])

export type BardWikiDocumentKind = Static<typeof BardWikiDocumentKindSchema>
export type BardWikiContextPolicy = Static<typeof BardWikiContextPolicySchema>
export type BardWikiReviewState = Static<typeof BardWikiReviewStateSchema>
export type BardWikiMemoryMode = Static<typeof BardWikiMemoryModeSchema>
export type BardWikiConfirmationPolicy = Static<typeof BardWikiConfirmationPolicySchema>
export type BardWikiReceiptState = Static<typeof BardWikiReceiptStateSchema>
export type BardWikiJobKind = Static<typeof BardWikiJobKindSchema>
export type BardWikiJobStatus = Static<typeof BardWikiJobStatusSchema>

export const BardWikiGlobalSettingsSchema = Type.Object(
  {
    enabledByDefault: Type.Boolean(),
    memoryMode: BardWikiMemoryModeSchema,
    confirmationPolicy: BardWikiConfirmationPolicySchema,
    modelProfileId: Type.Union([Type.String(), Type.Null()]),
    promptPresetId: Type.Union([Type.String(), Type.Null()]),
    canonicalUpdates: Type.Boolean(),
    totalTokenBudget: Type.Integer({ minimum: 0, maximum: 32768 }),
    hybridHypaTokenBudget: Type.Integer({ minimum: 0, maximum: 32768 }),
    hybridBardWikiTokenBudget: Type.Integer({ minimum: 0, maximum: 32768 }),
    maxDocuments: Type.Integer({ minimum: 1, maximum: 32 }),
    maxLinkHops: Type.Integer({ minimum: 0, maximum: 2 }),
    recentMessageCount: Type.Integer({ minimum: 1, maximum: 50 }),
  },
  { additionalProperties: false },
)
export type BardWikiGlobalSettings = Static<typeof BardWikiGlobalSettingsSchema>

export const DEFAULT_BARDWIKI_GLOBAL_SETTINGS: Readonly<BardWikiGlobalSettings> = Object.freeze({
  enabledByDefault: false,
  memoryMode: 'hypa',
  confirmationPolicy: 'manual',
  modelProfileId: null,
  promptPresetId: null,
  canonicalUpdates: false,
  totalTokenBudget: 2048,
  hybridHypaTokenBudget: 1024,
  hybridBardWikiTokenBudget: 1024,
  maxDocuments: 8,
  maxLinkHops: 1,
  recentMessageCount: 12,
})

const NullableBooleanSchema = Type.Union([Type.Boolean(), Type.Null()])
const NullableIntegerSchema = (minimum: number, maximum: number) =>
  Type.Union([Type.Integer({ minimum, maximum }), Type.Null()])
const NullableStringSchema = Type.Union([Type.String(), Type.Null()])

export const BardWikiChatSettingsSchema = Type.Object(
  {
    chatId: Type.String(),
    enabledOverride: NullableBooleanSchema,
    memoryModeOverride: Type.Union([BardWikiMemoryModeSchema, Type.Null()]),
    confirmationPolicyOverride: Type.Union([BardWikiConfirmationPolicySchema, Type.Null()]),
    canonicalUpdatesOverride: NullableBooleanSchema,
    totalTokenBudgetOverride: NullableIntegerSchema(0, 32768),
    hybridHypaTokenBudgetOverride: NullableIntegerSchema(0, 32768),
    hybridBardWikiTokenBudgetOverride: NullableIntegerSchema(0, 32768),
    maxDocumentsOverride: NullableIntegerSchema(1, 32),
    maxLinkHopsOverride: NullableIntegerSchema(0, 2),
    recentMessageCountOverride: NullableIntegerSchema(1, 50),
    modelProfileIdOverride: NullableStringSchema,
    modelProfileIdIsSet: Type.Boolean(),
    promptPresetIdOverride: NullableStringSchema,
    promptPresetIdIsSet: Type.Boolean(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
)
export type BardWikiChatSettings = Static<typeof BardWikiChatSettingsSchema>

export const BardWikiDocumentIndexSchema = Type.Object(
  {
    id: Type.String(),
    chatId: Type.String(),
    kind: BardWikiDocumentKindSchema,
    title: Type.String(),
    logicalPath: Type.String(),
    normalizedPath: Type.String(),
    aliases: Type.Array(Type.String()),
    contextPolicy: BardWikiContextPolicySchema,
    reviewState: BardWikiReviewStateSchema,
    contentHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    version: Type.Integer({ minimum: 1 }),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
)
export type BardWikiDocumentIndex = Static<typeof BardWikiDocumentIndexSchema>

export const BardWikiDocumentSchema = Type.Object(
  {
    ...BardWikiDocumentIndexSchema.properties,
    markdown: Type.String(),
    deletedAt: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
)
export type BardWikiDocument = Static<typeof BardWikiDocumentSchema>

export const BardWikiDocumentVersionSchema = Type.Object(
  {
    documentId: Type.String(),
    version: Type.Integer({ minimum: 1 }),
    kind: BardWikiDocumentKindSchema,
    title: Type.String(),
    logicalPath: Type.String(),
    normalizedPath: Type.String(),
    aliases: Type.Array(Type.String()),
    contextPolicy: BardWikiContextPolicySchema,
    reviewState: BardWikiReviewStateSchema,
    markdown: Type.String(),
    contentHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    deleted: Type.Boolean(),
    actor: Type.Union([Type.Literal('user'), Type.Literal('model'), Type.Literal('system')]),
    reason: Type.Union([
      Type.Literal('create'),
      Type.Literal('update'),
      Type.Literal('delete'),
      Type.Literal('analysis'),
      Type.Literal('canonical'),
      Type.Literal('reconcile'),
      Type.Literal('rebuild'),
      Type.Literal('import'),
    ]),
    receiptId: NullableStringSchema,
    jobId: NullableStringSchema,
    commandRevision: Type.Integer({ minimum: 0 }),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
)
export type BardWikiDocumentVersion = Static<typeof BardWikiDocumentVersionSchema>

export const BardWikiLinkSchema = Type.Object(
  {
    sourceDocumentId: Type.String(),
    sourceVersion: Type.Integer({ minimum: 1 }),
    ordinal: Type.Integer({ minimum: 0 }),
    rawTarget: Type.String(),
    normalizedTarget: Type.String(),
    resolvedDocumentId: NullableStringSchema,
  },
  { additionalProperties: false },
)
export type BardWikiLink = Static<typeof BardWikiLinkSchema>

export const BardWikiReceiptSummarySchema = Type.Object(
  {
    id: Type.String(),
    chatId: Type.String(),
    userMessageId: Type.String(),
    userContentHash: Type.String(),
    assistantMessageId: Type.String(),
    assistantContentHash: Type.String(),
    confirmationMode: Type.Union([Type.Literal('explicit'), Type.Literal('automatic'), Type.Literal('rebuild')]),
    state: BardWikiReceiptStateSchema,
    eventDocumentId: NullableStringSchema,
    jobId: NullableStringSchema,
    errorCode: NullableStringSchema,
    errorSummary: NullableStringSchema,
    createdAt: Type.String(),
    updatedAt: Type.String(),
    appliedAt: NullableStringSchema,
  },
  { additionalProperties: false },
)
export type BardWikiReceiptSummary = Static<typeof BardWikiReceiptSummarySchema>

export const BardWikiJobSummarySchema = Type.Object(
  {
    id: Type.String(),
    instanceId: Type.String(),
    chatId: Type.String(),
    receiptId: NullableStringSchema,
    kind: BardWikiJobKindSchema,
    status: BardWikiJobStatusSchema,
    errorCode: NullableStringSchema,
    errorSummary: NullableStringSchema,
    attemptCount: Type.Integer({ minimum: 0 }),
    maxAttempts: Type.Integer({ minimum: 1 }),
    progressCurrent: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    progressTotal: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    nextRunAt: Type.String(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
)
export type BardWikiJobSummary = Static<typeof BardWikiJobSummarySchema>

export const BardWikiChatResourceSchema = Type.Object(
  {
    protocolVersion: Type.Literal(BARDWIKI_PROTOCOL_VERSION),
    revision: Type.Integer({ minimum: 0 }),
    chatId: Type.String(),
    globalSettings: BardWikiGlobalSettingsSchema,
    chatSettings: Type.Union([BardWikiChatSettingsSchema, Type.Null()]),
    effectiveSettings: BardWikiGlobalSettingsSchema,
    documents: Type.Array(BardWikiDocumentIndexSchema),
    receipts: Type.Array(BardWikiReceiptSummarySchema),
    jobs: Type.Array(BardWikiJobSummarySchema),
  },
  { additionalProperties: false },
)
export type BardWikiChatResource = Static<typeof BardWikiChatResourceSchema>

export const BardWikiDocumentResourceSchema = Type.Object(
  {
    protocolVersion: Type.Literal(BARDWIKI_PROTOCOL_VERSION),
    revision: Type.Integer({ minimum: 0 }),
    chatId: Type.String(),
    document: BardWikiDocumentSchema,
    links: Type.Array(BardWikiLinkSchema),
  },
  { additionalProperties: false },
)
export type BardWikiDocumentResource = Static<typeof BardWikiDocumentResourceSchema>

export const BardWikiVersionsResourceSchema = Type.Object(
  {
    protocolVersion: Type.Literal(BARDWIKI_PROTOCOL_VERSION),
    revision: Type.Integer({ minimum: 0 }),
    chatId: Type.String(),
    documentId: Type.String(),
    versions: Type.Array(BardWikiDocumentVersionSchema),
    nextBeforeVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type BardWikiVersionsResource = Static<typeof BardWikiVersionsResourceSchema>

export function isBardWikiGlobalSettings(value: unknown): value is BardWikiGlobalSettings {
  return Value.Check(BardWikiGlobalSettingsSchema, value)
}

export function isBardWikiChatResource(value: unknown): value is BardWikiChatResource {
  return Value.Check(BardWikiChatResourceSchema, value)
}

export function isBardWikiDocumentResource(value: unknown): value is BardWikiDocumentResource {
  return Value.Check(BardWikiDocumentResourceSchema, value)
}

export function isBardWikiVersionsResource(value: unknown): value is BardWikiVersionsResource {
  return Value.Check(BardWikiVersionsResourceSchema, value)
}
