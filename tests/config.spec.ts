import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../src/config.ts'

/** Synchronous parse via `safeParse`: `{ ok, data }` on success, `{ ok: false }` on failure. */
function parse(input: unknown): { ok: true; data: unknown } | { ok: false } {
  const out = Config.safeParse(input)
  if (!out.success) return { ok: false }
  return { ok: true, data: out.data }
}

test('omitted config (undefined) defaults to an empty object', () => {
  const out = parse(undefined)
  assert.ok(out.ok)
  assert.deepEqual(out.data, {})
})

test('empty config object passes with every field defaulted', () => {
  const out = parse({})
  assert.ok(out.ok)
  assert.deepEqual(out.data, {})
})

test('null config fails loudly (the empty `config:` key YAML produces)', () => {
  assert.equal(parse(null).ok, false)
})

test('a partial config keeps the provided field', () => {
  const out = parse({ refreshModel: 'deepseek-v4-flash' })
  assert.ok(out.ok)
  assert.equal((out.data as { refreshModel?: string }).refreshModel, 'deepseek-v4-flash')
})

test('pricing override accepts a full registry', () => {
  const out = parse({
    pricing: {
      version: 1,
      models: { 'deepseek-v4-flash': { inputPerM: 1, outputPerM: 2 } },
    },
  })
  assert.ok(out.ok)
  const pricing = (out.data as { pricing: { models: Record<string, { inputPerM: number }> } }).pricing
  assert.equal(pricing.models['deepseek-v4-flash'].inputPerM, 1)
})

test('pricing registry rejects a non-number version', () => {
  assert.equal(parse({ pricing: { version: '1', models: {} } }).ok, false)
})

test('pricing entry requires inputPerM and outputPerM', () => {
  assert.equal(parse({ pricing: { version: 1, models: { m: { inputPerM: 1 } } } }).ok, false)
})

test('unknown config keys are stripped', () => {
  const out = parse({ bogusKey: true, refreshModel: 'm' })
  assert.ok(out.ok)
  assert.ok(!('bogusKey' in (out.data as object)))
  assert.equal((out.data as { refreshModel?: string }).refreshModel, 'm')
})
