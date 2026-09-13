import properties from "dot-properties";

export function parseProperties(content: string): Record<string, string> {
    return (properties.parse(content) || {}) as Record<string, string>;
}

export function extractServerPort(props: Record<string, string>): string | undefined {
    const rawPort = props["server-port"];
    if (rawPort && rawPort !== "0" && !isNaN(Number(rawPort))) {
        return rawPort;
    }
    return undefined;
}

export function cleanMotdValue(rawMotd: string | undefined): string | undefined {
    if (!rawMotd) return undefined;
    const clean = rawMotd.replace(/§[0-9a-fk-or]/gi, "").trim();
    return clean ? clean : undefined;
}

// raw level-name from server.properties; the caller validates it against
// SHELL_SAFE_LEVEL_NAME before it reaches any shell command
export function extractLevelName(props: Record<string, string>): string | undefined {
    const raw = props["level-name"]?.trim();
    return raw ? raw : undefined;
}
