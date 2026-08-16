/**
 * Pure helpers for the price auto-maintenance tool: search-query and
 * extraction-prompt construction, plus lenient parsing/validation of the LLM's
 * JSON answer. The LLM output is untrusted, so parsing is lenient and field
 * validation is manual (a bad model must not poison the registry).
 */
import type { PricingEntry } from './pricing.ts';
export interface RefreshedEntry {
    provider?: string;
    inputPerM: number;
    outputPerM: number;
    cacheReadPerM?: number;
    cacheWritePerM?: number;
    cacheWrite1hPerM?: number;
    offPeakFactor?: number;
    effectiveDate?: string;
    notes?: string;
}
/** Max models priced in one refresh call — bounds the search query while still covering every model in the built-in snapshot. */
export declare const MAX_MODELS_PER_REFRESH = 24;
/** Build one search query over the target models (already capped by the caller). */
export declare function buildSearchQuery(models: readonly string[]): string;
/**
 * Build the extraction prompt handed to the LLM. It is asked to answer with a
 * single strict JSON object using ONLY the search content it was given, and to
 * omit fields it cannot source.
 */
export declare function buildExtractPrompt(models: readonly string[], searchContent: string): string;
export interface RefreshedPricing {
    models: Record<string, RefreshedEntry>;
}
/** Parse + leniently validate the LLM's JSON answer. Never throws. */
export declare function parseRefreshedPricing(text: string): RefreshedPricing;
/**
 * Merge refreshed entries into a model map (the refresh-delta layer), returning
 * the updated model ids. Mutates the given map in place; callers are expected to
 * hand it the delta layer — NOT the final merged registry — so a refresh never
 * clobbers the user's `config.pricing` overrides (which sit above the deltas).
 */
export declare function applyRefreshed(models: Record<string, PricingEntry>, refreshed: RefreshedPricing): string[];
