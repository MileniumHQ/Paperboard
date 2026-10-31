import type { GameOption } from "./types";

/** An option's value is rejected unless it fits the option; every game's service checks edits through here. */
export function validateOptionValue(field: GameOption, value: unknown): void {
    switch (field.kind) {
        case "number":
        case "slider":
            if (!Number.isInteger(value) || Number(value) < field.min || Number(value) > field.max) throw new Error(`${field.label} must be a whole number from ${field.min} to ${field.max}`);
            return;
        case "boolean":
            if (typeof value !== "boolean") throw new Error(`${field.label} must be on or off`);
            return;
        case "select":
            if (typeof value !== "string" || !field.choices.some((c) => c.value === value)) throw new Error(`${field.label} must be one of ${field.choices.map((c) => c.label).join(", ")}`);
            return;
        case "text":
        case "secret":
            if (typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error(`${field.label} must be a single line`);
            if (field.kind === "text" && field.maxLength !== undefined && value.length > field.maxLength) throw new Error(`${field.label} is at most ${field.maxLength} characters`);
            return;
    }
}

/** Applies a patch of option values over the previous ones; an unknown id or a bad value refuses the whole patch. */
export function validateOptions(fields: readonly GameOption[], game: string, input: Record<string, unknown>, previous: Record<string, unknown> = {}): Record<string, unknown> {
    const next = { ...previous };
    for (const [id, value] of Object.entries(input)) {
        const field = fields.find((f) => f.id === id);
        if (!field) throw new Error(`Unknown ${game} option: ${id}`);
        validateOptionValue(field, value);
        if (field.kind !== "secret") next[id] = value;
    }
    return next;
}
