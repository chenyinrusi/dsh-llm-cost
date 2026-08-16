/**
 * Pure cost-projection fold for dsh-llm-cost.
 *
 * Dependency-free (structural event types only) so it can be unit-tested with
 * plain Node and wrapped by the host projection without dragging the dsh-session
 * session types into the test harness. Every function is pure: same input →
 * same output, and an uninteresting event returns the SAME state reference
 * (the session-projection drive treats Object.is equality as "no downstream
 * work").
 */

import type { PricingRegistry, TokenUsageLike } from './pricing.ts'
import { resolveAndCost } from './pricing.ts'

export interface StepCostRecord {
  turn: number
  step: number
  /** Provider-owned model id, or null when no route was recorded. */
  model: string | null
  provider: string | null
  /** Dollar cost, or null when the model is unknown/unpriced. */
  costUsd: number | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ModelCostAggregate {
  model: string
  provider: string | null
  calls: number
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export interface CostUsageProjection {
  totalCostUsd: number
  pricedSteps: number
  unpricedSteps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  byModel: ModelCostAggregate[]
  steps: StepCostRecord[]
}

export interface CostProjectionState {
  route: { provider: string; model: string } | null
  totalCostUsd: number
  pricedSteps: number
  unpricedSteps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  byModel: ModelCostAggregate[]
  steps: StepCostRecord[]
  lastStep: { turn: number; step: number; record: StepCostRecord } | null
}

/**
 * Minimal structural event shape. A real `@deepseek-ai/dsh-session` SessionEvent
 * is a superset, so the host wrapper casts down to this for the fold.
 */
export interface MinimalEvent {
  type: string
  data: Record<string, unknown>
  /** Unix epoch ms of the event (from the session log), used for peak/off-peak pricing. */
  time?: number
}

function usageOf(event: MinimalEvent):
{ turn: number; step: number; usage: TokenUsageLike } | undefined {
  if (event.type === 'assistant/message') {
    const data = event.data
    const usage = data.usage as TokenUsageLike | undefined
    if (usage === undefined) return undefined
    return { turn: data.turn as number, step: data.step as number, usage }
  }
  if (event.type === 'assistant/chunk') {
    const data = event.data
    const chunk = data.chunk as { type?: string; usage?: TokenUsageLike } | undefined
    if (chunk !== undefined && chunk.type === 'usage' && chunk.usage !== undefined) {
      return { turn: data.turn as number, step: data.step as number, usage: chunk.usage }
    }
  }
  return undefined
}

export function initCostState(): CostProjectionState {
  return {
    route: null,
    totalCostUsd: 0,
    pricedSteps: 0,
    unpricedSteps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    byModel: [],
    steps: [],
    lastStep: null,
  }
}

/** Recompute every aggregate from the step ledger (deterministic, order-stable). */
function recomputeTotals(steps: readonly StepCostRecord[]): {
  totalCostUsd: number
  pricedSteps: number
  unpricedSteps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  byModel: ModelCostAggregate[]
} {
  let totalCostUsd = 0
  let pricedSteps = 0
  let unpricedSteps = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  const byModelMap = new Map<string, ModelCostAggregate>()
  for (const step of steps) {
    inputTokens += step.inputTokens
    outputTokens += step.outputTokens
    cacheReadTokens += step.cacheReadTokens
    cacheWriteTokens += step.cacheWriteTokens
    if (step.costUsd === null) {
      unpricedSteps += 1
    } else {
      pricedSteps += 1
      totalCostUsd += step.costUsd
    }
    const key = step.model ?? 'unknown'
    const existing = byModelMap.get(key)
    const agg: ModelCostAggregate = existing ?? {
      model: key,
      provider: step.provider,
      calls: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
    agg.calls += 1
    agg.costUsd += step.costUsd ?? 0
    agg.inputTokens += step.inputTokens
    agg.outputTokens += step.outputTokens
    if (existing === undefined) byModelMap.set(key, agg)
  }
  const byModel = [...byModelMap.values()].sort((a, b) => b.costUsd - a.costUsd)
  return {
    totalCostUsd,
    pricedSteps,
    unpricedSteps,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    byModel,
  }
}

/**
 * Fold one event into the cost state.
 *
 * `request/context` is the authoritative resolved route (post-fallback);
 * `request/header` only backfills the first request when no context has been
 * seen yet. Usage for one turn/step is adjacent in the log, so a repeated
 * sample (usage chunk then the final assistant/message) REPLACES the previous
 * record rather than double-counting (mirrors the token-meter fold).
 */
export function applyCostEvent(
  state: CostProjectionState,
  event: MinimalEvent,
  registry: PricingRegistry,
): CostProjectionState {
  let route = state.route
  if (event.type === 'request/context') {
    const data = event.data
    route = { provider: data.provider as string, model: data.model as string }
  } else if (event.type === 'request/header' && route === null) {
    const header = event.data.header as { config?: { provider?: string; model?: string } } | undefined
    if (header?.config?.provider !== undefined && header.config.model !== undefined) {
      route = { provider: header.config.provider, model: header.config.model }
    }
  }

  const sample = usageOf(event)
  if (sample === undefined) {
    return route === state.route ? state : { ...state, route }
  }

  const { turn, step, usage } = sample
  const model = route?.model ?? null
  const provider = route?.provider ?? null
  const { costUsd } = resolveAndCost(registry, model ?? '', provider ?? '', usage, event.time)

  const record: StepCostRecord = {
    turn,
    step,
    model,
    provider,
    costUsd,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }

  const last = state.lastStep
  const steps = last !== null && last.turn === turn && last.step === step
    ? state.steps.slice(0, -1).concat([record])
    : state.steps.concat([record])

  return {
    route,
    ...recomputeTotals(steps),
    steps,
    lastStep: { turn, step, record },
  }
}

export function viewCostState(state: CostProjectionState): CostUsageProjection {
  return {
    totalCostUsd: state.totalCostUsd,
    pricedSteps: state.pricedSteps,
    unpricedSteps: state.unpricedSteps,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheWriteTokens: state.cacheWriteTokens,
    byModel: state.byModel,
    steps: state.steps,
  }
}
