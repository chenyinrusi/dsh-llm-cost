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
import type { PricingRegistry } from './pricing.ts'
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
  parseRefreshedPricing,
} from './refresh.ts'

export const name = 'llm-cost'

const DEFAULT_PRICING_FILE = join(homedir(), '.dsh', 'llm-cost', 'pricing.override.json')

export function apply(ctx: Context, config: LlmCostConfig = {}): void {
  const holder: { registry: PricingRegistry } = {
    registry: mergeRegistries(DEFAULT_PRICING, config.pricing),
  }
  const pricingFile = config.pricingFile ?? DEFAULT_PRICING_FILE

  // Load a persisted override (written by the refresh tool) if present. A
  // missing or malformed file is not fatal — the built-in snapshot stands.
  void readFile(pricingFile, 'utf8')
    .then((text) => {
      const parsed = JSON.parse(text) as PricingRegistry
      holder.registry = mergeRegistries(holder.registry, parsed)
    })
    .catch(() => {})

  // Core capability: durable per-step cost projection (optional in headless
  // assemblies without the session-projection registry).
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(createCostProjection(() => holder.registry))
  })

  // Optional capability: the auto-maintenance tool, only where tools + an LLM
  // + a web provider are all mounted.
  ctx.inject(['tools', 'llm', 'web'], (toolCtx) => {
    registerRefreshTool(toolCtx, holder, pricingFile, config)
  })
}

function registerRefreshTool(
  ctx: Context,
  holder: { registry: PricingRegistry },
  pricingFile: string,
  config: LlmCostConfig,
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
      const models = Array.isArray(args.models) && args.models.length > 0
        ? (args.models as string[])
        : Object.keys(holder.registry.models)
      if (models.length === 0) return { updatedModels: [], count: 0 }

      const search = await ctx.web.search(
        { query: buildSearchQuery(models), maxResults: 10 },
        exec.signal,
      )
      const prompt = buildExtractPrompt(models, renderSearchContent(search))

      const provider = config.refreshProvider
      const model = config.refreshModel
      if (provider === undefined || model === undefined) {
        throw new Error(
          'llm-cost refresh needs refreshProvider + refreshModel in the plugin config '
          + '(the model that extracts prices from search results)',
        )
      }

      const outputText = await extractWithLlm(ctx, {
        provider,
        model,
        prompt,
        signal: exec.signal,
      })
      const refreshed = parseRefreshedPricing(outputText)
      const updated = applyRefreshed(holder.registry, refreshed)
      await persistRegistry(pricingFile, holder.registry)
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

async function persistRegistry(pricingFile: string, registry: PricingRegistry): Promise<void> {
  await mkdir(dirname(pricingFile), { recursive: true })
  await writeFile(pricingFile, JSON.stringify(registry, null, 2) + '\n', 'utf8')
}
