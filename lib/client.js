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
		* completed assistant message (the `conversation.chat.turnTail` chain) and the
		* session's cumulative total as a cost segment in the composer dock
		* (`conversation.composer.dock`, beside the shipped stats line), expanding to
		* the per-model breakdown on hover.
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
		const COST_STYLE = {
			position: "relative",
			textAlign: "center",
			marginTop: 2,
			fontSize: 12,
			lineHeight: 20,
			color: "var(--dsw-alias-label-tertiary, rgba(15, 15, 15, 0.6))",
			cursor: "default",
			userSelect: "none",
			whiteSpace: "nowrap"
		};
		const POPOVER_STYLE = {
			position: "absolute",
			left: "50%",
			bottom: "calc(100% + 6px)",
			transform: "translateX(-50%)",
			minWidth: 240,
			padding: "10px 12px",
			borderRadius: 10,
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-primary, rgba(15, 15, 15, 0.92))",
			background: "var(--dsw-alias-surface-overlay, #ffffff)",
			border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))",
			boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
			whiteSpace: "nowrap"
		};
		const POPOVER_TITLE_STYLE = {
			fontWeight: 600,
			marginBottom: 4
		};
		const POPOVER_META_STYLE = {
			opacity: .72,
			marginBottom: 4
		};
		const POPOVER_ROW_STYLE = { marginTop: 2 };
		/**
		* Composer-dock cumulative total: the whole session's dollar cost so far,
		* read from the same `costUsage` projection the per-turn tails use. Renders
		* nothing until the session has at least one metered step.
		*/
		function CostDock({ useProjection }) {
			const [open, setOpen] = (0, react.useState)(false);
			const cost = useProjection("costUsage");
			if (cost === void 0 || cost.totalCostUsd === void 0 || cost.pricedSteps + cost.unpricedSteps === 0) return null;
			const tokens = cost.inputTokens + cost.outputTokens + cost.cacheReadTokens + cost.cacheWriteTokens;
			const label = cost.unpricedSteps > 0 ? `${formatUsd(cost.totalCostUsd)} + ${cost.unpricedSteps} unknown` : formatUsd(cost.totalCostUsd);
			return (0, react.createElement)("div", {
				"data-llm-cost-session": "total",
				tabIndex: 0,
				style: COST_STYLE,
				onMouseEnter: () => {
					setOpen(true);
				},
				onMouseLeave: () => {
					setOpen(false);
				},
				onFocus: () => {
					setOpen(true);
				},
				onBlur: () => {
					setOpen(false);
				}
			}, (0, react.createElement)("span", null, label), open && (0, react.createElement)("div", { style: POPOVER_STYLE }, (0, react.createElement)("div", { style: POPOVER_TITLE_STYLE }, label), (0, react.createElement)("div", { style: POPOVER_META_STYLE }, `${cost.pricedSteps} priced · ${cost.unpricedSteps} unknown · ${formatTokens(tokens)} tokens`), cost.byModel.map((entry) => (0, react.createElement)("div", {
				key: entry.model,
				style: POPOVER_ROW_STYLE
			}, `${entry.model} × ${entry.calls} — ${formatUsd(entry.costUsd)} · ${formatTokens(entry.inputTokens + entry.outputTokens)} tok`))));
		}
		function apply(ctx) {
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				select: (owner) => ({ turn: owner.turn.turn })
			}, CostTailView));
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "llm-cost-total",
				order: 100
			}, CostDock));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map