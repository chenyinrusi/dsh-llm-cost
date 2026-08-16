/**
 * Client plugin for dsh-llm-cost: renders the turn's dollar cost under each
 * completed assistant message (the `conversation.chat.turnTail` chain) and the
 * session's cumulative total in the header utilities row.
 *
 * Unpriced models are rendered as "unknown" — never a misleading $0.00.
 */

import { createElement } from 'react'
import type {
  ClientContext,
  UseProjection,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../projection.ts'

export const inject = ['slots']

function formatUsd(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.0001) return `$${value.toExponential(1)}`
  if (value < 0.01) return `$${value.toFixed(5)}`
  if (value < 1) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function formatTokens(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${Math.round(value / 100) / 10}K`
  return `${Math.round(value / 100000) / 10}M`
}

interface CostTailProps extends TurnTailOwnerProps {
  matched: { turn: number }
  useProjection: UseProjection
  useSession?: unknown
  sessionId?: unknown
}

function CostTailView({ turn, matched, useProjection }: CostTailProps) {
  const cost = useProjection('costUsage')
  if (cost === undefined) return null
  const steps = cost.steps.filter((step) => step.turn === matched.turn)
  if (steps.length === 0) return null

  const priced = steps.filter((step) => step.costUsd !== null)
  const unknown = steps.length - priced.length
  const costTotal = priced.reduce((acc, step) => acc + (step.costUsd ?? 0), 0)
  const tokens = steps.reduce(
    (acc, step) => acc + step.inputTokens + step.outputTokens
      + step.cacheReadTokens + step.cacheWriteTokens,
    0,
  )

  const parts: string[] = []
  if (priced.length > 0) parts.push(formatUsd(costTotal))
  if (unknown > 0) parts.push(`${unknown} unknown`)
  if (tokens > 0) parts.push(`${formatTokens(tokens)} tok`)
  if (parts.length === 0) return null

  return createElement('div', { 'data-llm-cost': turn.turn }, parts.join(' · '))
}

type SessionCostProps = PropsRuntime<'conversation.session.header.utilities'>

/**
 * Session-header cumulative total: the whole session's dollar cost so far, read
 * from the same `costUsage` projection the per-turn tails use. Renders nothing
 * until the session has at least one metered step.
 */
function SessionCostBadge({ useProjection }: SessionCostProps) {
  const cost = useProjection('costUsage')
  if (cost === undefined || cost.pricedSteps + cost.unpricedSteps === 0) return null

  const tokens = cost.inputTokens + cost.outputTokens + cost.cacheReadTokens + cost.cacheWriteTokens
  const title = `${cost.pricedSteps} priced · ${cost.unpricedSteps} unknown · ${formatTokens(tokens)} tokens`
  const label = cost.unpricedSteps > 0
    ? `${formatUsd(cost.totalCostUsd)} + ${cost.unpricedSteps} unknown`
    : formatUsd(cost.totalCostUsd)

  return createElement('span', { 'data-llm-cost-session': 'total', title }, label)
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: (owner: TurnTailOwnerProps) => ({ turn: owner.turn.turn }),
  }, CostTailView))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'llm-cost-total',
  }, SessionCostBadge))
}
