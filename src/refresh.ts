/**
 * Pure helpers for the price auto-maintenance tool: search-query and
 * extraction-prompt construction, plus lenient parsing/validation of the LLM's
 * JSON answer. The LLM output is untrusted, so parsing is lenient and field
 * validation is manual (a bad model must not poison the registry).
 */

import type { PricingEntry } from './pricing.ts'

export interface RefreshedEntry {
  provider?: string
  inputPerM: number
  outputPerM: number
  cacheReadPerM?: number
  cacheWritePerM?: number
  cacheWrite1hPerM?: number
  offPeakFactor?: number
  effectiveDate?: string
  notes?: string
}

/** Max models priced in one refresh call — bounds the search query while still covering every model in the built-in snapshot. */
export const MAX_MODELS_PER_REFRESH = 24

/** Build one search query over the target models (already capped by the caller). */
export function buildSearchQuery(models: readonly string[]): string {
  const targets = models.join('" OR "')
  return `current API price per million tokens 2026: "${targets}" input output cache`
}

/**
 * Build the extraction prompt handed to the LLM. It is asked to answer with a
 * single strict JSON object using ONLY the search content it was given, and to
 * omit fields it cannot source.
 */
export function buildExtractPrompt(
  models: readonly string[],
  searchContent: string,
): string {
  const wanted = models.map((m) => `  - "${m}"`).join('\n')
  return [
    'You are extracting LLM API pricing from web search results.',
    'Produce ONE JSON object. Shape:',
    '{ "models": { "<model-id>": { "inputPerM": number, "outputPerM": number,',
    '  "cacheReadPerM": number, "cacheWritePerM": number, "cacheWrite1hPerM": number,',
    '  "effectiveDate": "YYYY-MM-DD", "notes": "string" } } }',
    '',
    'Rules:',
    '- All prices are USD per 1,000,000 tokens.',
    '- "inputPerM" and "outputPerM" are required; every other field is optional and must be OMITTED when unknown.',
    '- Only report a model when the search results below actually state its price.',
    '- Do not invent numbers; do not guess. If a price is missing, omit that model.',
    '- Output raw JSON only, no markdown fences, no commentary.',
    '',
    'Models to price:',
    wanted,
    '',
    'Search results:',
    searchContent,
  ].join('\n')
}

/** Strip code fences and locate the outermost JSON object in free text. */
function extractJsonObject(text: string): string | null {
  const withoutFences = text.replace(/```(?:json)?/gi, '').trim()
  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return withoutFences.slice(start, end + 1)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }
  return null
}

function normalizeEntry(raw: unknown): RefreshedEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const inputPerM = toNumber(record.inputPerM)
  const outputPerM = toNumber(record.outputPerM)
  if (inputPerM === null || outputPerM === null) return null
  const entry: RefreshedEntry = { inputPerM, outputPerM }
  const cacheReadPerM = toNumber(record.cacheReadPerM)
  const cacheWritePerM = toNumber(record.cacheWritePerM)
  const cacheWrite1hPerM = toNumber(record.cacheWrite1hPerM)
  const offPeakFactor = toNumber(record.offPeakFactor)
  if (cacheReadPerM !== null) entry.cacheReadPerM = cacheReadPerM
  if (cacheWritePerM !== null) entry.cacheWritePerM = cacheWritePerM
  if (cacheWrite1hPerM !== null) entry.cacheWrite1hPerM = cacheWrite1hPerM
  if (offPeakFactor !== null) entry.offPeakFactor = offPeakFactor
  if (typeof record.effectiveDate === 'string') entry.effectiveDate = record.effectiveDate
  if (typeof record.notes === 'string') entry.notes = record.notes
  return entry
}

export interface RefreshedPricing {
  models: Record<string, RefreshedEntry>
  /** Raw rejected entries are dropped silently — a bad model never poisons the registry. */
}

/** Parse + leniently validate the LLM's JSON answer. Never throws. */
export function parseRefreshedPricing(text: string): RefreshedPricing {
  const models: Record<string, RefreshedEntry> = {}
  const json = extractJsonObject(text)
  if (json === null) return { models }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { models }
  }
  if (typeof parsed !== 'object' || parsed === null) return { models }
  const root = parsed as Record<string, unknown>
  const rawModels = root.models
  if (typeof rawModels !== 'object' || rawModels === null) return { models }
  for (const [model, rawEntry] of Object.entries(rawModels as Record<string, unknown>)) {
    const entry = normalizeEntry(rawEntry)
    if (entry !== null) models[model] = entry
  }
  return { models }
}

/**
 * Merge refreshed entries into a model map (the refresh-delta layer), returning
 * the updated model ids. Mutates the given map in place; callers are expected to
 * hand it the delta layer — NOT the final merged registry — so a refresh never
 * clobbers the user's `config.pricing` overrides (which sit above the deltas).
 */
export function applyRefreshed(
  models: Record<string, PricingEntry>,
  refreshed: RefreshedPricing,
): string[] {
  const updated: string[] = []
  for (const [model, entry] of Object.entries(refreshed.models)) {
    models[model] = entry
    updated.push(model)
  }
  return updated
}
