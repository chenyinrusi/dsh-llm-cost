/**
 * Host plugin for dsh-llm-cost: registers the `costUsage` session projection
 * (per-step/per-turn dollar cost) and, when the tools/llm/web capabilities are
 * present, a model-facing `llm_cost_refresh` tool that looks up current prices
 * on the web and updates the pricing table.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'
import type { PricingEntry, PricingRegistry } from './pricing.ts'
import type { LlmCostConfig } from './config.ts'
export { Config } from './config.ts'
import { mergeRegistries } from './pricing.ts'
import { DEFAULT_PRICING } from './pricing-data.ts'
import type {} from './projection.ts'
import { createCostProjection } from './cost-projection.ts'
import {
  applyRefreshed,
  buildExtractPrompt,
  buildSearchQuery,
  MAX_MODELS_PER_REFRESH,
  orderExtractionCandidates,
  parseRefreshedPricing,
} from './refresh.ts'
import type { ExtractionCandidate } from './refresh.ts'

export const name = 'llm-cost'

const DEFAULT_PRICING_FILE = join(homedir(), '.dsh', 'llm-cost', 'pricing.override.json')

/** On-disk shape of the override file: refresh deltas plus the last extraction route. */
interface PersistedOverride {
  version: number
  models: Record<string, PricingEntry>
  lastExtraction?: { provider: string; model: string }
}

/**
 * Assemble the effective registry from three layers, lowest priority first:
 * built-in snapshot < refresh deltas (persisted file + runtime refreshes) <
 * `config.pricing` (explicit user intent, always wins).
 */
function buildRegistry(
  userPricing: PricingRegistry | undefined,
  refreshed: Record<string, PricingEntry>,
): PricingRegistry {
  return mergeRegistries(
    mergeRegistries(DEFAULT_PRICING, { version: DEFAULT_PRICING.version, models: refreshed }),
    userPricing,
  )
}

export function apply(ctx: Context, config: LlmCostConfig = {}): void {
  // The refresh-delta layer holds ONLY models the auto-maintenance tool has
  // actually refreshed, so persisting it never pins the whole snapshot (which
  // is what let stale prices shadow future snapshot updates). config.pricing
  // sits above it, so a refresh can never overwrite a user override.
  const refreshed: Record<string, PricingEntry> = {}
  // Remembers the model that last extracted prices successfully, so the next
  // refresh tries it first (before the cheapest-first auto chain).
  const meta: { lastExtraction?: { provider: string; model: string } } = {}
  const holder: { registry: PricingRegistry } = {
    registry: buildRegistry(config.pricing, refreshed),
  }
  const rebuild = (): void => {
    holder.registry = buildRegistry(config.pricing, refreshed)
  }
  const pricingFile = config.pricingFile ?? DEFAULT_PRICING_FILE

  // Load persisted refresh deltas (written by the refresh tool) if present. A
  // missing file is normal (first boot); a corrupt one is non-fatal but surfaced.
  void readFile(pricingFile, 'utf8')
    .then((text) => {
      const parsed = JSON.parse(text) as PersistedOverride
      Object.assign(refreshed, parsed.models)
      if (parsed.lastExtraction !== undefined) meta.lastExtraction = parsed.lastExtraction
      rebuild()
    })
    .catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[dsh-llm-cost] ignoring unreadable pricing override ${pricingFile}:`, err)
      }
    })

  // Core capability: durable per-step cost projection (optional in headless
  // assemblies without the session-projection registry).
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(createCostProjection(() => holder.registry))
  })

  // Optional capability: the auto-maintenance tool, only where tools + an LLM
  // + a web provider are all mounted.
  ctx.inject(['tools', 'llm', 'web'], (toolCtx) => {
    registerRefreshTool(toolCtx, holder, refreshed, meta, pricingFile, config, rebuild)
  })
}

function registerRefreshTool(
  ctx: Context,
  holder: { registry: PricingRegistry },
  refreshed: Record<string, PricingEntry>,
  meta: { lastExtraction?: { provider: string; model: string } },
  pricingFile: string,
  config: LlmCostConfig,
  rebuild: () => void,
): void {
  ctx.tools.register(defineTool({
    name: 'llm_cost_refresh',
    description:
      'Look up current LLM API prices (USD per 1M tokens) from the web and update '
      + "the cost ledger's pricing table. Call this when prices may be stale.",
    parameters: {
      models: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional model ids to refresh; empty refreshes every known model.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          updatedModels: { type: 'array', items: { type: 'string' }, required: true },
          count: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Updated ${String(value.count)} model price(s): `
          + `${(value.updatedModels as string[]).join(', ') || '(none)'}`,
      }],
    },
    async execute(args, exec) {
      const all = Array.isArray(args.models) && args.models.length > 0
        ? (args.models as string[])
        : Object.keys(holder.registry.models)
      const models = all.slice(0, MAX_MODELS_PER_REFRESH)
      if (models.length === 0) return { updatedModels: [], count: 0 }

      // Resolve the extraction chain BEFORE spending a search round-trip: there
      // is no point searching when nothing can turn the results into a table.
      const candidates = await resolveExtractionCandidates(ctx, holder, config, meta.lastExtraction)
      if (candidates.length === 0) {
        throw new Error(
          'llm-cost refresh: no LLM model is available to extract prices '
          + '(register an LLM adapter, or set refreshProvider/refreshModel)',
        )
      }

      const search = await ctx.web.search(
        { query: buildSearchQuery(models), maxResults: 10 },
        exec.signal,
      )
      const prompt = buildExtractPrompt(models, renderSearchContent(search))

      const result = await extractWithFallback(ctx, candidates, prompt, exec.signal)
      if (result === null) {
        throw new Error('llm-cost refresh: every available model failed to extract prices')
      }

      meta.lastExtraction = { provider: result.provider, model: result.model }
      const parsed = parseRefreshedPricing(result.outputText)
      const updated = applyRefreshed(refreshed, parsed)
      rebuild()
      await persistRegistry(pricingFile, refreshed, holder.registry.version, meta.lastExtraction)
      console.info(`[dsh-llm-cost] refreshed ${updated.length} price(s) via ${result.label}`)
      return { updatedModels: updated, count: updated.length }
    },
  }))
}

/**
 * Build the ordered extraction-candidate chain: the explicit
 * `refreshProvider`/`refreshModel` first (user intent), then the model that
 * last succeeded (memory), then every model the harness can currently reach,
 * cheapest first (unknown-priced models last). A provider whose catalog query
 * fails simply contributes no candidates.
 */
async function resolveExtractionCandidates(
  ctx: Context,
  holder: { registry: PricingRegistry },
  config: LlmCostConfig,
  lastExtraction?: { provider: string; model: string },
): Promise<ExtractionCandidate[]> {
  const prefer: { provider: string; model: string }[] = []
  if (config.refreshProvider !== undefined && config.refreshModel !== undefined) {
    prefer.push({ provider: config.refreshProvider, model: config.refreshModel })
  }
  if (lastExtraction !== undefined) prefer.push(lastExtraction)

  const discovered: ExtractionCandidate[] = []
  for (const provider of ctx.llm.listProviders()) {
    let models
    try {
      models = await ctx.llm.listModels(provider.id)
    } catch {
      continue
    }
    for (const model of models) {
      discovered.push({ provider: provider.id, model: model.id, label: `${provider.id}/${model.id}` })
    }
  }
  return orderExtractionCandidates(holder.registry, discovered, prefer)
}

/**
 * Run the extraction prompt through the candidate chain, cheapest first. The
 * first candidate whose stream completes successfully wins; failures advance to
 * the next candidate. Returns null when every candidate fails or the caller's
 * signal aborts.
 */
async function extractWithFallback(
  ctx: Context,
  candidates: readonly ExtractionCandidate[],
  prompt: string,
  signal?: AbortSignal,
): Promise<{ outputText: string; provider: string; model: string; label: string } | null> {
  for (const candidate of candidates) {
    if (signal?.aborted) return null
    try {
      const outputText = await extractWithLlm(ctx, {
        provider: candidate.provider,
        model: candidate.model,
        prompt,
        signal,
      })
      return { outputText, ...candidate }
    } catch (error) {
      if (signal?.aborted) return null
      console.warn(`[dsh-llm-cost] refresh extraction failed on ${candidate.label}:`, error)
    }
  }
  return null
}

function renderSearchContent(search: WebSearchResult): string {
  const lines: string[] = []
  if (search.content !== undefined && search.content !== '') lines.push(search.content)
  for (const source of search.sources) {
    lines.push(`- ${source.title ?? source.url}\n  ${source.url}`)
    if (source.snippet !== undefined && source.snippet !== '') lines.push(`  ${source.snippet}`)
  }
  return lines.join('\n') || '(no search results)'
}

async function extractWithLlm(
  ctx: Context,
  opts: { provider: string; model: string; prompt: string; signal?: AbortSignal },
): Promise<string> {
  const assembler = new BlockAssembler()
  const stream = ctx.llm.stream({
    provider: opts.provider,
    model: opts.model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: opts.prompt }],
      source: { kind: 'user' },
    })],
    maxTokens: 4000,
    signal: opts.signal,
  })
  for await (const chunk of stream) {
    if (chunk.type === 'finish') {
      if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
        throw new Error(`llm-cost refresh extraction failed: ${chunk.reason.failure.message}`)
      }
      continue
    }
    assembler.push(chunk)
  }
  return assembler.blocks()
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** Persist ONLY the refresh-delta layer (not the whole merged registry). */
async function persistRegistry(
  pricingFile: string,
  models: Record<string, PricingEntry>,
  version: number,
  lastExtraction?: { provider: string; model: string },
): Promise<void> {
  await mkdir(dirname(pricingFile), { recursive: true })
  const payload: PersistedOverride = lastExtraction === undefined
    ? { version, models }
    : { version, models, lastExtraction }
  await writeFile(pricingFile, JSON.stringify(payload, null, 2) + '\n', 'utf8')
}
