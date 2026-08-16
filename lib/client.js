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
		* session's cumulative total as a floating pill in the bottom-left corner of
		* the frame (`shell.overlay`), expanding to the per-model breakdown on hover.
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
		const PILL_STYLE = {
			position: "fixed",
			left: 16,
			bottom: 16,
			zIndex: 9999,
			display: "inline-flex",
			alignItems: "center",
			maxWidth: "min(320px, 40vw)",
			padding: "4px 10px",
			borderRadius: 999,
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-primary, rgba(15, 15, 15, 0.92))",
			background: "var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.16))",
			border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))",
			cursor: "default",
			userSelect: "none",
			whiteSpace: "nowrap"
		};
		const POPOVER_STYLE = {
			position: "absolute",
			left: 0,
			bottom: "calc(100% + 8px)",
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
		* Bottom-left cumulative cost pill: an always-visible session total that
		* expands to the per-model breakdown on hover/focus. `shell.overlay` is
		* root-scoped, so it carries no `useProjection` seat — the current session's
		* `costUsage` is read through the global `useSessions` store instead.
		*/
		function CostPill({ useSessions }) {
			const [open, setOpen] = (0, react.useState)(false);
			const cost = useSessions((s) => {
				const id = s.current;
				return id === void 0 ? void 0 : s.byId[id]?.projectionValues?.costUsage;
			});
			let label;
			if (cost === void 0) label = "llm-cost: NO DATA";
			else if (cost.totalCostUsd === void 0) label = "llm-cost: NO CUMULATIVE FIELDS";
			else if (cost.pricedSteps + cost.unpricedSteps === 0) label = "llm-cost: 0 STEPS";
			else label = cost.unpricedSteps > 0 ? `${formatUsd(cost.totalCostUsd)} + ${cost.unpricedSteps} unknown` : formatUsd(cost.totalCostUsd);
			return (0, react.createElement)("div", {
				"data-llm-cost-session": "total",
				tabIndex: 0,
				style: PILL_STYLE,
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
			}, (0, react.createElement)("span", null, label), open && cost !== void 0 && (0, react.createElement)("div", { style: POPOVER_STYLE }, (0, react.createElement)("div", { style: POPOVER_TITLE_STYLE }, label), (0, react.createElement)("div", { style: POPOVER_META_STYLE }, `${cost.pricedSteps ?? "?"} priced · ${cost.unpricedSteps ?? "?"} unknown · ${formatTokens((cost.inputTokens ?? 0) + (cost.outputTokens ?? 0) + (cost.cacheReadTokens ?? 0) + (cost.cacheWriteTokens ?? 0))} tokens`), (cost.byModel ?? []).map((entry) => (0, react.createElement)("div", {
				key: entry.model,
				style: POPOVER_ROW_STYLE
			}, `${entry.model} × ${entry.calls} — ${formatUsd(entry.costUsd)} · ${formatTokens(entry.inputTokens + entry.outputTokens)} tok`))));
		}
		function apply(ctx) {
			console.log("[dsh-llm-cost] client apply() running");
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				select: (owner) => ({ turn: owner.turn.turn })
			}, CostTailView));
			ctx.slots.inject("shell.overlay", () => {
				console.log("[dsh-llm-cost] shell.overlay declared — registering pill");
				return ctx.slots.register({
					name: "shell.overlay",
					id: "llm-cost-total"
				}, CostPill);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map