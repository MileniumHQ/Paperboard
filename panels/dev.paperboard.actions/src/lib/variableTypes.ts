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
