// How a registry entry becomes a Blockly block type, and back. The page
// defines blocks under these names and the service runs them by the same
// names, so nothing else has to be stored to know what a block is.
//
//   pb.command|<panel>|<entry>         a command: a step
//   pb.result|<panel>|<entry>          what a command gave back, from its gear
//   pb.result|<panel>|<entry>|<field>|<panel>:<type>  one field of it: the type it gave back, named
//   pb.value|<panel>|<entry>           a value
//   pb.changes|<panel>|<entry>         "when <value> changes": the entry is the value's
//   pb.event|<panel>|<entry>           an event's hat
//   pb.event-value|<panel>|<entry>|<key>  one value an event fires with
//   pb.property|<panel>:<type>         "[field] of [value]" for a type
//   pb.property|<panel>:<type>|<project>  the same, for the fields read in a project
//   pb.choice|<panel>:<type>           a dropdown of the values a type lists
//   pb.choice|<panel>:<type>|<none|any>  the same, for an optional input
//
// An entry is "kind.id" or "project/kind.id" (PaperAPI's blockEntry).

export type RegistryBlockKind = "command" | "result" | "value" | "changes" | "event" | "event-value";

export interface RegistryBlockName {
    kind: RegistryBlockKind;
    panelId: string;
    entry: string;
    /** event-value: which value; result: which field, if one */
    key?: string;
    /** result with a key: the type ("panel:type") the command gave back, which has the field */
    typeRef?: string;
}

const PREFIX = "pb.";

export function registryBlockType(name: RegistryBlockName): string {
    return [`${PREFIX}${name.kind}`, name.panelId, name.entry, ...(name.key !== undefined ? [name.key] : []), ...(name.typeRef !== undefined ? [name.typeRef] : [])].join("|");
}

export function propertyBlockType(typeRef: string, project?: string): string {
    return [`${PREFIX}property`, typeRef, ...(project ? [project] : [])].join("|");
}

/** The registry block a type names, or null for a built-in or property block. */
export function parseRegistryBlockType(type: string): RegistryBlockName | null {
    if (!type.startsWith(PREFIX)) return null;
    const [head, panelId, entry, key, typeRef, ...rest] = type.split("|");
    const kind = head!.slice(PREFIX.length);
    if (!["command", "result", "value", "changes", "event", "event-value"].includes(kind) || !panelId || !entry || rest.length) return null;
    if (kind === "result") {
        // a field names the type that has it; the whole value names neither
        if ((key === undefined) !== (typeRef === undefined) || key === "" || typeRef === "") return null;
    } else if ((kind === "event-value") !== (key !== undefined) || typeRef !== undefined) return null;
    return { kind: kind as RegistryBlockKind, panelId, entry, ...(key !== undefined ? { key } : {}), ...(typeRef !== undefined ? { typeRef } : {}) };
}

export function choiceBlockType(typeRef: string, empty?: "none" | "any"): string {
    return [`${PREFIX}choice`, typeRef, ...(empty ? [empty] : [])].join("|");
}

/** The type a dropdown block lists the values of, and what it says for none, or null. */
export function parseChoiceBlockType(type: string): { typeRef: string; empty?: "none" | "any" } | null {
    const [head, typeRef, empty, ...rest] = type.split("|");
    if (head !== `${PREFIX}choice` || !typeRef || rest.length || (empty !== undefined && empty !== "none" && empty !== "any")) return null;
    return { typeRef, ...(empty ? { empty } : {}) };
}

/** The type ("panel:type") a property block reads, and the project it reads in, or null. */
export function parsePropertyBlockType(type: string): { typeRef: string; project?: string } | null {
    const [head, typeRef, project, ...rest] = type.split("|");
    if (head !== `${PREFIX}property` || !typeRef || rest.length || project === "") return null;
    return { typeRef, ...(project ? { project } : {}) };
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
    hasValue: "pb_has_value",
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
