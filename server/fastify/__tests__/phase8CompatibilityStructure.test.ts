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
}

type EmbeddingModelOwner = Owner & {
  execution: 'server' | 'browser-local'
  provider: 'custom' | 'openai-compatible' | 'voyage-contextual' | 'transformers'
}

const HYPA_PLANNER_OWNERS: Record<string, Owner> = {
  standard: {
    production: 'server/fastify/src/memoryPlanner.ts',
    anchors: ['planStandardHypaV3Memory', "mode: 'standard'"],
  },
}

/** Persisted selections for removed engines remain classified and produce a migration notice. */
const RETIRED_MEMORY_ALGORITHM_OWNERS: Record<string, Owner> = Object.fromEntries(
  ['SupaMemory', 'Legacy HypaMemory', 'Hypa V2', 'Hanurai', 'Experimental Hypa V3'].map((algorithm) => [
    algorithm,
    {
      production: 'src/ts/process/legacyMemoryMigrationNotice.ts',
      anchors: [`'${algorithm}'`, 'detectActiveRetiredMemoryAlgorithms'],
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
    },
  ]),
)

const BARDWIKI_MODE_OWNERS: Record<BardWikiMemoryMode, Owner> = {
  hypa: {
    production: 'server/fastify/src/bardWikiSettings.ts',
    anchors: ["settings.memoryMode === 'hypa'", 'hypaTokenBudget: null'],
  },
  bardwiki: {
    production: 'server/fastify/src/bardWikiSettings.ts',
    anchors: ["settings.memoryMode === 'bardwiki'", 'bardWikiTokenBudget: total'],
  },
  hybrid: {
    production: 'server/fastify/src/bardWikiSettings.ts',
    anchors: ['requestedBardWiki', 'total - hypaTokenBudget'],
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
    },
  ]),
)

const MEMORY_JOB_KIND_OWNERS: Record<MemoryJobKind, Owner & { disposition: 'active' | 'reserved-noop' }> = {
  chunk: {
    disposition: 'reserved-noop',
    production: 'server/fastify/src/memoryWorker.ts',
    anchors: ['chunk: noopMemoryJobHandler', 'Stub dispatch only; memory mutation is supplied by concrete handlers.'],
  },
  embed: {
    disposition: 'active',
    production: 'server/fastify/src/memoryEmbedJobHandler.ts',
    anchors: ['createEmbedMemoryJobHandler', 'createEmbedMemoryJobBatchHandler'],
  },
  summarize: {
    disposition: 'active',
    production: 'server/fastify/src/memorySummarizeJobHandler.ts',
    anchors: ['createSummarizeMemoryJobHandler', 'createSummarizeMemoryJobBatchHandler'],
  },
}

const BARDWIKI_JOB_KIND_OWNERS: Record<BardWikiJobKind, Owner> = {
  apply_turn: {
    production: 'server/fastify/src/bardWikiApplyTurnHandler.ts',
    anchors: ['createBardWikiApplyTurnHandler', "job.kind !== 'apply_turn'"],
  },
  reconcile_receipt: {
    production: 'server/fastify/src/bardWikiReconcileHandler.ts',
    anchors: ['createBardWikiReconcileReceiptHandler', "job.kind !== 'reconcile_receipt'"],
  },
  rebuild_chat: {
    production: 'server/fastify/src/bardWikiRebuildHandler.ts',
    anchors: ['createBardWikiRebuildHandler', "job.kind !== 'rebuild_chat'"],
  },
}

const MEMORY_JOB_STATE_OWNERS: Record<MemoryJobStatus, Owner> = {
  pending: memoryStateOwner('enqueueMemoryJob'),
  running: memoryStateOwner('claimNextMemoryJob'),
  completed: memoryStateOwner('completeMemoryJob'),
  failed: memoryStateOwner('retryOrFailMemoryJob'),
  cancelled: memoryStateOwner('cancelMemoryJob'),
}

const BARDWIKI_JOB_STATE_OWNERS: Record<BardWikiJobSummary['status'], Owner> = {
  pending: bardWikiStateOwner('enqueueBardWikiJob'),
  running: bardWikiStateOwner('claimNextBardWikiJob'),
  completed: bardWikiStateOwner('completeBardWikiJob'),
  failed: bardWikiStateOwner('retryOrFailBardWikiJob'),
  cancelled: bardWikiStateOwner('cancelBardWikiJob'),
}

const MEMORY_JOB_LIFECYCLE_OWNERS: Record<string, Owner> = {
  retry_and_exhaustion: memoryLifecycleOwner('retryOrFailMemoryJob'),
  cancellation: memoryLifecycleOwner('abortRunningJob'),
  restart_recovery: memoryLifecycleOwner('recoverRunningMemoryJobs'),
  embed_duplicate_delivery: {
    production: 'server/fastify/src/memoryEmbedJobHandler.ts',
    anchors: ['const existing = listMemoryEmbeddings', "result.kind === 'existing'"],
  },
  summary_duplicate_delivery: {
    production: 'server/fastify/src/memorySummarizeJobHandler.ts',
    anchors: ['const existing = listMemorySummaries', "result.kind === 'existing'"],
  },
  stale_target_invalidation: {
    production: 'server/fastify/src/memoryInvalidation.ts',
    anchors: ['invalidateUnsummarizedMemoryForChat', 'DELETE FROM memory_jobs'],
  },
  terminal_diagnostics: {
    production: 'server/fastify/src/memoryEvents.ts',
    anchors: ['sanitizeMemoryJobError', "job.status === 'completed'"],
  },
}

const BARDWIKI_JOB_LIFECYCLE_OWNERS: Record<string, Owner> = {
  retry_and_exhaustion: bardWikiLifecycleOwner('retryOrFailBardWikiJob'),
  explicit_retry: bardWikiLifecycleOwner('retryFailedBardWikiJob'),
  cancellation: bardWikiLifecycleOwner('cancelBardWikiJob'),
  restart_recovery: bardWikiLifecycleOwner('recoverRunningBardWikiJobs'),
  duplicate_delivery: {
    production: 'server/fastify/src/bardWikiReceipts.ts',
    anchors: ['findExactReceipt', 'created: false'],
  },
  stale_source_reconciliation: {
    production: 'server/fastify/src/bardWikiInvalidation.ts',
    anchors: ['invalidateBardWikiReceiptsForTranscriptMutation', "kind: 'reconcile_receipt'"],
  },
  terminal_diagnostics: {
    production: 'server/fastify/src/memoryEvents.ts',
    anchors: ['buildBardWikiJobEvent', 'errorSummary'],
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

  it('keeps every job kind, state, and lifecycle transition tied to production owners', () => {
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
  }
}

function localModelOwner(anchor: string): EmbeddingModelOwner {
  return {
    execution: 'browser-local',
    provider: 'transformers',
    production: 'server/fastify/src/memoryEmbeddingModel.ts',
    anchors: [anchor, 'server-side memory embeddings do not support browser-local model'],
  }
}

function memoryStateOwner(anchor: string): Owner {
  return {
    production: 'server/fastify/src/memoryRepository.ts',
    anchors: [anchor],
  }
}

function bardWikiStateOwner(anchor: string): Owner {
  return {
    production: 'server/fastify/src/bardWikiJobs.ts',
    anchors: [anchor],
  }
}

function memoryLifecycleOwner(anchor: string): Owner {
  return {
    production:
      anchor === 'abortRunningJob' ? 'server/fastify/src/memoryWorker.ts' : 'server/fastify/src/memoryRepository.ts',
    anchors: [anchor],
  }
}

function bardWikiLifecycleOwner(anchor: string): Owner {
  return {
    production: 'server/fastify/src/bardWikiJobs.ts',
    anchors: [anchor],
  }
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function verifyOwners(owners: Readonly<Record<string, Owner>>): void {
  for (const [name, owner] of Object.entries(owners)) {
    const production = readRepoFile(owner.production)
    for (const anchor of owner.anchors) expect(production, `${name} production anchor`).toContain(anchor)
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
