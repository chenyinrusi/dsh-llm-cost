import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import { z } from "zod";
//#region src/config.ts
/**
* Plugin config for dsh-llm-cost — the single home for both the `LlmCostConfig`
* type and its zod `Config` schema. Kept free of Cordis/dsh imports so the
* schema is unit-testable without the DSH toolchain (see `tests/config.spec.ts`).
*/
const PricingEntrySchema = z.object({
	provider: z.string().optional(),
	inputPerM: z.number(),
	outputPerM: z.number(),
	cacheReadPerM: z.number().optional(),
	cacheWritePerM: z.number().optional(),
	cacheWrite1hPerM: z.number().optional(),
	batchInputPerM: z.number().optional(),
	batchOutputPerM: z.number().optional(),
	contextCacheStoragePerMPerHr: z.number().optional(),
	offPeakFactor: z.number().optional(),
	effectiveDate: z.string().optional(),
	notes: z.string().optional()
});
const PricingRegistrySchema = z.object({
	version: z.number(),
	generatedAt: z.string().optional(),
	source: z.string().optional(),
	models: z.record(z.string(), PricingEntrySchema)
});
/**
* Cordis validates the loader row's config against this before `apply`.
* An omitted `config` key (undefined) becomes `{}`; a present-but-empty
* `config:` key parses as YAML `null` and fails validation loudly with the
* entry name. Unknown keys are stripped (zod's default object behavior).
* Field-for-field aligned with {@link LlmCostConfig}; `config.spec.ts` pins
* the accept/reject semantics.
*/
const Config = z.object({
	pricing: PricingRegistrySchema.optional(),
	pricingFile: z.string().optional(),
	refreshProvider: z.string().optional(),
	refreshModel: z.string().optional()
}).default({});
//#endregion
//#region src/pricing.ts
/**
* Resolve one provider/model pair against the registry.
* @param registry - pricing table.
* @param model - provider-owned model id.
* @param provider - registered provider route (may be empty).
*/
function resolvePricing(registry, model, provider = "") {
	if (provider === "ollama") return {
		status: "free",
		matchedModel: null,
		match: "ollama"
	};
	const exact = registry.models[model];
	if (exact !== void 0) return {
		status: "priced",
		entry: exact,
		matchedModel: model,
		match: "exact"
	};
	let best;
	for (const key of Object.keys(registry.models)) if (model.includes(key) && (best === void 0 || key.length > best.key.length)) {
		const entry = registry.models[key];
		if (entry !== void 0) best = {
			key,
			entry
		};
	}
	if (best !== void 0) return {
		status: "priced",
		entry: best.entry,
		matchedModel: best.key,
		match: "substring"
	};
	return {
		status: "unknown",
		matchedModel: null,
		match: "none"
	};
}
/** Peak billing windows in UTC hours: 01:00–04:00 and 06:00–10:00 (all else off-peak). */
const PEAK_WINDOWS = [[1, 4], [6, 10]];
/** Whether a Unix-epoch-ms timestamp falls in a DeepSeek peak billing window. */
function isPeak(ms) {
	const d = new Date(ms);
	const hour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
	return PEAK_WINDOWS.some(([start, end]) => hour >= start && hour < end);
}
/** Multiplier for one entry at one timestamp: 1 during peak, `offPeakFactor` otherwise. */
function priceFactor(entry, atMs) {
	if (entry.offPeakFactor === void 0) return 1;
	return isPeak(atMs) ? 1 : entry.offPeakFactor;
}
/**
* Dollar cost of one usage record under one pricing entry.
*
* inputTokens is uncached input only (DeepSeek's adapter already subtracts
* cache hits out of prompt_tokens). reasoning is already inside outputTokens,
* so it is not added again. batch/storage dimensions are deliberately omitted
* from the display figure (v1). When `atMs` is given and the entry declares
* `offPeakFactor`, the total is scaled by the factor outside peak windows.
*/
function costUsd(usage, entry, atMs) {
	const perM = (tokens, price) => tokens > 0 && price !== void 0 && price > 0 ? tokens / 1e6 * price : 0;
	const base = perM(usage.inputTokens, entry.inputPerM) + perM(usage.cacheReadTokens ?? 0, entry.cacheReadPerM) + perM(usage.cacheWriteTokens ?? 0, entry.cacheWritePerM) + perM(usage.outputTokens, entry.outputPerM);
	return atMs === void 0 ? base : base * priceFactor(entry, atMs);
}
/**
* Combined resolve + cost. `costUsd` is `null` when the model is unpriced
* (unknown) — callers render "unknown" rather than a misleading $0.
*/
function resolveAndCost(registry, model, provider, usage, atMs) {
	const resolution = resolvePricing(registry, model, provider);
	if (resolution.status === "unknown") return {
		costUsd: null,
		resolution
	};
	if (resolution.status === "free") return {
		costUsd: 0,
		resolution
	};
	return {
		costUsd: costUsd(usage, resolution.entry, atMs),
		resolution
	};
}
/** Merge an optional override over a base registry (shallow, per-model). */
function mergeRegistries(base, override) {
	if (override === void 0 || override === null) return base;
	return {
		version: base.version,
		...base.generatedAt === void 0 ? {} : { generatedAt: base.generatedAt },
		...base.source === void 0 ? {} : { source: base.source },
		models: {
			...base.models,
			...override.models
		}
	};
}
//#endregion
//#region src/pricing-data.ts
const DEFAULT_PRICING = {
	"version": 1,
	"generatedAt": "2026-08-16T20:35:08.163Z",
	"source": "llm_models.toml [pricing_v2]",
	"models": {
		"claude-fable-5": {
			"provider": "anthropic",
			"inputPerM": 10,
			"outputPerM": 50,
			"cacheReadPerM": 1,
			"cacheWritePerM": 12.5,
			"cacheWrite1hPerM": 20,
			"batchInputPerM": 5,
			"batchOutputPerM": 25,
			"effectiveDate": "2026-08-03",
			"notes": "Claude Fable 5; 项目暂未注册 Anthropic provider"
		},
		"claude-haiku-4-5-20251001": {
			"provider": "anthropic",
			"inputPerM": 1,
			"outputPerM": 5,
			"cacheReadPerM": .1,
			"cacheWritePerM": 1.25,
			"cacheWrite1hPerM": 2,
			"batchInputPerM": .5,
			"batchOutputPerM": 2.5,
			"effectiveDate": "2026-08-03"
		},
		"claude-opus-5": {
			"provider": "anthropic",
			"inputPerM": 5,
			"outputPerM": 25,
			"cacheReadPerM": .5,
			"cacheWritePerM": 6.25,
			"cacheWrite1hPerM": 10,
			"batchInputPerM": 2.5,
			"batchOutputPerM": 12.5,
			"effectiveDate": "2026-08-03"
		},
		"claude-sonnet-5": {
			"provider": "anthropic",
			"inputPerM": 2,
			"outputPerM": 10,
			"cacheReadPerM": .2,
			"cacheWritePerM": 2.5,
			"cacheWrite1hPerM": 4,
			"batchInputPerM": 1,
			"batchOutputPerM": 5,
			"effectiveDate": "2026-08-03",
			"notes": "Introductory pricing $2/$10; 2026-09-01 后涨至 $3/$15"
		},
		"claude-sonnet-5-standard": {
			"provider": "anthropic",
			"inputPerM": 3,
			"outputPerM": 15,
			"cacheReadPerM": .3,
			"cacheWritePerM": 3.75,
			"cacheWrite1hPerM": 6,
			"batchInputPerM": 1.5,
			"batchOutputPerM": 7.5,
			"effectiveDate": "2026-09-01",
			"notes": "Sonnet 5 标准价（2026-09-01 生效）"
		},
		"deepseek-v4-flash": {
			"provider": "deepseek",
			"inputPerM": .44,
			"outputPerM": 1.32,
			"cacheReadPerM": .014,
			"offPeakFactor": .5,
			"effectiveDate": "2026-08-17",
			"notes": "Peak 01:00-04:00 & 06:00-10:00 UTC; off-peak = half. cache miss=input"
		},
		"deepseek-v4-pro": {
			"provider": "deepseek",
			"inputPerM": 1.32,
			"outputPerM": 3.96,
			"cacheReadPerM": .044,
			"offPeakFactor": .5,
			"effectiveDate": "2026-08-17",
			"notes": "Peak 01:00-04:00 & 06:00-10:00 UTC; off-peak = half. cache miss=input"
		},
		"gemini-3-flash-preview": {
			"provider": "gemini",
			"inputPerM": .75,
			"outputPerM": 4.5,
			"cacheReadPerM": .075,
			"contextCacheStoragePerMPerHr": 1,
			"batchInputPerM": .375,
			"batchOutputPerM": 2.25,
			"effectiveDate": "2026-08-03",
			"notes": "旧模型; cache_read 为推算值"
		},
		"gemini-3.1-flash-lite": {
			"provider": "gemini",
			"inputPerM": .25,
			"outputPerM": 1.5,
			"cacheReadPerM": .025,
			"contextCacheStoragePerMPerHr": 1,
			"batchInputPerM": .125,
			"batchOutputPerM": .75,
			"effectiveDate": "2026-08-03"
		},
		"gemini-3.1-pro-preview": {
			"provider": "gemini",
			"inputPerM": 2.7,
			"outputPerM": 16.2,
			"cacheReadPerM": .27,
			"contextCacheStoragePerMPerHr": 1,
			"batchInputPerM": 1.35,
			"batchOutputPerM": 8.1,
			"effectiveDate": "2026-08-03",
			"notes": "pricing 来自官方 Priority tier; cache_read 为推算值 (10% of input)"
		},
		"gemini-3.5-flash": {
			"provider": "gemini",
			"inputPerM": 1.5,
			"outputPerM": 9,
			"cacheReadPerM": .15,
			"contextCacheStoragePerMPerHr": 1,
			"batchInputPerM": .75,
			"batchOutputPerM": 4.5,
			"effectiveDate": "2026-08-03"
		},
		"gemini-3.5-flash-lite": {
			"provider": "gemini",
			"inputPerM": .3,
			"outputPerM": 2.5,
			"cacheReadPerM": .03,
			"contextCacheStoragePerMPerHr": 1,
			"batchInputPerM": .15,
			"batchOutputPerM": 1.25,
			"effectiveDate": "2026-08-03"
		},
		"gemini-3.6-flash": {
			"provider": "gemini",
			"inputPerM": 1.5,
			"outputPerM": 7.5,
			"cacheReadPerM": .15,
			"contextCacheStoragePerMPerHr": 1,
			"batchInputPerM": .75,
			"batchOutputPerM": 3.75,
			"effectiveDate": "2026-08-03",
			"notes": "gemini-3.6-flash; context cache storage $1/M/hr"
		},
		"gpt-5.4": {
			"provider": "openai",
			"inputPerM": 2.5,
			"outputPerM": 15,
			"cacheReadPerM": .25,
			"batchInputPerM": 1.25,
			"batchOutputPerM": 7.5,
			"effectiveDate": "2026-08-03",
			"notes": "GPT-5.6 Terra (旧名); Automatic Prompt Caching"
		},
		"gpt-5.4-mini": {
			"provider": "openai",
			"inputPerM": 1,
			"outputPerM": 6,
			"cacheReadPerM": .1,
			"batchInputPerM": .5,
			"batchOutputPerM": 3,
			"effectiveDate": "2026-08-03",
			"notes": "GPT-5.6 Luna (旧名); llm_models.toml [pricing] 中价格有误"
		},
		"gpt-5.5": {
			"provider": "openai",
			"inputPerM": 5,
			"outputPerM": 30,
			"cacheReadPerM": .5,
			"batchInputPerM": 2.5,
			"batchOutputPerM": 15,
			"effectiveDate": "2026-08-03",
			"notes": "GPT-5.6 Sol (旧名); Automatic Prompt Caching"
		},
		"gpt-5.6-luna": {
			"provider": "openai",
			"inputPerM": 1,
			"outputPerM": 6,
			"cacheReadPerM": .1,
			"batchInputPerM": .5,
			"batchOutputPerM": 3,
			"effectiveDate": "2026-08-03",
			"notes": "GPT-5.6 Luna; 旧名: gpt-5.4-mini"
		},
		"gpt-5.6-sol": {
			"provider": "openai",
			"inputPerM": 5,
			"outputPerM": 30,
			"cacheReadPerM": .5,
			"batchInputPerM": 2.5,
			"batchOutputPerM": 15,
			"effectiveDate": "2026-08-03",
			"notes": "GPT-5.6 Sol; 旧名: gpt-5.5"
		},
		"gpt-5.6-terra": {
			"provider": "openai",
			"inputPerM": 2.5,
			"outputPerM": 15,
			"cacheReadPerM": .25,
			"batchInputPerM": 1.25,
			"batchOutputPerM": 7.5,
			"effectiveDate": "2026-08-03",
			"notes": "GPT-5.6 Terra; 旧名: gpt-5.4"
		}
	}
};
//#endregion
//#region src/fold.ts
function usageOf(event) {
	if (event.type === "assistant/message") {
		const data = event.data;
		const usage = data.usage;
		if (usage === void 0) return void 0;
		return {
			turn: data.turn,
			step: data.step,
			usage
		};
	}
	if (event.type === "assistant/chunk") {
		const data = event.data;
		const chunk = data.chunk;
		if (chunk !== void 0 && chunk.type === "usage" && chunk.usage !== void 0) return {
			turn: data.turn,
			step: data.step,
			usage: chunk.usage
		};
	}
}
function initCostState() {
	return {
		route: null,
		totalCostUsd: 0,
		pricedSteps: 0,
		unpricedSteps: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		byModel: [],
		steps: [],
		lastStep: null
	};
}
/**
* Incremental per-model aggregation helpers. They mirror `recomputeTotals`
* exactly but mutate a copy of the current aggregation, so `applyCostEvent`
* stays O(distinct models) instead of rescanning the whole step ledger on every
* usage event (O(n²) over a session).
*/
function modelKey(record) {
	return record.model ?? "unknown";
}
function addStepToAgg(byModel, record) {
	const key = modelKey(record);
	const idx = byModel.findIndex((agg) => agg.model === key);
	const next = byModel.slice();
	if (idx === -1) {
		next.push({
			model: key,
			provider: record.provider,
			calls: 1,
			costUsd: record.costUsd ?? 0,
			inputTokens: record.inputTokens,
			outputTokens: record.outputTokens
		});
		return next.sort((a, b) => b.costUsd - a.costUsd);
	}
	const agg = { ...next[idx] };
	agg.calls += 1;
	agg.costUsd += record.costUsd ?? 0;
	agg.inputTokens += record.inputTokens;
	agg.outputTokens += record.outputTokens;
	next[idx] = agg;
	return next.sort((a, b) => b.costUsd - a.costUsd);
}
function removeStepFromAgg(byModel, record) {
	const idx = byModel.findIndex((agg) => agg.model === modelKey(record));
	if (idx === -1) return byModel;
	const next = byModel.slice();
	const agg = { ...next[idx] };
	agg.calls -= 1;
	agg.costUsd -= record.costUsd ?? 0;
	agg.inputTokens -= record.inputTokens;
	agg.outputTokens -= record.outputTokens;
	if (agg.calls <= 0) {
		next.splice(idx, 1);
		return next;
	}
	next[idx] = agg;
	return next.sort((a, b) => b.costUsd - a.costUsd);
}
/**
* Fold one event into the cost state.
*
* `request/context` is the authoritative resolved route (post-fallback);
* `request/header` only backfills the first request when no context has been
* seen yet. Usage for one turn/step is adjacent in the log, so a repeated
* sample (usage chunk then the final assistant/message) REPLACES the previous
* record rather than double-counting (mirrors the token-meter fold).
*/
function applyCostEvent(state, event, registry) {
	let route = state.route;
	if (event.type === "request/context") {
		const data = event.data;
		route = {
			provider: data.provider,
			model: data.model
		};
	} else if (event.type === "request/header" && route === null) {
		const header = event.data.header;
		if (header?.config?.provider !== void 0 && header.config.model !== void 0) route = {
			provider: header.config.provider,
			model: header.config.model
		};
	}
	const sample = usageOf(event);
	if (sample === void 0) return route === state.route ? state : {
		...state,
		route
	};
	const { turn, step, usage } = sample;
	const model = route?.model ?? null;
	const provider = route?.provider ?? null;
	const { costUsd } = resolveAndCost(registry, model ?? "", provider ?? "", usage, event.time);
	const record = {
		turn,
		step,
		model,
		provider,
		costUsd,
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cacheReadTokens: usage.cacheReadTokens ?? 0,
		cacheWriteTokens: usage.cacheWriteTokens ?? 0
	};
	const last = state.lastStep;
	const replacing = last !== null && last.turn === turn && last.step === step;
	let totalCostUsd = state.totalCostUsd;
	let pricedSteps = state.pricedSteps;
	let unpricedSteps = state.unpricedSteps;
	let inputTokens = state.inputTokens;
	let outputTokens = state.outputTokens;
	let cacheReadTokens = state.cacheReadTokens;
	let cacheWriteTokens = state.cacheWriteTokens;
	if (replacing && last !== null) {
		if (last.record.costUsd === null) unpricedSteps -= 1;
		else {
			pricedSteps -= 1;
			totalCostUsd -= last.record.costUsd;
		}
		inputTokens -= last.record.inputTokens;
		outputTokens -= last.record.outputTokens;
		cacheReadTokens -= last.record.cacheReadTokens;
		cacheWriteTokens -= last.record.cacheWriteTokens;
	}
	if (record.costUsd === null) unpricedSteps += 1;
	else {
		pricedSteps += 1;
		totalCostUsd += record.costUsd;
	}
	inputTokens += record.inputTokens;
	outputTokens += record.outputTokens;
	cacheReadTokens += record.cacheReadTokens;
	cacheWriteTokens += record.cacheWriteTokens;
	let byModel = state.byModel;
	if (replacing && last !== null) byModel = removeStepFromAgg(byModel, last.record);
	byModel = addStepToAgg(byModel, record);
	const steps = replacing ? state.steps.slice(0, -1).concat([record]) : state.steps.concat([record]);
	return {
		route,
		totalCostUsd,
		pricedSteps,
		unpricedSteps,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		byModel,
		steps,
		lastStep: {
			turn,
			step,
			record
		}
	};
}
function viewCostState(state) {
	return {
		totalCostUsd: state.totalCostUsd,
		pricedSteps: state.pricedSteps,
		unpricedSteps: state.unpricedSteps,
		inputTokens: state.inputTokens,
		outputTokens: state.outputTokens,
		cacheReadTokens: state.cacheReadTokens,
		cacheWriteTokens: state.cacheWriteTokens,
		byModel: state.byModel,
		steps: state.steps
	};
}
//#endregion
//#region src/cost-projection.ts
/**
* Host-side cost projection unit: wraps the pure fold (fold.ts) as a
* session-projection `ProjectionDefinition` registered under the `costUsage`
* key. The registry is supplied through a thunk so a later price refresh can
* swap the table without re-registering the unit.
*/
const stepRecordSchema = z.object({
	turn: z.number().int().nonnegative(),
	step: z.number().int().nonnegative(),
	model: z.string().nullable(),
	provider: z.string().nullable(),
	costUsd: z.number().nullable(),
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative(),
	cacheWriteTokens: z.number().int().nonnegative()
}).strict();
const modelAggregateSchema = z.object({
	model: z.string(),
	provider: z.string().nullable(),
	calls: z.number().int().nonnegative(),
	costUsd: z.number(),
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative()
}).strict();
/** Client-visible wire payload: the whole current costUsage value. */
const costUsageSchema = z.object({
	totalCostUsd: z.number(),
	pricedSteps: z.number().int().nonnegative(),
	unpricedSteps: z.number().int().nonnegative(),
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative(),
	cacheWriteTokens: z.number().int().nonnegative(),
	byModel: z.array(modelAggregateSchema),
	steps: z.array(stepRecordSchema)
}).strict();
/** Host-side fold state, including the fold-internal route and lastStep fields. */
const costUsageStateSchema = z.object({
	route: z.object({
		provider: z.string(),
		model: z.string()
	}).nullable(),
	totalCostUsd: z.number(),
	pricedSteps: z.number().int().nonnegative(),
	unpricedSteps: z.number().int().nonnegative(),
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative(),
	cacheWriteTokens: z.number().int().nonnegative(),
	byModel: z.array(modelAggregateSchema),
	steps: z.array(stepRecordSchema),
	lastStep: z.object({
		turn: z.number().int().nonnegative(),
		step: z.number().int().nonnegative(),
		record: stepRecordSchema
	}).nullable()
}).strict();
/**
* Build the cost projection unit.
* @param registry - thunk returning the current pricing table (supports refresh).
*/
function createCostProjection(registry) {
	return {
		key: "costUsage",
		stateSchema: costUsageStateSchema,
		init: initCostState,
		apply: (state, event) => applyCostEvent(state, event, registry()),
		stateVersion: 1,
		wire: {
			viewSchema: costUsageSchema,
			view: viewCostState
		}
	};
}
//#endregion
//#region src/refresh.ts
/** Cheap-first ordering key: free = 0, priced = input+output per-M, unknown last. */
function extractionRank(registry, provider, model) {
	const resolution = resolvePricing(registry, model, provider);
	if (resolution.status === "free") return 0;
	if (resolution.status === "priced") return resolution.entry.inputPerM + resolution.entry.outputPerM;
	return Number.MAX_SAFE_INTEGER;
}
/** Sort candidates cheapest-first (free, priced ascending, unknown last, stable tie-break). */
function sortExtractionCandidates(registry, candidates) {
	return [...candidates].sort((a, b) => {
		const ra = extractionRank(registry, a.provider, a.model);
		const rb = extractionRank(registry, b.provider, b.model);
		if (ra !== rb) return ra - rb;
		return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
	});
}
/**
* Build the full ordered candidate chain: `prefer` first (in order, e.g. the
* explicit config route then the last-successful model), then the remaining
* discovered models cheapest-first. Deduplicates by provider+model.
*/
function orderExtractionCandidates(registry, discovered, prefer = []) {
	const seen = /* @__PURE__ */ new Set();
	const ordered = [];
	const push = (provider, model) => {
		const key = `${provider}\u0000${model}`;
		if (seen.has(key)) return;
		seen.add(key);
		ordered.push({
			provider,
			model,
			label: `${provider}/${model}`
		});
	};
	for (const entry of prefer) push(entry.provider, entry.model);
	for (const candidate of sortExtractionCandidates(registry, discovered)) push(candidate.provider, candidate.model);
	return ordered;
}
/** Build one search query over the target models (already capped by the caller). */
function buildSearchQuery(models) {
	return `current API price per million tokens 2026: "${models.join("\" OR \"")}" input output cache`;
}
/**
* Build the extraction prompt handed to the LLM. It is asked to answer with a
* single strict JSON object using ONLY the search content it was given, and to
* omit fields it cannot source.
*/
function buildExtractPrompt(models, searchContent) {
	return [
		"You are extracting LLM API pricing from web search results.",
		"Produce ONE JSON object. Shape:",
		"{ \"models\": { \"<model-id>\": { \"inputPerM\": number, \"outputPerM\": number,",
		"  \"cacheReadPerM\": number, \"cacheWritePerM\": number, \"cacheWrite1hPerM\": number,",
		"  \"effectiveDate\": \"YYYY-MM-DD\", \"notes\": \"string\" } } }",
		"",
		"Rules:",
		"- All prices are USD per 1,000,000 tokens.",
		"- \"inputPerM\" and \"outputPerM\" are required; every other field is optional and must be OMITTED when unknown.",
		"- Only report a model when the search results below actually state its price.",
		"- Do not invent numbers; do not guess. If a price is missing, omit that model.",
		"- Output raw JSON only, no markdown fences, no commentary.",
		"",
		"Models to price:",
		models.map((m) => `  - "${m}"`).join("\n"),
		"",
		"Search results:",
		searchContent
	].join("\n");
}
/** Strip code fences and locate the outermost JSON object in free text. */
function extractJsonObject(text) {
	const withoutFences = text.replace(/```(?:json)?/gi, "").trim();
	const start = withoutFences.indexOf("{");
	const end = withoutFences.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	return withoutFences.slice(start, end + 1);
}
function toNumber(value) {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
	}
	return null;
}
function normalizeEntry(raw) {
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw;
	const inputPerM = toNumber(record.inputPerM);
	const outputPerM = toNumber(record.outputPerM);
	if (inputPerM === null || outputPerM === null) return null;
	const entry = {
		inputPerM,
		outputPerM
	};
	const cacheReadPerM = toNumber(record.cacheReadPerM);
	const cacheWritePerM = toNumber(record.cacheWritePerM);
	const cacheWrite1hPerM = toNumber(record.cacheWrite1hPerM);
	const offPeakFactor = toNumber(record.offPeakFactor);
	if (cacheReadPerM !== null) entry.cacheReadPerM = cacheReadPerM;
	if (cacheWritePerM !== null) entry.cacheWritePerM = cacheWritePerM;
	if (cacheWrite1hPerM !== null) entry.cacheWrite1hPerM = cacheWrite1hPerM;
	if (offPeakFactor !== null) entry.offPeakFactor = offPeakFactor;
	if (typeof record.effectiveDate === "string") entry.effectiveDate = record.effectiveDate;
	if (typeof record.notes === "string") entry.notes = record.notes;
	return entry;
}
/** Parse + leniently validate the LLM's JSON answer. Never throws. */
function parseRefreshedPricing(text) {
	const models = {};
	const json = extractJsonObject(text);
	if (json === null) return { models };
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { models };
	}
	if (typeof parsed !== "object" || parsed === null) return { models };
	const rawModels = parsed.models;
	if (typeof rawModels !== "object" || rawModels === null) return { models };
	for (const [model, rawEntry] of Object.entries(rawModels)) {
		const entry = normalizeEntry(rawEntry);
		if (entry !== null) models[model] = entry;
	}
	return { models };
}
/**
* Merge refreshed entries into a model map (the refresh-delta layer), returning
* the updated model ids. Mutates the given map in place; callers are expected to
* hand it the delta layer — NOT the final merged registry — so a refresh never
* clobbers the user's `config.pricing` overrides (which sit above the deltas).
*/
function applyRefreshed(models, refreshed) {
	const updated = [];
	for (const [model, entry] of Object.entries(refreshed.models)) {
		models[model] = entry;
		updated.push(model);
	}
	return updated;
}
//#endregion
//#region src/index.ts
/**
* Host plugin for dsh-llm-cost: registers the `costUsage` session projection
* (per-step/per-turn dollar cost) and, when the tools/llm/web capabilities are
* present, a model-facing `llm_cost_refresh` tool that looks up current prices
* on the web and updates the pricing table.
*/
const name = "llm-cost";
const DEFAULT_PRICING_FILE = join(homedir(), ".dsh", "llm-cost", "pricing.override.json");
/**
* Assemble the effective registry from three layers, lowest priority first:
* built-in snapshot < refresh deltas (persisted file + runtime refreshes) <
* `config.pricing` (explicit user intent, always wins).
*/
function buildRegistry(userPricing, refreshed) {
	return mergeRegistries(mergeRegistries(DEFAULT_PRICING, {
		version: DEFAULT_PRICING.version,
		models: refreshed
	}), userPricing);
}
function apply(ctx, config = {}) {
	const refreshed = {};
	const meta = {};
	const holder = { registry: buildRegistry(config.pricing, refreshed) };
	const rebuild = () => {
		holder.registry = buildRegistry(config.pricing, refreshed);
	};
	const pricingFile = config.pricingFile ?? DEFAULT_PRICING_FILE;
	readFile(pricingFile, "utf8").then((text) => {
		const parsed = JSON.parse(text);
		Object.assign(refreshed, parsed.models);
		if (parsed.lastExtraction !== void 0) meta.lastExtraction = parsed.lastExtraction;
		rebuild();
	}).catch((err) => {
		if (err.code !== "ENOENT") console.warn(`[dsh-llm-cost] ignoring unreadable pricing override ${pricingFile}:`, err);
	});
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projectionCtx.sessionProjections.register(createCostProjection(() => holder.registry));
	});
	ctx.inject([
		"tools",
		"llm",
		"web"
	], (toolCtx) => {
		registerRefreshTool(toolCtx, holder, refreshed, meta, pricingFile, config, rebuild);
	});
}
function registerRefreshTool(ctx, holder, refreshed, meta, pricingFile, config, rebuild) {
	ctx.tools.register(defineTool({
		name: "llm_cost_refresh",
		description: "Look up current LLM API prices (USD per 1M tokens) from the web and update the cost ledger's pricing table. Call this when prices may be stale.",
		parameters: { models: {
			type: "array",
			items: { type: "string" },
			description: "Optional model ids to refresh; empty refreshes every known model."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					updatedModels: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					count: {
						type: "number",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Updated ${String(value.count)} model price(s): ${value.updatedModels.join(", ") || "(none)"}`
			}]
		},
		async execute(args, exec) {
			const models = (Array.isArray(args.models) && args.models.length > 0 ? args.models : Object.keys(holder.registry.models)).slice(0, 24);
			if (models.length === 0) return {
				updatedModels: [],
				count: 0
			};
			const candidates = await resolveExtractionCandidates(ctx, holder, config, meta.lastExtraction);
			if (candidates.length === 0) throw new Error("llm-cost refresh: no LLM model is available to extract prices (register an LLM adapter, or set refreshProvider/refreshModel)");
			const result = await extractWithFallback(ctx, candidates, buildExtractPrompt(models, renderSearchContent(await ctx.web.search({
				query: buildSearchQuery(models),
				maxResults: 10
			}, exec.signal))), exec.signal);
			if (result === null) throw new Error("llm-cost refresh: every available model failed to extract prices");
			meta.lastExtraction = {
				provider: result.provider,
				model: result.model
			};
			const updated = applyRefreshed(refreshed, parseRefreshedPricing(result.outputText));
			rebuild();
			await persistRegistry(pricingFile, refreshed, holder.registry.version, meta.lastExtraction);
			console.info(`[dsh-llm-cost] refreshed ${updated.length} price(s) via ${result.label}`);
			return {
				updatedModels: updated,
				count: updated.length
			};
		}
	}));
}
/**
* Build the ordered extraction-candidate chain: the explicit
* `refreshProvider`/`refreshModel` first (user intent), then the model that
* last succeeded (memory), then every model the harness can currently reach,
* cheapest first (unknown-priced models last). A provider whose catalog query
* fails simply contributes no candidates.
*/
async function resolveExtractionCandidates(ctx, holder, config, lastExtraction) {
	const prefer = [];
	if (config.refreshProvider !== void 0 && config.refreshModel !== void 0) prefer.push({
		provider: config.refreshProvider,
		model: config.refreshModel
	});
	if (lastExtraction !== void 0) prefer.push(lastExtraction);
	const discovered = [];
	for (const provider of ctx.llm.listProviders()) {
		let models;
		try {
			models = await ctx.llm.listModels(provider.id);
		} catch {
			continue;
		}
		for (const model of models) discovered.push({
			provider: provider.id,
			model: model.id,
			label: `${provider.id}/${model.id}`
		});
	}
	return orderExtractionCandidates(holder.registry, discovered, prefer);
}
/**
* Run the extraction prompt through the candidate chain, cheapest first. The
* first candidate whose stream completes successfully wins; failures advance to
* the next candidate. Returns null when every candidate fails or the caller's
* signal aborts.
*/
async function extractWithFallback(ctx, candidates, prompt, signal) {
	for (const candidate of candidates) {
		if (signal?.aborted) return null;
		try {
			return {
				outputText: await extractWithLlm(ctx, {
					provider: candidate.provider,
					model: candidate.model,
					prompt,
					signal
				}),
				...candidate
			};
		} catch (error) {
			if (signal?.aborted) return null;
			console.warn(`[dsh-llm-cost] refresh extraction failed on ${candidate.label}:`, error);
		}
	}
	return null;
}
function renderSearchContent(search) {
	const lines = [];
	if (search.content !== void 0 && search.content !== "") lines.push(search.content);
	for (const source of search.sources) {
		lines.push(`- ${source.title ?? source.url}\n  ${source.url}`);
		if (source.snippet !== void 0 && source.snippet !== "") lines.push(`  ${source.snippet}`);
	}
	return lines.join("\n") || "(no search results)";
}
async function extractWithLlm(ctx, opts) {
	const assembler = new BlockAssembler();
	const stream = ctx.llm.stream({
		provider: opts.provider,
		model: opts.model,
		messages: [createUserMessage({
			content: [{
				type: "text",
				text: opts.prompt
			}],
			source: { kind: "user" }
		})],
		maxTokens: 4e3,
		signal: opts.signal
	});
	for await (const chunk of stream) {
		if (chunk.type === "finish") {
			if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") throw new Error(`llm-cost refresh extraction failed: ${chunk.reason.failure.message}`);
			continue;
		}
		assembler.push(chunk);
	}
	return assembler.blocks().filter((block) => block.type === "text").map((block) => block.text).join("");
}
/** Persist ONLY the refresh-delta layer (not the whole merged registry). */
async function persistRegistry(pricingFile, models, version, lastExtraction) {
	await mkdir(dirname(pricingFile), { recursive: true });
	await writeFile(pricingFile, JSON.stringify(lastExtraction === void 0 ? {
		version,
		models
	} : {
		version,
		models,
		lastExtraction
	}, null, 2) + "\n", "utf8");
}
//#endregion
export { Config, apply, name };
