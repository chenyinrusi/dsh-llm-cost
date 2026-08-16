window.__ModuleLoader__.load({
	id: "dsh-llm-cost",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.tsx
		/**
		* Client plugin for dsh-llm-cost: renders the turn's dollar cost under each
		* completed assistant message, in the `conversation.chat.turnTail` extension
		* chain (the row that already shows "· Ran for · TTFT · tok/s").
		*
		* Unpriced models are rendered as "unknown" — never a misleading $0.00.
		*/
		const inject = ["slots"];
		function formatUsd(value) {
			if (value === 0) return "$0.00";
			if (value < 1e-4) return `$${value.toExponential(1)}`;
			if (value < .01) return `$${value.toFixed(5)}`;
			if (value < 1) return `$${value.toFixed(4)}`;
			return `$${value.toFixed(2)}`;
		}
		function formatTokens(value) {
			if (value < 1e3) return String(value);
			if (value < 1e6) return `${Math.round(value / 100) / 10}K`;
			return `${Math.round(value / 1e5) / 10}M`;
		}
		function CostTailView({ turn, matched, useProjection }) {
			const cost = useProjection("costUsage");
			if (cost === void 0) return null;
			const steps = cost.steps.filter((step) => step.turn === matched.turn);
			if (steps.length === 0) return null;
			const priced = steps.filter((step) => step.costUsd !== null);
			const unknown = steps.length - priced.length;
			const costTotal = priced.reduce((acc, step) => acc + (step.costUsd ?? 0), 0);
			const tokens = steps.reduce((acc, step) => acc + step.inputTokens + step.outputTokens + step.cacheReadTokens + step.cacheWriteTokens, 0);
			const parts = [];
			if (priced.length > 0) parts.push(formatUsd(costTotal));
			if (unknown > 0) parts.push(`${unknown} unknown`);
			if (tokens > 0) parts.push(`${formatTokens(tokens)} tok`);
			if (parts.length === 0) return null;
			return (0, react.createElement)("div", { "data-llm-cost": turn.turn }, parts.join(" · "));
		}
		function apply(ctx) {
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				select: (owner) => ({ turn: owner.turn.turn })
			}, CostTailView));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map