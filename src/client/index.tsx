/**
 * Client plugin for dsh-llm-cost: renders the turn's dollar cost under each
 * completed assistant message (the `conversation.chat.turnTail` chain) and the
 * session's cumulative total as an extra segment under the latest completed
 * assistant message, with the per-model breakdown on hover.
 *
 * Unpriced models are rendered as "unknown" — never a misleading $0.00.
 */

import { createElement, type ReactNode } from 'react'
import type {
  ClientContext,
  UseProjection,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
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

  const parts: (string | ReactNode)[] = []
  if (priced.length > 0) parts.push(formatUsd(costTotal))
  if (unknown > 0) parts.push(`${unknown} unknown`)
  if (tokens > 0) parts.push(`${formatTokens(tokens)} tok`)

  // Session cumulative total, only under the latest completed turn.
  const latestTurn = cost.steps.reduce((max, step) => Math.max(max, step.turn), -1)
  if (matched.turn === latestTurn && cost.pricedSteps + cost.unpricedSteps > 0) {
    const totalTokens = cost.inputTokens + cost.outputTokens + cost.cacheReadTokens + cost.cacheWriteTokens
    const label = cost.unpricedSteps > 0
      ? `累计 ${formatUsd(cost.totalCostUsd)} + ${cost.unpricedSteps} unknown`
      : `累计 ${formatUsd(cost.totalCostUsd)}`
    const breakdown = cost.byModel
      .map((entry) => `${entry.model} × ${entry.calls} — ${formatUsd(entry.costUsd)} · ${formatTokens(entry.inputTokens + entry.outputTokens)} tok`)
      .join('\n')
    parts.push(createElement('span', {
      'data-llm-cost-session': 'total',
      title: `${cost.pricedSteps} priced · ${cost.unpricedSteps} unknown · ${formatTokens(totalTokens)} tokens\n${breakdown}`,
    }, label))
  }
  if (parts.length === 0) return null

  const nodes: ReactNode[] = []
  parts.forEach((part, index) => {
    if (index > 0) nodes.push(' · ')
    nodes.push(part)
  })
  return createElement('div', { 'data-llm-cost': turn.turn }, nodes)
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: (owner: TurnTailOwnerProps) => ({ turn: owner.turn.turn }),
  }, CostTailView))
}
