/**
 * Pure pricing vocabulary, lookup ladder, and cost math for dsh-llm-cost.
 *
 * No Cordis/React/dsh imports — unit-testable with plain Node. The matching
 * ladder mirrors customized_agentic_system/src/config/models.py `get_pricing`:
 *
 *   0. provider === "ollama"  → free (0)
 *   1. exact model-id match
 *   2. longest-key substring match (so "gpt-5.4-mini" is not swallowed by "gpt-5.4")
 *   3. unknown → `status: 'unknown'` (rendered as "unknown", never silently $0)
 */
export interface PricingEntry {
    provider?: string;
    inputPerM: number;
    outputPerM: number;
    cacheReadPerM?: number;
    cacheWritePerM?: number;
    cacheWrite1hPerM?: number;
    batchInputPerM?: number;
    batchOutputPerM?: number;
    contextCacheStoragePerMPerHr?: number;
    effectiveDate?: string;
    notes?: string;
}
export interface PricingRegistry {
    version: number;
    generatedAt?: string;
    source?: string;
    models: Record<string, PricingEntry>;
}
/** Disjoint token buckets, matching @deepseek-ai/dsh-llm `TokenUsage`. */
export interface TokenUsageLike {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}
export type PricingResolution = {
    status: 'priced';
    entry: PricingEntry;
    matchedModel: string;
    match: 'exact' | 'substring';
} | {
    status: 'free';
    matchedModel: null;
    match: 'ollama';
} | {
    status: 'unknown';
    matchedModel: null;
    match: 'none';
};
/**
 * Resolve one provider/model pair against the registry.
 * @param registry - pricing table.
 * @param model - provider-owned model id.
 * @param provider - registered provider route (may be empty).
 */
export declare function resolvePricing(registry: PricingRegistry, model: string, provider?: string): PricingResolution;
/**
 * Dollar cost of one usage record under one pricing entry.
 *
 * inputTokens is uncached input only (DeepSeek's adapter already subtracts
 * cache hits out of prompt_tokens). reasoning is already inside outputTokens,
 * so it is not added again. batch/storage dimensions are deliberately omitted
 * from the display figure (v1).
 */
export declare function costUsd(usage: TokenUsageLike, entry: PricingEntry): number;
/**
 * Combined resolve + cost. `costUsd` is `null` when the model is unpriced
 * (unknown) — callers render "unknown" rather than a misleading $0.
 */
export declare function resolveAndCost(registry: PricingRegistry, model: string, provider: string, usage: TokenUsageLike): {
    costUsd: number | null;
    resolution: PricingResolution;
};
/** Merge an optional override over a base registry (shallow, per-model). */
export declare function mergeRegistries(base: PricingRegistry, override?: PricingRegistry | Partial<PricingRegistry> | null): PricingRegistry;
