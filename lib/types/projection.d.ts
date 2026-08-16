/**
 * Projection vocabulary shared by the host projection and the client renderer.
 *
 * Declaring the `costUsage` key into SessionProjectionMap here is what types
 * both the host `ProjectionDefinition<'costUsage', …>` and the client's
 * `useProjection('costUsage')` against the same value type.
 */
import type { CostUsageProjection } from './fold.ts';
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /** Per-step and aggregate dollar cost across the complete durable log. */
        costUsage: CostUsageProjection;
    }
}
export type { CostUsageProjection, CostProjectionState, ModelCostAggregate, StepCostRecord, } from './fold.ts';
