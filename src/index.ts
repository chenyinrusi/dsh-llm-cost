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
  parseRefreshedPricing,
} from './refresh.ts'

export const name = 'llm-cost'

const DEFAULT_PRICING_FILE = join(homedir(), '.dsh', 'llm-cost', 'pricing.override.json')

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
      const parsed = JSON.parse(text) as PricingRegistry
      Object.assign(refreshed, parsed.models)
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
    registerRefreshTool(toolCtx, holder, refreshed, pricingFile, config, rebuild)
  })
}

function registerRefreshTool(
  ctx: Context,
  holder: { registry: PricingRegistry },
  refreshed: Record<string, PricingEntry>,
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
      // Validate config before spending a search/LLM round-trip (the search can
      // succeed even when the extraction model is missing, wasting both).
      const provider = config.refreshProvider
      const model = config.refreshModel
      if (provider === undefined || model === undefined) {
        throw new Error(
          'llm-cost refresh needs refreshProvider + refreshModel in the plugin config '
          + '(the model that extracts prices from search results)',
        )
      }

      const all = Array.isArray(args.models) && args.models.length > 0
        ? (args.models as string[])
        : Object.keys(holder.registry.models)
      const models = all.slice(0, MAX_MODELS_PER_REFRESH)
      if (models.length === 0) return { updatedModels: [], count: 0 }

      const search = await ctx.web.search(
        { query: buildSearchQuery(models), maxResults: 10 },
        exec.signal,
      )
      const prompt = buildExtractPrompt(models, renderSearchContent(search))

      const outputText = await extractWithLlm(ctx, {
        provider,
        model,
        prompt,
        signal: exec.signal,
      })
      const parsed = parseRefreshedPricing(outputText)
      const updated = applyRefreshed(refreshed, parsed)
      rebuild()
      await persistRegistry(pricingFile, refreshed, holder.registry.version)
      return { updatedModels: updated, count: updated.length }
    },
  }))
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
): Promise<void> {
  await mkdir(dirname(pricingFile), { recursive: true })
  await writeFile(pricingFile, JSON.stringify({ version, models }, null, 2) + '\n', 'utf8')
}
