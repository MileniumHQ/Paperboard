// How a conversation reads. The service stores one assistant message per
// model round: a round that asks for actions ends "done", the actions run,
// and the next round continues the answer. The reader sees one reply per
// prompt, so consecutive assistant messages group into a single turn whose
// status and stats come from its last round.

import type { AssistantMessage, ChatMessage, UserMessage } from "./types";

export type Turn =
    | { kind: "user"; message: UserMessage }
    | { kind: "assistant"; rounds: AssistantMessage[] };

export function groupTurns(messages: readonly ChatMessage[]): Turn[] {
    const turns: Turn[] = [];
    for (const message of messages) {
        const last = turns[turns.length - 1];
        if (message.role === "assistant") {
            if (last?.kind === "assistant") last.rounds.push(message);
            else turns.push({ kind: "assistant", rounds: [message] });
        } else {
            turns.push({ kind: "user", message });
        }
    }
    return turns;
}

/** A round is still thinking until it starts answering or asks for an action. */
export function isThinkingLive(round: AssistantMessage): boolean {
    return round.status === "streaming" && !round.content && !round.toolCalls?.length;
}

/** Nothing to show yet: the model has not produced a token in this round. */
export function isRoundEmpty(round: AssistantMessage): boolean {
    return !round.content && !round.thinking && !round.toolCalls?.length;
}

export interface TurnStats {
    /** tokens generated across every round of the reply */
    tokens: number;
    /** speed of the last round */
    tokensPerSecond: number;
    /** tokens in the window after the last round: its prompt plus its output */
    contextUsed?: number;
    contextLength?: number;
}

/** A finished reply's numbers; undefined until the last round reports. */
export function turnStats(rounds: readonly AssistantMessage[]): TurnStats | undefined {
    const last = rounds[rounds.length - 1]?.stats;
    if (!last) return undefined;
    const tokens = rounds.reduce((sum, r) => sum + (r.stats?.tokens ?? 0), 0);
    return {
        tokens,
        tokensPerSecond: last.tokensPerSecond,
        ...(last.promptTokens !== undefined && last.contextLength
            ? { contextUsed: last.promptTokens + last.tokens, contextLength: last.contextLength }
            : {}),
    };
}

/** 950 → "950", 12_345 → "12.3K" */
export function compactCount(n: number): string {
    if (n < 1000) return String(n);
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}K`;
}
