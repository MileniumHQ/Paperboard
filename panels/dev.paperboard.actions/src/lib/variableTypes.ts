// One place decides what a variable looks like: the picker shows this icon
// and the chip stores it at insert time, so the two can never disagree.
// Priority: the field's own icon, then the type's icon, then a fallback.

export const VARIABLE_TYPE_ICONS: Record<string, string> = {
    string: "text_fields",
    number: "numbers",
    boolean: "toggle_on",
    object: "data_object",
    any: "bolt",
    url: "link",
    color: "palette",
    "discord-channel": "tag",
    "discord-user": "person",
    "discord-role": "badge",
    "discord-message": "chat",
    "discord-embed": "article",
    "discord-interaction": "reply",
};

export function variableFieldIcon(type?: string, icon?: string): string {
    if (icon) return icon;
    if (type && VARIABLE_TYPE_ICONS[type]) return VARIABLE_TYPE_ICONS[type];
    return "bolt";
}

/** Display label and icon for a stored `{{id:label:icon}}` token. */
export function getVariableInfo(token: string): { label: string; icon: string } {
    const raw = token.replace(/[\{\}]/g, "").trim();
    const parts = raw.split(":");
    const varId = parts[0].toLowerCase();
    const label =
        parts[1] ||
        (varId === "player"
            ? "Username"
            : varId === "message"
              ? "Message"
              : varId === "output"
                ? "Result"
                : varId.charAt(0).toUpperCase() + varId.slice(1));
    let icon = parts[2];
    if (!icon) {
        if (varId === "player" || varId.includes("user")) icon = "person_add";
        else if (varId === "message" || varId.includes("chat")) icon = "chat";
        else if (varId === "output" || varId.includes("result") || varId.includes("command")) icon = "terminal";
        else icon = "bolt";
    }
    return { label, icon };
}

export interface VariableToken {
    id: string;
    label: string;
    icon: string;
}

/** The variable a stored value references, or null when it is a literal. */
export function parseVariableToken(value: unknown): VariableToken | null {
    if (typeof value !== "string") return null;
    const match = value.match(/\{\{([^{}]+)\}\}/);
    if (!match) return null;
    const id = match[1].split(":")[0];
    const info = getVariableInfo(match[1]);
    return { id, label: info.label, icon: info.icon };
}
