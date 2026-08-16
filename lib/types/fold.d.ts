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
import type { PricingRegistry } from './pricing.ts';
export interface StepCostRecord {
    turn: number;
    step: number;
    /** Provider-owned model id, or null when no route was recorded. */
    model: string | null;
    provider: string | null;
    /** Dollar cost, or null when the model is unknown/unpriced. */
    costUsd: number | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
export interface ModelCostAggregate {
    model: string;
    provider: string | null;
    calls: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
}
export interface CostUsageProjection {
    totalCostUsd: number;
    pricedSteps: number;
    unpricedSteps: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    byModel: ModelCostAggregate[];
    steps: StepCostRecord[];
}
export interface CostProjectionState {
    route: {
        provider: string;
        model: string;
    } | null;
    totalCostUsd: number;
    pricedSteps: number;
    unpricedSteps: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    byModel: ModelCostAggregate[];
    steps: StepCostRecord[];
    lastStep: {
        turn: number;
        step: number;
        record: StepCostRecord;
    } | null;
}
/**
 * Minimal structural event shape. A real `@deepseek-ai/dsh-session` SessionEvent
 * is a superset, so the host wrapper casts down to this for the fold.
 */
export interface MinimalEvent {
    type: string;
    data: Record<string, unknown>;
}
export declare function initCostState(): CostProjectionState;
/**
 * Fold one event into the cost state.
 *
 * `request/context` is the authoritative resolved route (post-fallback);
 * `request/header` only backfills the first request when no context has been
 * seen yet. Usage for one turn/step is adjacent in the log, so a repeated
 * sample (usage chunk then the final assistant/message) REPLACES the previous
 * record rather than double-counting (mirrors the token-meter fold).
 */
export declare function applyCostEvent(state: CostProjectionState, event: MinimalEvent, registry: PricingRegistry): CostProjectionState;
export declare function viewCostState(state: CostProjectionState): CostUsageProjection;
