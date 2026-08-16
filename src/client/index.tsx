/**
 * Client plugin for dsh-llm-cost: renders the turn's dollar cost under each
 * completed assistant message, in the `conversation.chat.turnTail` extension
 * chain (the row that already shows "· Ran for · TTFT · tok/s").
 *
 * Unpriced models are rendered as "unknown" — never a misleading $0.00.
 */

import { createElement } from 'react'
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

  const parts: string[] = []
  if (priced.length > 0) parts.push(formatUsd(costTotal))
  if (unknown > 0) parts.push(`${unknown} unknown`)
  if (tokens > 0) parts.push(`${formatTokens(tokens)} tok`)
  if (parts.length === 0) return null

  return createElement('div', { 'data-llm-cost': turn.turn }, parts.join(' · '))
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: (owner: TurnTailOwnerProps) => ({ turn: owner.turn.turn }),
  }, CostTailView))
}
