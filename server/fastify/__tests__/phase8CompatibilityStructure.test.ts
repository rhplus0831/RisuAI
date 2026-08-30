import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  BARDWIKI_JOB_KINDS,
  BARDWIKI_JOB_STATUSES,
  BARDWIKI_MEMORY_MODES,
  type BardWikiJobSummary,
  type BardWikiMemoryMode,
} from '../src/bardWikiRepository.js'
import type { BardWikiJobKind } from '../src/bardWikiJobs.js'
import {
  MEMORY_JOB_KINDS,
  MEMORY_JOB_STATUSES,
  MEMORY_JOB_TERMINAL_STATUSES,
  type MemoryJobKind,
  type MemoryJobStatus,
} from '../src/memoryRepository.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

type Owner = {
  production: string
  anchors: readonly string[]
  assurance: string
  assuranceAnchors?: readonly string[]
}

type EmbeddingModelOwner = Owner & {
  execution: 'server' | 'browser-local'
  provider: 'custom' | 'openai-compatible' | 'voyage-contextual' | 'transformers'
}

const HYPA_PLANNER_OWNERS: Record<string, Owner> = {
  standard: {
    production: 'server/fastify/src/memoryPlanner.ts',
    anchors: ['planStandardHypaV3Memory', "mode: 'standard'"],
    assurance: 'server/fastify/__tests__/memoryPlanner.test.ts',
  },
}

/** Persisted selections for removed engines remain classified and produce a migration notice. */
const RETIRED_MEMORY_ALGORITHM_OWNERS: Record<string, Owner> = Object.fromEntries(
  ['SupaMemory', 'Legacy HypaMemory', 'Hypa V2', 'Hanurai', 'Experimental Hypa V3'].map((algorithm) => [
    algorithm,
    {
      production: 'src/ts/process/legacyMemoryMigrationNotice.ts',
      anchors: [`'${algorithm}'`, 'detectActiveRetiredMemoryAlgorithms'],
      assurance: 'src/ts/process/legacyMemoryMigrationNotice.test.ts',
      assuranceAnchors: ['names each active retired memory selection without flagging maintained Hypa V3'],
    },
  ]),
)

/** Every retained Hypa embedding alias is either server-routable or explicitly browser-local. */
const HYPA_EMBEDDING_MODEL_OWNERS: Record<string, EmbeddingModelOwner> = {
  custom: modelOwner('server', 'custom', "model === 'custom'"),
  ada: modelOwner('server', 'openai-compatible', "ada: 'text-embedding-ada-002'"),
  openai3small: modelOwner('server', 'openai-compatible', "openai3small: 'text-embedding-3-small'"),
  openai3large: modelOwner('server', 'openai-compatible', "openai3large: 'text-embedding-3-large'"),
  MiniLM: localModelOwner("'MiniLM'"),
  MiniLMGPU: localModelOwner("'MiniLMGPU'"),
  nomic: localModelOwner("'nomic'"),
  nomicGPU: localModelOwner("'nomicGPU'"),
  bgeSmallEn: localModelOwner("'bgeSmallEn'"),
  bgeSmallEnGPU: localModelOwner("'bgeSmallEnGPU'"),
  bgem3: localModelOwner("'bgem3'"),
  bgem3GPU: localModelOwner("'bgem3GPU'"),
  multiMiniLM: localModelOwner("'multiMiniLM'"),
  multiMiniLMGPU: localModelOwner("'multiMiniLMGPU'"),
  bgeM3Ko: localModelOwner("'bgeM3Ko'"),
  bgeM3KoGPU: localModelOwner("'bgeM3KoGPU'"),
  voyageContext3: modelOwner('server', 'voyage-contextual', "voyageContext3: 'voyage-context-3'"),
  voyageContext4: modelOwner('server', 'voyage-contextual', "voyageContext4: 'voyage-context-4'"),
}

const HYPA_SELECTION_CATEGORY_OWNERS: Record<string, Owner> = Object.fromEntries(
  ['important', 'recent', 'similar', 'random'].map((category) => [
    category,
    {
      production: 'server/fastify/src/memoryBudgetAllocator.ts',
      anchors: [`'${category}'`, 'allocateMemorySummaries'],
      assurance: 'server/fastify/__tests__/memoryBudgetAllocator.test.ts',
    },
  ]),
)

const BARDWIKI_MODE_OWNERS: Record<BardWikiMemoryMode, Owner> = {
  hypa: {
    production: 'server/fastify/src/bardWikiSettings.ts',
    anchors: ["settings.memoryMode === 'hypa'", 'hypaTokenBudget: null'],
    assurance: 'server/fastify/__tests__/bardWikiPrompt.test.ts',
  },
  bardwiki: {
    production: 'server/fastify/src/bardWikiSettings.ts',
    anchors: ["settings.memoryMode === 'bardwiki'", 'bardWikiTokenBudget: total'],
    assurance: 'server/fastify/__tests__/bardWikiPrompt.test.ts',
  },
  hybrid: {
    production: 'server/fastify/src/bardWikiSettings.ts',
    anchors: ['requestedBardWiki', 'total - hypaTokenBudget'],
    assurance: 'server/fastify/__tests__/bardWikiPrompt.test.ts',
  },
}

const BARDWIKI_SCORE_REASON_OWNERS: Record<string, Owner> = Object.fromEntries(
  [
    'pinned',
    'always',
    'exact_title',
    'exact_alias',
    'title_token',
    'heading_token',
    'body_token',
    'link_1',
    'link_2',
  ].map((reason) => [
    reason,
    {
      production: 'server/fastify/src/prompt/bardWikiSelection.ts',
      anchors: [`'${reason}'`, 'selectBardWikiPromptRows'],
      assurance: 'server/fastify/__tests__/bardWikiSelection.test.ts',
    },
  ]),
)

const MEMORY_JOB_KIND_OWNERS: Record<MemoryJobKind, Owner & { disposition: 'active' | 'reserved-noop' }> = {
  chunk: {
    disposition: 'reserved-noop',
    production: 'server/fastify/src/memoryWorker.ts',
    anchors: ['chunk: noopMemoryJobHandler', 'Stub dispatch only; memory mutation is supplied by concrete handlers.'],
    assurance: 'server/fastify/__tests__/memoryWorker.test.ts',
  },
  embed: {
    disposition: 'active',
    production: 'server/fastify/src/memoryEmbedJobHandler.ts',
    anchors: ['createEmbedMemoryJobHandler', 'createEmbedMemoryJobBatchHandler'],
    assurance: 'server/fastify/__tests__/memoryEmbedJobHandler.test.ts',
  },
  summarize: {
    disposition: 'active',
    production: 'server/fastify/src/memorySummarizeJobHandler.ts',
    anchors: ['createSummarizeMemoryJobHandler', 'createSummarizeMemoryJobBatchHandler'],
    assurance: 'server/fastify/__tests__/memorySummarizeJobHandler.test.ts',
  },
}

const BARDWIKI_JOB_KIND_OWNERS: Record<BardWikiJobKind, Owner> = {
  apply_turn: {
    production: 'server/fastify/src/bardWikiApplyTurnHandler.ts',
    anchors: ['createBardWikiApplyTurnHandler', "job.kind !== 'apply_turn'"],
    assurance: 'server/fastify/__tests__/bardWikiApplyTurnHandler.test.ts',
  },
  reconcile_receipt: {
    production: 'server/fastify/src/bardWikiReconcileHandler.ts',
    anchors: ['createBardWikiReconcileReceiptHandler', "job.kind !== 'reconcile_receipt'"],
    assurance: 'server/fastify/__tests__/bardWikiLifecycle.test.ts',
  },
  rebuild_chat: {
    production: 'server/fastify/src/bardWikiRebuildHandler.ts',
    anchors: ['createBardWikiRebuildHandler', "job.kind !== 'rebuild_chat'"],
    assurance: 'server/fastify/__tests__/bardWikiRebuildHandler.test.ts',
  },
}

const MEMORY_JOB_STATE_OWNERS: Record<MemoryJobStatus, Owner> = {
  pending: memoryStateOwner('enqueueMemoryJob', 'enqueues and claims pending jobs'),
  running: memoryStateOwner('claimNextMemoryJob', 'enqueues and claims pending jobs'),
  completed: memoryStateOwner('completeMemoryJob', 'completes, fails, and cancels only legal queue transitions'),
  failed: memoryStateOwner('retryOrFailMemoryJob', 'retries running jobs with exponential backoff'),
  cancelled: memoryStateOwner('cancelMemoryJob', 'completes, fails, and cancels only legal queue transitions'),
}

const BARDWIKI_JOB_STATE_OWNERS: Record<BardWikiJobSummary['status'], Owner> = {
  pending: bardWikiStateOwner('enqueueBardWikiJob'),
  running: bardWikiStateOwner('claimNextBardWikiJob'),
  completed: bardWikiStateOwner('completeBardWikiJob'),
  failed: bardWikiStateOwner('retryOrFailBardWikiJob'),
  cancelled: bardWikiStateOwner('cancelBardWikiJob'),
}

const MEMORY_JOB_LIFECYCLE_OWNERS: Record<string, Owner> = {
  retry_and_exhaustion: memoryLifecycleOwner('retryOrFailMemoryJob', 'memoryRepository.test.ts'),
  cancellation: memoryLifecycleOwner('abortRunningJob', 'memoryWorker.test.ts'),
  restart_recovery: memoryLifecycleOwner('recoverRunningMemoryJobs', 'memoryWorker.test.ts'),
  embed_duplicate_delivery: {
    production: 'server/fastify/src/memoryEmbedJobHandler.ts',
    anchors: ['const existing = listMemoryEmbeddings', "result.kind === 'existing'"],
    assurance: 'server/fastify/__tests__/memoryEmbedJobHandler.test.ts',
  },
  summary_duplicate_delivery: {
    production: 'server/fastify/src/memorySummarizeJobHandler.ts',
    anchors: ['const existing = listMemorySummaries', "result.kind === 'existing'"],
    assurance: 'server/fastify/__tests__/memorySummarizeJobHandler.test.ts',
  },
  stale_target_invalidation: {
    production: 'server/fastify/src/memoryInvalidation.ts',
    anchors: ['invalidateUnsummarizedMemoryForChat', 'DELETE FROM memory_jobs'],
    assurance: 'server/fastify/__tests__/commands.test.ts',
  },
  terminal_diagnostics: {
    production: 'server/fastify/src/memoryEvents.ts',
    anchors: ['sanitizeMemoryJobError', "job.status === 'completed'"],
    assurance: 'server/fastify/__tests__/memoryJobsRoutes.test.ts',
  },
}

const BARDWIKI_JOB_LIFECYCLE_OWNERS: Record<string, Owner> = {
  retry_and_exhaustion: bardWikiLifecycleOwner('retryOrFailBardWikiJob', 'bardWikiJobs.test.ts'),
  explicit_retry: bardWikiLifecycleOwner('retryFailedBardWikiJob', 'bardWikiJobs.test.ts'),
  cancellation: bardWikiLifecycleOwner('cancelBardWikiJob', 'bardWikiApplyTurnHandler.test.ts'),
  restart_recovery: bardWikiLifecycleOwner('recoverRunningBardWikiJobs', 'bardWikiRebuildHandler.test.ts'),
  duplicate_delivery: {
    production: 'server/fastify/src/bardWikiReceipts.ts',
    anchors: ['findExactReceipt', 'created: false'],
    assurance: 'server/fastify/__tests__/bardWikiConfirmation.test.ts',
  },
  stale_source_reconciliation: {
    production: 'server/fastify/src/bardWikiInvalidation.ts',
    anchors: ['invalidateBardWikiReceiptsForTranscriptMutation', "kind: 'reconcile_receipt'"],
    assurance: 'server/fastify/__tests__/bardWikiLifecycle.test.ts',
  },
  terminal_diagnostics: {
    production: 'server/fastify/src/memoryEvents.ts',
    anchors: ['buildBardWikiJobEvent', 'errorSummary'],
    assurance: 'server/fastify/__tests__/bardWikiWorker.test.ts',
  },
}

describe('Phase 8 compatibility structure', () => {
  it('classifies every retained planner, embedding model, selection category, and BardWiki mode', () => {
    expect(Object.keys(HYPA_PLANNER_OWNERS).sort()).toEqual(
      typeAliasStringUnion(readRepoFile('server/fastify/src/memoryPlanner.ts'), 'HypaV3PlannerMode').sort(),
    )
    expect(Object.keys(HYPA_EMBEDDING_MODEL_OWNERS).sort()).toEqual(
      typeAliasStringUnion(readRepoFile('server/fastify/src/memoryEmbeddingModel.ts'), 'MemoryEmbeddingModel').sort(),
    )
    expect(
      typeAliasStringUnion(readRepoFile('server/fastify/src/memoryEmbeddingModel.ts'), 'MemoryEmbeddingModel'),
    ).toEqual(typeAliasStringUnion(readRepoFile('src/ts/process/memory/hypamemory.ts'), 'HypaModel'))
    expect(Object.keys(RETIRED_MEMORY_ALGORITHM_OWNERS).sort()).toEqual(
      typeAliasStringUnion(
        readRepoFile('src/ts/process/legacyMemoryMigrationNotice.ts'),
        'RetiredMemoryAlgorithm',
      ).sort(),
    )
    expect(Object.keys(HYPA_SELECTION_CATEGORY_OWNERS).sort()).toEqual(
      typeAliasStringUnion(
        readRepoFile('server/fastify/src/memoryBudgetAllocator.ts'),
        'MemoryBudgetAllocationCategory',
      ).sort(),
    )
    expect(Object.keys(BARDWIKI_MODE_OWNERS).sort()).toEqual([...BARDWIKI_MEMORY_MODES].sort())
    expect(Object.keys(BARDWIKI_SCORE_REASON_OWNERS).sort()).toEqual(
      typeAliasStringUnion(
        readRepoFile('server/fastify/src/prompt/bardWikiSelection.ts'),
        'BardWikiScoreReason',
      ).sort(),
    )

    verifyOwners(HYPA_PLANNER_OWNERS)
    verifyOwners(RETIRED_MEMORY_ALGORITHM_OWNERS)
    verifyOwners(HYPA_EMBEDDING_MODEL_OWNERS)
    verifyOwners(HYPA_SELECTION_CATEGORY_OWNERS)
    verifyOwners(BARDWIKI_MODE_OWNERS)
    verifyOwners(BARDWIKI_SCORE_REASON_OWNERS)
    expect(
      Object.entries(HYPA_EMBEDDING_MODEL_OWNERS)
        .filter(([, owner]) => owner.execution === 'browser-local')
        .map(([model]) => model)
        .sort(),
    ).toEqual([
      'MiniLM',
      'MiniLMGPU',
      'bgeM3Ko',
      'bgeM3KoGPU',
      'bgeSmallEn',
      'bgeSmallEnGPU',
      'bgem3',
      'bgem3GPU',
      'multiMiniLM',
      'multiMiniLMGPU',
      'nomic',
      'nomicGPU',
    ])
  })

  it('keeps every job kind, state, and lifecycle transition tied to production and assurance owners', () => {
    expect(Object.keys(MEMORY_JOB_KIND_OWNERS).sort()).toEqual([...MEMORY_JOB_KINDS].sort())
    expect(Object.keys(MEMORY_JOB_STATE_OWNERS).sort()).toEqual([...MEMORY_JOB_STATUSES].sort())
    expect([...MEMORY_JOB_TERMINAL_STATUSES].sort()).toEqual(['cancelled', 'completed', 'failed'])
    expect(Object.keys(BARDWIKI_JOB_KIND_OWNERS).sort()).toEqual([...BARDWIKI_JOB_KINDS].sort())
    expect(Object.keys(BARDWIKI_JOB_STATE_OWNERS).sort()).toEqual([...BARDWIKI_JOB_STATUSES].sort())
    expect(Object.entries(MEMORY_JOB_KIND_OWNERS).filter(([, owner]) => owner.disposition === 'reserved-noop')).toEqual(
      [['chunk', MEMORY_JOB_KIND_OWNERS.chunk]],
    )

    verifyOwners(MEMORY_JOB_KIND_OWNERS)
    verifyOwners(MEMORY_JOB_STATE_OWNERS)
    verifyOwners(BARDWIKI_JOB_KIND_OWNERS)
    verifyOwners(BARDWIKI_JOB_STATE_OWNERS)
    verifyOwners(MEMORY_JOB_LIFECYCLE_OWNERS)
    verifyOwners(BARDWIKI_JOB_LIFECYCLE_OWNERS)
  })
})

function modelOwner(
  execution: 'server',
  provider: EmbeddingModelOwner['provider'],
  anchor: string,
): EmbeddingModelOwner {
  return {
    execution,
    provider,
    production: 'server/fastify/src/memoryEmbeddingModel.ts',
    anchors: [anchor, 'resolveMemoryEmbeddingModel'],
    assurance: 'server/fastify/__tests__/memoryEmbeddingModel.test.ts',
  }
}

function localModelOwner(anchor: string): EmbeddingModelOwner {
  return {
    execution: 'browser-local',
    provider: 'transformers',
    production: 'server/fastify/src/memoryEmbeddingModel.ts',
    anchors: [anchor, 'server-side memory embeddings do not support browser-local model'],
    assurance: 'server/fastify/__tests__/memoryEmbeddingModel.test.ts',
  }
}

function memoryStateOwner(anchor: string, assuranceAnchor: string): Owner {
  return {
    production: 'server/fastify/src/memoryRepository.ts',
    anchors: [anchor],
    assurance: 'server/fastify/__tests__/memoryRepository.test.ts',
    assuranceAnchors: [assuranceAnchor],
  }
}

function bardWikiStateOwner(anchor: string): Owner {
  return {
    production: 'server/fastify/src/bardWikiJobs.ts',
    anchors: [anchor],
    assurance: 'server/fastify/__tests__/bardWikiJobs.test.ts',
  }
}

function memoryLifecycleOwner(anchor: string, assuranceFile: string): Owner {
  return {
    production:
      anchor === 'abortRunningJob' ? 'server/fastify/src/memoryWorker.ts' : 'server/fastify/src/memoryRepository.ts',
    anchors: [anchor],
    assurance: `server/fastify/__tests__/${assuranceFile}`,
  }
}

function bardWikiLifecycleOwner(anchor: string, assuranceFile: string): Owner {
  return {
    production: 'server/fastify/src/bardWikiJobs.ts',
    anchors: [anchor],
    assurance: `server/fastify/__tests__/${assuranceFile}`,
  }
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function verifyOwners(owners: Readonly<Record<string, Owner>>): void {
  for (const [name, owner] of Object.entries(owners)) {
    const production = readRepoFile(owner.production)
    for (const anchor of owner.anchors) expect(production, `${name} production anchor`).toContain(anchor)
    const assurance = readRepoFile(owner.assurance)
    expect(assurance, `${name} behavioral assurance`).toContain('describe(')
    for (const anchor of owner.assuranceAnchors ?? []) {
      expect(assurance, `${name} assurance anchor`).toContain(anchor)
    }
  }
}

function typeAliasStringUnion(source: string, typeName: string): string[] {
  const parsed = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = parsed.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName,
  )
  expect(declaration, typeName).toBeDefined()
  const members = ts.isUnionTypeNode(declaration!.type) ? declaration!.type.types : [declaration!.type]
  return members.map((member) => {
    expect(ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal), member.getText()).toBe(true)
    return (member as ts.LiteralTypeNode & { literal: ts.StringLiteral }).literal.text
  })
}
