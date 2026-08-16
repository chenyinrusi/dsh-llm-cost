/**
 * Plugin config for dsh-llm-cost — the single home for both the `LlmCostConfig`
 * type and its zod `Config` schema. Kept free of Cordis/dsh imports so the
 * schema is unit-testable without the DSH toolchain (see `tests/config.spec.ts`).
 */
import { z } from 'zod';
import type { PricingRegistry } from './pricing.ts';
/** Optional pricing override merged over the built-in snapshot. */
export interface LlmCostConfig {
    pricing?: PricingRegistry;
    /** Override file the refresh tool writes to (default ~/.dsh/llm-cost/pricing.override.json). */
    pricingFile?: string;
    /** Provider route for the price-extraction model call. */
    refreshProvider?: string;
    /** Model id for the price-extraction model call. */
    refreshModel?: string;
}
/**
 * Cordis validates the loader row's config against this before `apply`.
 * An omitted `config` key (undefined) becomes `{}`; a present-but-empty
 * `config:` key parses as YAML `null` and fails validation loudly with the
 * entry name. Unknown keys are stripped (zod's default object behavior).
 * Field-for-field aligned with {@link LlmCostConfig}; `config.spec.ts` pins
 * the accept/reject semantics.
 */
export declare const Config: z.ZodDefault<z.ZodObject<{
    pricing: z.ZodOptional<z.ZodObject<{
        version: z.ZodNumber;
        generatedAt: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodString>;
        models: z.ZodRecord<z.ZodString, z.ZodObject<{
            provider: z.ZodOptional<z.ZodString>;
            inputPerM: z.ZodNumber;
            outputPerM: z.ZodNumber;
            cacheReadPerM: z.ZodOptional<z.ZodNumber>;
            cacheWritePerM: z.ZodOptional<z.ZodNumber>;
            cacheWrite1hPerM: z.ZodOptional<z.ZodNumber>;
            batchInputPerM: z.ZodOptional<z.ZodNumber>;
            batchOutputPerM: z.ZodOptional<z.ZodNumber>;
            contextCacheStoragePerMPerHr: z.ZodOptional<z.ZodNumber>;
            offPeakFactor: z.ZodOptional<z.ZodNumber>;
            effectiveDate: z.ZodOptional<z.ZodString>;
            notes: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    pricingFile: z.ZodOptional<z.ZodString>;
    refreshProvider: z.ZodOptional<z.ZodString>;
    refreshModel: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
