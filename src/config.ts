/**
 * Plugin config for dsh-llm-cost — the single home for both the `LlmCostConfig`
 * type and its zod `Config` schema. Kept free of Cordis/dsh imports so the
 * schema is unit-testable without the DSH toolchain (see `tests/config.spec.ts`).
 */

import { z } from 'zod'
import type { PricingRegistry } from './pricing.ts'

/** Optional pricing override merged over the built-in snapshot. */
export interface LlmCostConfig {
  pricing?: PricingRegistry
  /** Override file the refresh tool writes to (default ~/.dsh/llm-cost/pricing.override.json). */
  pricingFile?: string
  /** Provider route for the price-extraction model call. */
  refreshProvider?: string
  /** Model id for the price-extraction model call. */
  refreshModel?: string
}

const PricingEntrySchema = z.object({
  provider: z.string().optional(),
  inputPerM: z.number(),
  outputPerM: z.number(),
  cacheReadPerM: z.number().optional(),
  cacheWritePerM: z.number().optional(),
  cacheWrite1hPerM: z.number().optional(),
  batchInputPerM: z.number().optional(),
  batchOutputPerM: z.number().optional(),
  contextCacheStoragePerMPerHr: z.number().optional(),
  effectiveDate: z.string().optional(),
  notes: z.string().optional(),
})

const PricingRegistrySchema = z.object({
  version: z.number(),
  generatedAt: z.string().optional(),
  source: z.string().optional(),
  models: z.record(z.string(), PricingEntrySchema),
})

/**
 * Cordis validates the loader row's config against this before `apply`.
 * An omitted `config` key (undefined) becomes `{}`; a present-but-empty
 * `config:` key parses as YAML `null` and fails validation loudly with the
 * entry name. Unknown keys are stripped (zod's default object behavior).
 * Field-for-field aligned with {@link LlmCostConfig}; `config.spec.ts` pins
 * the accept/reject semantics.
 */
export const Config = z.object({
  pricing: PricingRegistrySchema.optional(),
  pricingFile: z.string().optional(),
  refreshProvider: z.string().optional(),
  refreshModel: z.string().optional(),
}).default({})
