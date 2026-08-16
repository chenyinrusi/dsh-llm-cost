/**
 * Client plugin for dsh-llm-cost: renders the turn's dollar cost under each
 * completed assistant message, in the `conversation.chat.turnTail` extension
 * chain (the row that already shows "· Ran for · TTFT · tok/s").
 *
 * Unpriced models are rendered as "unknown" — never a misleading $0.00.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
