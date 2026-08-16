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
  provider?: string
  inputPerM: number
  outputPerM: number
  cacheReadPerM?: number
  cacheWritePerM?: number
  cacheWrite1hPerM?: number
  batchInputPerM?: number
  batchOutputPerM?: number
  contextCacheStoragePerMPerHr?: number
  /** Off-peak multiplier (e.g. 0.5 = half price). Prices are stored at PEAK rate; off-peak applies this factor. */
  offPeakFactor?: number
  effectiveDate?: string
  notes?: string
}

export interface PricingRegistry {
  version: number
  generatedAt?: string
  source?: string
  models: Record<string, PricingEntry>
}

/** Disjoint token buckets, matching @deepseek-ai/dsh-llm `TokenUsage`. */
export interface TokenUsageLike {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type PricingResolution =
  | { status: 'priced'; entry: PricingEntry; matchedModel: string; match: 'exact' | 'substring' }
  | { status: 'free'; matchedModel: null; match: 'ollama' }
  | { status: 'unknown'; matchedModel: null; match: 'none' }

/**
 * Resolve one provider/model pair against the registry.
 * @param registry - pricing table.
 * @param model - provider-owned model id.
 * @param provider - registered provider route (may be empty).
 */
export function resolvePricing(
  registry: PricingRegistry,
  model: string,
  provider: string = '',
): PricingResolution {
  if (provider === 'ollama') {
    return { status: 'free', matchedModel: null, match: 'ollama' }
  }
  const exact = registry.models[model]
  if (exact !== undefined) {
    return { status: 'priced', entry: exact, matchedModel: model, match: 'exact' }
  }
  // Longest key first: a longer key is a more specific identity.
  let best: { key: string; entry: PricingEntry } | undefined
  for (const key of Object.keys(registry.models)) {
    if (model.includes(key) && (best === undefined || key.length > best.key.length)) {
      const entry = registry.models[key]
      if (entry !== undefined) best = { key, entry }
    }
  }
  if (best !== undefined) {
    return { status: 'priced', entry: best.entry, matchedModel: best.key, match: 'substring' }
  }
  return { status: 'unknown', matchedModel: null, match: 'none' }
}

/** Peak billing windows in UTC hours: 01:00–04:00 and 06:00–10:00 (all else off-peak). */
const PEAK_WINDOWS: readonly [number, number][] = [[1, 4], [6, 10]]

/** Whether a Unix-epoch-ms timestamp falls in a DeepSeek peak billing window. */
export function isPeak(ms: number): boolean {
  const d = new Date(ms)
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600
  return PEAK_WINDOWS.some(([start, end]) => hour >= start && hour < end)
}

/** Multiplier for one entry at one timestamp: 1 during peak, `offPeakFactor` otherwise. */
export function priceFactor(entry: PricingEntry, atMs: number): number {
  if (entry.offPeakFactor === undefined) return 1
  return isPeak(atMs) ? 1 : entry.offPeakFactor
}

/**
 * Dollar cost of one usage record under one pricing entry.
 *
 * inputTokens is uncached input only (DeepSeek's adapter already subtracts
 * cache hits out of prompt_tokens). reasoning is already inside outputTokens,
 * so it is not added again. batch/storage dimensions are deliberately omitted
 * from the display figure (v1). When `atMs` is given and the entry declares
 * `offPeakFactor`, the total is scaled by the factor outside peak windows.
 */
export function costUsd(usage: TokenUsageLike, entry: PricingEntry, atMs?: number): number {
  const perM = (tokens: number, price: number | undefined): number =>
    tokens > 0 && price !== undefined && price > 0 ? (tokens / 1_000_000) * price : 0
  const base = perM(usage.inputTokens, entry.inputPerM)
    + perM(usage.cacheReadTokens ?? 0, entry.cacheReadPerM)
    + perM(usage.cacheWriteTokens ?? 0, entry.cacheWritePerM)
    + perM(usage.outputTokens, entry.outputPerM)
  return atMs === undefined ? base : base * priceFactor(entry, atMs)
}

/**
 * Combined resolve + cost. `costUsd` is `null` when the model is unpriced
 * (unknown) — callers render "unknown" rather than a misleading $0.
 */
export function resolveAndCost(
  registry: PricingRegistry,
  model: string,
  provider: string,
  usage: TokenUsageLike,
  atMs?: number,
): { costUsd: number | null; resolution: PricingResolution } {
  const resolution = resolvePricing(registry, model, provider)
  if (resolution.status === 'unknown') return { costUsd: null, resolution }
  if (resolution.status === 'free') return { costUsd: 0, resolution }
  return { costUsd: costUsd(usage, resolution.entry, atMs), resolution }
}

/** Merge an optional override over a base registry (shallow, per-model). */
export function mergeRegistries(
  base: PricingRegistry,
  override?: PricingRegistry | Partial<PricingRegistry> | null,
): PricingRegistry {
  if (override === undefined || override === null) return base
  return {
    version: base.version,
    ...base.generatedAt === undefined ? {} : { generatedAt: base.generatedAt },
    ...base.source === undefined ? {} : { source: base.source },
    models: { ...base.models, ...override.models },
  }
}
