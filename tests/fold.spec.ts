import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCostEvent,
  initCostState,
  recomputeTotals,
  viewCostState,
} from '../src/fold.ts'

const registry = {
  version: 1,
  models: {
    'deepseek-v4-flash': {
      provider: 'deepseek', inputPerM: 1, outputPerM: 2, cacheReadPerM: 0.5,
    },
  },
}

test('an uninteresting event returns the same state reference', () => {
  const state = initCostState()
  const next = applyCostEvent(state, { type: 'todo/write', data: { todos: [] } }, registry)
  assert.equal(next, state)
})

test('assistant/message with usage produces one priced step', () => {
  let state = initCostState()
  state = applyCostEvent(state, { type: 'request/context', data: { provider: 'deepseek', model: 'deepseek-v4-flash' } }, registry)
  state = applyCostEvent(state, {
    type: 'assistant/message',
    data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 } },
  }, registry)

  const view = viewCostState(state)
  assert.equal(view.steps.length, 1)
  assert.equal(view.pricedSteps, 1)
  assert.equal(view.unpricedSteps, 0)
  // 1000*1/M + 2000*0.5/M + 500*2/M = 0.003
  assert.ok(Math.abs(view.totalCostUsd - 0.003) < 1e-12, `got ${view.totalCostUsd}`)
  assert.equal(view.byModel.length, 1)
  assert.equal(view.byModel[0].model, 'deepseek-v4-flash')
})

test('usage chunk then final message for the same step replaces, not double-counts', () => {
  let state = initCostState()
  state = applyCostEvent(state, { type: 'request/context', data: { provider: 'deepseek', model: 'deepseek-v4-flash' } }, registry)
  state = applyCostEvent(state, {
    type: 'assistant/chunk',
    data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1000, outputTokens: 0 } } },
  }, registry)
  state = applyCostEvent(state, {
    type: 'assistant/message',
    data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 } },
  }, registry)

  const view = viewCostState(state)
  assert.equal(view.steps.length, 1)
  assert.ok(Math.abs(view.totalCostUsd - 0.003) < 1e-12, `got ${view.totalCostUsd}`)
})

test('a second step accumulates independently', () => {
  let state = initCostState()
  state = applyCostEvent(state, { type: 'request/context', data: { provider: 'deepseek', model: 'deepseek-v4-flash' } }, registry)
  state = applyCostEvent(state, {
    type: 'assistant/message',
    data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 0 } },
  }, registry)
  state = applyCostEvent(state, {
    type: 'assistant/message',
    data: { turn: 1, step: 2, usage: { inputTokens: 0, outputTokens: 500 } },
  }, registry)

  const view = viewCostState(state)
  assert.equal(view.steps.length, 2)
  // 0.001 + 0.001 = 0.002
  assert.ok(Math.abs(view.totalCostUsd - 0.002) < 1e-12, `got ${view.totalCostUsd}`)
})

test('unknown model records a step with null cost (unpriced)', () => {
  let state = initCostState()
  state = applyCostEvent(state, { type: 'request/context', data: { provider: 'openai', model: 'gpt-99' } }, registry)
  state = applyCostEvent(state, {
    type: 'assistant/message',
    data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 10 } },
  }, registry)

  const view = viewCostState(state)
  assert.equal(view.steps.length, 1)
  assert.equal(view.steps[0].costUsd, null)
  assert.equal(view.pricedSteps, 0)
  assert.equal(view.unpricedSteps, 1)
  assert.equal(view.totalCostUsd, 0)
})

test('request/header backfills the route only before any request/context', () => {
  let state = initCostState()
  state = applyCostEvent(state, {
    type: 'request/header',
    data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } },
  }, registry)
  state = applyCostEvent(state, {
    type: 'assistant/message',
    data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 0 } },
  }, registry)
  const view = viewCostState(state)
  assert.equal(view.steps[0].model, 'deepseek-v4-flash')
  assert.ok(view.steps[0].costUsd !== null)

  // A later request/context (resolved route) overrides the header-proposed route.
  state = applyCostEvent(state, { type: 'request/context', data: { provider: 'openai', model: 'gpt-99' } }, registry)
  state = applyCostEvent(state, {
    type: 'assistant/message',
    data: { turn: 1, step: 2, usage: { inputTokens: 10, outputTokens: 10 } },
  }, registry)
  const view2 = viewCostState(state)
  assert.equal(view2.steps[1].model, 'gpt-99')
  assert.equal(view2.steps[1].costUsd, null)
})

test('incremental aggregates match a full recompute over a mixed sequence', () => {
  const multi = {
    version: 1,
    models: {
      'deepseek-v4-flash': { provider: 'deepseek', inputPerM: 1, outputPerM: 2, cacheReadPerM: 0.5 },
      'gpt-x': { provider: 'openai', inputPerM: 2, outputPerM: 4 },
    },
  }
  let state = initCostState()
  const route = (provider: string, model: string) =>
    (s: typeof state) => applyCostEvent(s, { type: 'request/context', data: { provider, model } }, multi)
  const step = (turn: number, step: number, usage: Record<string, number>) =>
    (s: typeof state) => applyCostEvent(s, {
      type: 'assistant/message',
      data: { turn, step, usage },
    }, multi)

  state = route('deepseek', 'deepseek-v4-flash')(state)
  state = step(1, 1, { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000 })(state)
  state = step(1, 2, { inputTokens: 0, outputTokens: 500 })(state)
  state = route('openai', 'gpt-x')(state)
  state = step(2, 1, { inputTokens: 3000, outputTokens: 1000 })(state)
  // Replace step 2,1 (usage chunk then final message pattern across a route).
  state = step(2, 1, { inputTokens: 3000, outputTokens: 2000 })(state)
  state = route('openai', 'gpt-unknown')(state)
  state = step(2, 2, { inputTokens: 10, outputTokens: 10 })(state)

  const view = viewCostState(state)
  const expected = recomputeTotals(view.steps)
  assert.equal(view.totalCostUsd, expected.totalCostUsd)
  assert.equal(view.pricedSteps, expected.pricedSteps)
  assert.equal(view.unpricedSteps, expected.unpricedSteps)
  assert.equal(view.inputTokens, expected.inputTokens)
  assert.equal(view.outputTokens, expected.outputTokens)
  assert.equal(view.cacheReadTokens, expected.cacheReadTokens)
  assert.equal(view.cacheWriteTokens, expected.cacheWriteTokens)
  assert.deepEqual(view.byModel, expected.byModel)
})
