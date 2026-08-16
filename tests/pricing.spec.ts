import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  costUsd,
  mergeRegistries,
  resolveAndCost,
  resolvePricing,
} from '../src/pricing.ts'

const registry = {
  version: 1,
  models: {
    'deepseek-v4-flash': {
      provider: 'deepseek', inputPerM: 0.14, outputPerM: 0.28, cacheReadPerM: 0.0028,
    },
    'gpt-5.4': { provider: 'openai', inputPerM: 2.5, outputPerM: 15, cacheReadPerM: 0.25 },
    'gpt-5.4-mini': { provider: 'openai', inputPerM: 1.0, outputPerM: 6, cacheReadPerM: 0.1 },
    'claude-sonnet-5': {
      provider: 'anthropic', inputPerM: 2.0, outputPerM: 10, cacheReadPerM: 0.2, cacheWritePerM: 2.5,
    },
  },
}

test('exact model match resolves as priced', () => {
  const r = resolvePricing(registry, 'deepseek-v4-flash', 'deepseek')
  assert.equal(r.status, 'priced')
  assert.equal(r.match, 'exact')
  assert.equal(r.matchedModel, 'deepseek-v4-flash')
})

test('longest-key substring match wins (gpt-5.4-mini is not swallowed by gpt-5.4)', () => {
  const r = resolvePricing(registry, 'gpt-5.4-mini-20250601', 'openai')
  assert.equal(r.status, 'priced')
  assert.equal(r.match, 'substring')
  assert.equal(r.matchedModel, 'gpt-5.4-mini')
})

test('ollama provider is always free', () => {
  const r = resolvePricing(registry, 'llama3.1', 'ollama')
  assert.equal(r.status, 'free')
})

test('unknown model is unknown, never silently zero', () => {
  const r = resolvePricing(registry, 'made-up-model', 'openai')
  assert.equal(r.status, 'unknown')
  const { costUsd } = resolveAndCost(registry, 'made-up-model', 'openai', {
    inputTokens: 10, outputTokens: 10,
  })
  assert.equal(costUsd, null)
})

test('cost math includes disjoint cache buckets', () => {
  // 1000 input @ $1/M + 2000 cache-read @ $0.5/M + 500 output @ $2/M
  const usd = costUsd(
    { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 },
    { inputPerM: 1, outputPerM: 2, cacheReadPerM: 0.5 },
  )
  assert.ok(Math.abs(usd - 0.003) < 1e-12, `expected 0.003, got ${usd}`)
})

test('zero usage costs zero even with a price', () => {
  const usd = costUsd(
    { inputTokens: 0, outputTokens: 0 },
    { inputPerM: 5, outputPerM: 30 },
  )
  assert.equal(usd, 0)
})

test('mergeRegistries overlays per-model entries over the base', () => {
  const merged = mergeRegistries(registry, {
    version: 1,
    models: { 'deepseek-v4-flash': { inputPerM: 0.2, outputPerM: 0.4 } },
  })
  assert.equal(merged.models['deepseek-v4-flash'].inputPerM, 0.2)
  assert.equal(merged.models['gpt-5.4'].inputPerM, 2.5)
})

test('mergeRegistries with no override returns the base reference', () => {
  assert.equal(mergeRegistries(registry, undefined), registry)
  assert.equal(mergeRegistries(registry, null), registry)
})
