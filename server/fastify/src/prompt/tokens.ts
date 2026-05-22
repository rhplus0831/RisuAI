/**
 * Phase 7 budget pruning. Reuses the tokenizer dispatcher from Phase 6.
 *
 * Browser source to port:
 *   - `src/ts/process/promptBudget/preflightTemplateTokens.ts`
 *   - `src/ts/process/promptBudget/finalizeRequestBudget.ts`
 */

export interface TokenBudgetPlan {
  maxContextTokens: number
  maxResponseTokens: number
  reservedTokens: number
}

export async function planBudget(): Promise<TokenBudgetPlan> {
  throw new Error('phase-7 token budgeting not yet implemented')
}
