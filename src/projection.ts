/**
 * Projection vocabulary shared by the host projection and the client renderer.
 *
 * Declaring the `costUsage` key into both tables here is what types the host
 * `ProjectionDefinition<'costUsage', …>` and the client's
 * `useProjection('costUsage')` against the same value type: the host fold
 * state lives in `SessionProjectionStateMap`, the client-visible wire value
 * in `SessionProjectionMap`.
 */

import type { CostProjectionState, CostUsageProjection } from './fold.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host fold state: per-step ledger plus the fold-internal route/lastStep. */
    costUsage: CostProjectionState
  }
  interface SessionProjectionMap {
    /** Per-step and aggregate dollar cost across the complete durable log. */
    costUsage: CostUsageProjection
  }
}

export type {
  CostUsageProjection,
  CostProjectionState,
  ModelCostAggregate,
  StepCostRecord,
} from './fold.ts'
