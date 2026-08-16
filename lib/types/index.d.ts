/**
 * Host plugin for dsh-llm-cost: registers the `costUsage` session projection
 * (per-step/per-turn dollar cost) and, when the tools/llm/web capabilities are
 * present, a model-facing `llm_cost_refresh` tool that looks up current prices
 * on the web and updates the pricing table.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { LlmCostConfig } from './config.ts';
export { Config } from './config.ts';
export declare const name = "llm-cost";
export declare function apply(ctx: Context, config?: LlmCostConfig): void;
