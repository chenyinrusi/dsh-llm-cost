/**
 * Host-side cost projection unit: wraps the pure fold (fold.ts) as a
 * session-projection `ProjectionDefinition` registered under the `costUsage`
 * key. The registry is supplied through a thunk so a later price refresh can
 * swap the table without re-registering the unit.
 */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { PricingRegistry } from './pricing.ts';
import type { CostProjectionState } from './fold.ts';
/**
 * Build the cost projection unit.
 * @param registry - thunk returning the current pricing table (supports refresh).
 */
export declare function createCostProjection(registry: () => PricingRegistry): ProjectionDefinition<'costUsage', CostProjectionState>;
