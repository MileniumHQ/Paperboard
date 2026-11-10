// How a registry entry becomes a Blockly block type, and back. The page
// defines blocks under these names and the service runs them by the same
// names, so nothing else has to be stored to know what a block is.
//
//   pb.command|<panel>|<entry>         a command (a step, or a value when it returns one)
//   pb.value|<panel>|<entry>           a value
//   pb.changes|<panel>|<entry>         "when <value> changes": the entry is the value's
//   pb.event|<panel>|<entry>           an event's hat
//   pb.event-value|<panel>|<entry>|<key>  one value an event fires with
//   pb.property|<panel>:<type>         "[field] of [value]" for a type
//
// An entry is "kind.id" or "project/kind.id" (PaperAPI's blockEntry).

export type RegistryBlockKind = "command" | "value" | "changes" | "event" | "event-value";

export interface RegistryBlockName {
    kind: RegistryBlockKind;
    panelId: string;
    entry: string;
    /** event-value only: which value */
    key?: string;
}

const PREFIX = "pb.";

export function registryBlockType(name: RegistryBlockName): string {
    return [`${PREFIX}${name.kind}`, name.panelId, name.entry, ...(name.key !== undefined ? [name.key] : [])].join("|");
}

export function propertyBlockType(typeRef: string): string {
    return `${PREFIX}property|${typeRef}`;
}

/** The registry block a type names, or null for a built-in or property block. */
export function parseRegistryBlockType(type: string): RegistryBlockName | null {
    if (!type.startsWith(PREFIX)) return null;
    const [head, panelId, entry, key] = type.split("|");
    const kind = head!.slice(PREFIX.length);
    if (!["command", "value", "changes", "event", "event-value"].includes(kind) || !panelId || !entry) return null;
    if ((kind === "event-value") !== (key !== undefined)) return null;
    return { kind: kind as RegistryBlockKind, panelId, entry, ...(key !== undefined ? { key } : {}) };
}

/** The type ("panel:type") a property block reads, or null. */
export function parsePropertyBlockType(type: string): string | null {
    const prefix = `${PREFIX}property|`;
    return type.startsWith(prefix) ? type.slice(prefix.length) : null;
}

/** What an entry is: its project, kind and id. */
export function parseEntry(entry: string): { project?: string; kind: string; id: string } {
    const slash = entry.indexOf("/");
    const project = slash === -1 ? undefined : entry.slice(0, slash);
    const rest = slash === -1 ? entry : entry.slice(slash + 1);
    const dot = rest.indexOf(".");
    return { ...(project ? { project } : {}), kind: rest.slice(0, dot), id: rest.slice(dot + 1) };
}

/** Built-in blocks this panel adds beside Blockly's own. */
export const BUILTIN = {
    onRun: "pb_on_run",
    wait: "pb_wait",
    log: "pb_log",
    waitUntil: "pb_wait_until",
    stop: "pb_stop",
    fail: "pb_fail",
    attempt: "pb_try",
    errorMessage: "pb_error_message",
    textTest: "pb_text_test",
    regexTest: "pb_regex_test",
    regexFind: "pb_regex_find",
    toNumber: "pb_to_number",
    base64: "pb_base64",
    randomId: "pb_random_id",
    jsonParse: "pb_json_parse",
    jsonText: "pb_json_text",
    getKey: "pb_get_key",
    now: "pb_now",
    timeFormat: "pb_time_format",
    timePart: "pb_time_part",
    timeAdd: "pb_time_add",
    webGet: "pb_web_get",
    webPost: "pb_web_post",
} as const;
