import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  costUsd,
  isPeak,
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

test('isPeak detects the peak windows (01:00-04:00, 06:00-10:00 UTC)', () => {
  const at = (h: number) => Date.UTC(2026, 7, 17, h, 0, 0)
  assert.equal(isPeak(at(2)), true)   // 02:00 UTC peak
  assert.equal(isPeak(at(8)), true)   // 08:00 UTC peak
  assert.equal(isPeak(at(0)), false)  // 00:00 UTC off-peak
  assert.equal(isPeak(at(5)), false)  // 05:00 UTC off-peak
  assert.equal(isPeak(at(12)), false) // 12:00 UTC off-peak
})

test('isPeak treats weekends as off-peak from 2026-08-23', () => {
  // Before the effective date, weekends still follow the hourly windows.
  assert.equal(isPeak(Date.UTC(2026, 7, 22, 2, 0, 0)), true) // Sat 08-22 02:00 UTC
  // 2026-08-23 is a Sunday: the weekend rule begins.
  assert.equal(isPeak(Date.UTC(2026, 7, 23, 2, 0, 0)), false) // Sun 02:00 UTC
  assert.equal(isPeak(Date.UTC(2026, 7, 23, 8, 0, 0)), false) // Sun 08:00 UTC
  assert.equal(isPeak(Date.UTC(2026, 7, 23, 12, 0, 0)), false) // Sun 12:00 UTC
  // Weekdays after the effective date keep the hourly windows.
  assert.equal(isPeak(Date.UTC(2026, 7, 24, 2, 0, 0)), true) // Mon 02:00 UTC
  assert.equal(isPeak(Date.UTC(2026, 7, 24, 12, 0, 0)), false) // Mon 12:00 UTC
  // A later Saturday is also off-peak around the clock.
  assert.equal(isPeak(Date.UTC(2026, 7, 29, 2, 0, 0)), false) // Sat 02:00 UTC
})

test('off-peak factor halves the cost outside peak windows', () => {
  const entry = { inputPerM: 1, outputPerM: 2, offPeakFactor: 0.5 }
  const usage = { inputTokens: 1000, outputTokens: 0 }
  const peakMs = Date.UTC(2026, 7, 17, 2, 0, 0)
  const offMs = Date.UTC(2026, 7, 17, 12, 0, 0)
  assert.equal(costUsd(usage, entry, peakMs), 0.001)   // 1000/1e6 * 1
  assert.equal(costUsd(usage, entry, offMs), 0.0005)   // half during off-peak
  assert.equal(costUsd(usage, entry), 0.001)           // no timestamp -> base rate
})
