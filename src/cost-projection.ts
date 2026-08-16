/**
 * Host-side cost projection unit: wraps the pure fold (fold.ts) as a
 * session-projection `ProjectionDefinition` registered under the `costUsage`
 * key. The registry is supplied through a thunk so a later price refresh can
 * swap the table without re-registering the unit.
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { PricingRegistry } from './pricing.ts'
import type {
  CostProjectionState,
  CostUsageProjection,
  MinimalEvent,
} from './fold.ts'
import { applyCostEvent, initCostState, viewCostState } from './fold.ts'

const stepRecordSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  costUsd: z.number().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

const modelAggregateSchema = z.object({
  model: z.string(),
  provider: z.string().nullable(),
  calls: z.number().int().nonnegative(),
  costUsd: z.number(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
}).strict()

const costUsageSchema = z.object({
  totalCostUsd: z.number(),
  pricedSteps: z.number().int().nonnegative(),
  unpricedSteps: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  byModel: z.array(modelAggregateSchema),
  steps: z.array(stepRecordSchema),
}).strict()

/**
 * Build the cost projection unit.
 * @param registry - thunk returning the current pricing table (supports refresh).
 */
export function createCostProjection(
  registry: () => PricingRegistry,
): ProjectionDefinition<'costUsage', CostProjectionState> {
  return {
    key: 'costUsage',
    schema: costUsageSchema as ZodType<CostUsageProjection>,
    init: initCostState,
    apply: (state, event: SessionEvent) =>
      applyCostEvent(state, event as unknown as MinimalEvent, registry()),
    view: viewCostState,
    stateVersion: 1,
  }
}
