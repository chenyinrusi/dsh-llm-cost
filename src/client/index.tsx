/**
 * Client plugin for dsh-llm-cost: renders the turn's dollar cost under each
 * completed assistant message (the `conversation.chat.turnTail` chain) and the
 * session's cumulative total as a floating pill at the conversation column's
 * bottom-left (`shell.overlay`, offset past the sidebar), expanding to the
 * per-model breakdown on hover.
 *
 * Unpriced models are rendered as "unknown" — never a misleading $0.00.
 */

import { createElement, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  ClientContext,
  UseProjection,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads ui-layout's SlotMap augmentation so 'shell.overlay' is a
// valid slot key in this client program (the slot is declared by that package).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
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

type CostPillProps = PropsRuntime<'shell.overlay'>

const PILL_STYLE: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: 'min(320px, 40vw)',
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-primary, rgba(15, 15, 15, 0.92))',
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.16))',
  border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
  cursor: 'default',
  userSelect: 'none',
  whiteSpace: 'nowrap',
}

const POPOVER_STYLE: CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: 'calc(100% + 8px)',
  minWidth: 240,
  padding: '10px 12px',
  borderRadius: 10,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-primary, rgba(15, 15, 15, 0.92))',
  background: 'var(--dsw-alias-surface-overlay, #ffffff)',
  border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
  whiteSpace: 'nowrap',
}

const POPOVER_TITLE_STYLE: CSSProperties = {
  fontWeight: 600,
  marginBottom: 4,
}

const POPOVER_META_STYLE: CSSProperties = {
  opacity: 0.72,
  marginBottom: 4,
}

const POPOVER_ROW_STYLE: CSSProperties = {
  marginTop: 2,
}

/**
 * Bottom-left cumulative cost pill: an always-visible session total that
 * expands to the per-model breakdown on hover/focus. `shell.overlay` is
 * root-scoped, so it carries no `useProjection` seat — the current session's
 * `costUsage` is read through the global `useSessions` store instead.
 */
function CostPill({ useSessions }: CostPillProps) {
  const [open, setOpen] = useState(false)
  // shell.overlay is frame-wide, so the pill anchors past the left sidebar to
  // sit at the conversation column's bottom-left rather than the viewport's.
  const [left, setLeft] = useState(296) // SIDEBAR_DEFAULT (280) + 16
  const cost = useSessions((s) => {
    const id = s.current
    return id === undefined ? undefined : s.byId[id]?.projectionValues?.costUsage
  })

  useEffect(() => {
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const sidebar = frame?.firstElementChild
    if (frame == null || sidebar == null) return
    const update = (): void => { setLeft(sidebar.getBoundingClientRect().width + 16) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(sidebar)
    return () => { observer.disconnect() }
  }, [])

  if (cost === undefined || cost.totalCostUsd === undefined || cost.pricedSteps + cost.unpricedSteps === 0) return null

  const tokens = cost.inputTokens + cost.outputTokens + cost.cacheReadTokens + cost.cacheWriteTokens
  const label = cost.unpricedSteps > 0
    ? `${formatUsd(cost.totalCostUsd)} + ${cost.unpricedSteps} unknown`
    : formatUsd(cost.totalCostUsd)

  return createElement('div', {
    'data-llm-cost-session': 'total',
    tabIndex: 0,
    style: { ...PILL_STYLE, left },
    onMouseEnter: () => { setOpen(true) },
    onMouseLeave: () => { setOpen(false) },
    onFocus: () => { setOpen(true) },
    onBlur: () => { setOpen(false) },
  },
    createElement('span', null, label),
    open && createElement('div', { style: POPOVER_STYLE },
      createElement('div', { style: POPOVER_TITLE_STYLE }, label),
      createElement('div', { style: POPOVER_META_STYLE },
        `${cost.pricedSteps} priced · ${cost.unpricedSteps} unknown · ${formatTokens(tokens)} tokens`),
      cost.byModel.map((entry) => createElement('div', {
        key: entry.model,
        style: POPOVER_ROW_STYLE,
      },
        `${entry.model} × ${entry.calls} — ${formatUsd(entry.costUsd)} · ${formatTokens(entry.inputTokens + entry.outputTokens)} tok`)),
    ),
  )
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: (owner: TurnTailOwnerProps) => ({ turn: owner.turn.turn }),
  }, CostTailView))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'llm-cost-total',
  }, CostPill))
}
