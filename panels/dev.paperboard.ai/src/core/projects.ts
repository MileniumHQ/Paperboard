// Projects: the folders coding agents work in, kept in the panel's own files
// (files/agent/<name>). A project is named by the user; the name is the
// folder's name, so it must be one plain path segment on every platform.

export const MAX_PROJECT_NAME_CHARS = 64;
/** projects listed; past this the list says so rather than growing */
export const MAX_PROJECTS = 200;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A project name as given, trimmed; refused when it can't be one folder's name. */
export function projectName(raw: unknown): string {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name) throw new Error("Name the project.");
    if (name.length > MAX_PROJECT_NAME_CHARS) throw new Error(`Project names are limited to ${MAX_PROJECT_NAME_CHARS} characters.`);
    if (!/^[\p{L}\p{N} _.-]+$/u.test(name)) throw new Error("Use letters, numbers, spaces, dots, dashes and underscores.");
    if (name.startsWith(".") || name.endsWith(".")) throw new Error("A project name can't start or end with a dot.");
    if (WINDOWS_RESERVED.test(name.split(".")[0]!)) throw new Error(`"${name}" is a reserved name on Windows.`);
    return name;
}
