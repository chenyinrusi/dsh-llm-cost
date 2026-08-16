import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyRefreshed,
  buildSearchQuery,
  extractionRank,
  parseRefreshedPricing,
  sortExtractionCandidates,
} from '../src/refresh.ts'
import type { PricingEntry } from '../src/pricing.ts'

test('parseRefreshedPricing preserves offPeakFactor from the LLM answer', () => {
  const text = JSON.stringify({
    models: {
      'deepseek-v4-flash': {
        inputPerM: 0.44,
        outputPerM: 1.32,
        cacheReadPerM: 0.014,
        offPeakFactor: 0.5,
        effectiveDate: '2026-08-17',
      },
    },
  })
  const parsed = parseRefreshedPricing(text)
  const entry = parsed.models['deepseek-v4-flash']
  assert.ok(entry)
  assert.equal(entry.inputPerM, 0.44)
  assert.equal(entry.offPeakFactor, 0.5)
})

test('parseRefreshedPricing drops a malformed offPeakFactor but keeps the entry', () => {
  const text = JSON.stringify({
    models: { 'm': { inputPerM: 1, outputPerM: 2, offPeakFactor: 'half' } },
  })
  const parsed = parseRefreshedPricing(text)
  const entry = parsed.models.m
  assert.ok(entry)
  assert.equal(entry.offPeakFactor, undefined)
})

test('applyRefreshed mutates only the delta layer and reports updated ids', () => {
  const delta: Record<string, PricingEntry> = {
    'keep-me': { inputPerM: 1, outputPerM: 1 },
  }
  const updated = applyRefreshed(delta, parseRefreshedPricing(JSON.stringify({
    models: {
      'a': { inputPerM: 1, outputPerM: 2 },
      'b': { inputPerM: 3, outputPerM: 4, offPeakFactor: 0.5 },
    },
  })))
  assert.deepEqual(updated, ['a', 'b'])
  assert.equal(delta['keep-me'].inputPerM, 1, 'existing delta entries are preserved')
  assert.equal(delta.a.inputPerM, 1)
  assert.equal(delta.b.offPeakFactor, 0.5)
})

test('buildSearchQuery joins every model it is given (no internal 12-model cap)', () => {
  const models = Array.from({ length: 20 }, (_, i) => `model-${i}`)
  const query = buildSearchQuery(models)
  assert.ok(query.includes('model-19'), 'the last model must be present')
  assert.ok(query.includes('model-0'))
})

test('extraction candidates sort cheapest-first: free, priced ascending, unknown last', () => {
  const registry = {
    version: 1,
    models: {
      expensive: { inputPerM: 10, outputPerM: 20 },
      cheap: { inputPerM: 0.1, outputPerM: 0.2 },
    },
  }
  const sorted = sortExtractionCandidates(registry, [
    { provider: 'openai', model: 'mystery', label: 'openai/mystery' },
    { provider: 'deepseek', model: 'expensive', label: 'deepseek/expensive' },
    { provider: 'ollama', model: 'llama3', label: 'ollama/llama3' },
    { provider: 'deepseek', model: 'cheap', label: 'deepseek/cheap' },
  ])
  assert.deepEqual(sorted.map((c) => c.label), [
    'ollama/llama3', // free
    'deepseek/cheap', // 0.3
    'deepseek/expensive', // 30
    'openai/mystery', // unknown
  ])
})

test('extractionRank: free = 0, priced = input+output, unknown = MAX_SAFE_INTEGER', () => {
  const registry = { version: 1, models: { m: { inputPerM: 2, outputPerM: 3 } } }
  assert.equal(extractionRank(registry, 'ollama', 'anything'), 0)
  assert.equal(extractionRank(registry, 'x', 'm'), 5)
  assert.equal(extractionRank(registry, 'x', 'nope'), Number.MAX_SAFE_INTEGER)
})
