/**
 * Host-side cost projection unit: wraps the pure fold (fold.ts) as a
 * session-projection `ProjectionDefinition` registered under the `costUsage`
 * key. The registry is supplied through a thunk so a later price refresh can
 * swap the table without re-registering the unit.
 */
import { z } from 'zod';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { PricingRegistry } from './pricing.ts';
import type { CostProjectionState } from './fold.ts';
import { initCostState, viewCostState } from './fold.ts';
/**
 * Build the cost projection unit.
 * @param registry - thunk returning the current pricing table (supports refresh).
 */
export declare function createCostProjection(registry: () => PricingRegistry): {
    key: "costUsage";
    stateSchema: z.ZodObject<{
        route: z.ZodNullable<z.ZodObject<{
            provider: z.ZodString;
            model: z.ZodString;
        }, z.core.$strip>>;
        totalCostUsd: z.ZodNumber;
        pricedSteps: z.ZodNumber;
        unpricedSteps: z.ZodNumber;
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        cacheReadTokens: z.ZodNumber;
        cacheWriteTokens: z.ZodNumber;
        byModel: z.ZodArray<z.ZodObject<{
            model: z.ZodString;
            provider: z.ZodNullable<z.ZodString>;
            calls: z.ZodNumber;
            costUsd: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
        }, z.core.$strict>>;
        steps: z.ZodArray<z.ZodObject<{
            turn: z.ZodNumber;
            step: z.ZodNumber;
            model: z.ZodNullable<z.ZodString>;
            provider: z.ZodNullable<z.ZodString>;
            costUsd: z.ZodNullable<z.ZodNumber>;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cacheReadTokens: z.ZodNumber;
            cacheWriteTokens: z.ZodNumber;
        }, z.core.$strict>>;
        lastStep: z.ZodNullable<z.ZodObject<{
            turn: z.ZodNumber;
            step: z.ZodNumber;
            record: z.ZodObject<{
                turn: z.ZodNumber;
                step: z.ZodNumber;
                model: z.ZodNullable<z.ZodString>;
                provider: z.ZodNullable<z.ZodString>;
                costUsd: z.ZodNullable<z.ZodNumber>;
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                cacheReadTokens: z.ZodNumber;
                cacheWriteTokens: z.ZodNumber;
            }, z.core.$strict>;
        }, z.core.$strip>>;
    }, z.core.$strict>;
    init: typeof initCostState;
    apply: (state: CostProjectionState, event: SessionEvent) => CostProjectionState;
    stateVersion: number;
    wire: {
        viewSchema: z.ZodObject<{
            totalCostUsd: z.ZodNumber;
            pricedSteps: z.ZodNumber;
            unpricedSteps: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cacheReadTokens: z.ZodNumber;
            cacheWriteTokens: z.ZodNumber;
            byModel: z.ZodArray<z.ZodObject<{
                model: z.ZodString;
                provider: z.ZodNullable<z.ZodString>;
                calls: z.ZodNumber;
                costUsd: z.ZodNumber;
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
            }, z.core.$strict>>;
            steps: z.ZodArray<z.ZodObject<{
                turn: z.ZodNumber;
                step: z.ZodNumber;
                model: z.ZodNullable<z.ZodString>;
                provider: z.ZodNullable<z.ZodString>;
                costUsd: z.ZodNullable<z.ZodNumber>;
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                cacheReadTokens: z.ZodNumber;
                cacheWriteTokens: z.ZodNumber;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        view: typeof viewCostState;
    };
};
