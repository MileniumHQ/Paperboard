// What Ask AI remembers between calls that share a memory key: the recent
// exchanges, oldest dropped first. Pure; the service owns the file.

export interface MemoryMessage {
    role: "user" | "assistant";
    content: string;
}

export interface MemoryEntry {
    messages: MemoryMessage[];
    updatedAt: number;
}

export const MAX_MEMORY_KEY_CHARS = 200;
/** keys kept; the least recently used is forgotten past this */
export const MAX_MEMORIES = 500;
/** messages kept per key (a question and its answer are two) */
export const MAX_MEMORY_MESSAGES = 20;
/** characters kept per key, across its messages */
export const MAX_MEMORY_CHARS = 16_000;

/** A memory key as given, trimmed; refused when empty or too long. */
export function memoryKey(raw: unknown): string {
    const key = typeof raw === "string" ? raw.trim() : "";
    if (!key) throw new Error("A memory key is required.");
    if (key.length > MAX_MEMORY_KEY_CHARS) throw new Error(`Memory keys are limited to ${MAX_MEMORY_KEY_CHARS} characters.`);
    return key;
}

/**
 * The history with one more exchange, trimmed to the bounds by dropping the
 * oldest exchanges whole, so a kept answer never loses its question.
 */
export function remember(history: readonly MemoryMessage[], question: string, answer: string): MemoryMessage[] {
    const next = [...history, { role: "user" as const, content: question }, { role: "assistant" as const, content: answer }];
    const size = () => next.reduce((n, m) => n + m.content.length, 0);
    while (next.length > 2 && (next.length > MAX_MEMORY_MESSAGES || size() > MAX_MEMORY_CHARS)) next.splice(0, 2);
    // one exchange larger than the whole budget keeps its newest part
    if (size() > MAX_MEMORY_CHARS) {
        const answer = next[1]!.content.slice(-MAX_MEMORY_CHARS);
        const room = MAX_MEMORY_CHARS - answer.length;
        next[0] = { role: "user", content: room > 0 ? next[0]!.content.slice(-room) : "" };
        next[1] = { role: "assistant", content: answer };
    }
    return next;
}

/** The entries with the least recently used dropped past MAX_MEMORIES. */
export function evictMemories(entries: Record<string, MemoryEntry>): Record<string, MemoryEntry> {
    const keys = Object.keys(entries);
    if (keys.length <= MAX_MEMORIES) return entries;
    const keep = keys.sort((a, b) => entries[b]!.updatedAt - entries[a]!.updatedAt).slice(0, MAX_MEMORIES);
    return Object.fromEntries(keep.map((k) => [k, entries[k]!]));
}
