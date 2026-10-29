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

// raw level-name from server.properties; the caller validates it against
// SHELL_SAFE_LEVEL_NAME before it reaches any shell command
export function extractLevelName(props: Record<string, string>): string | undefined {
    const raw = props["level-name"]?.trim();
    return raw ? raw : undefined;
}

// Java reads server.properties as Latin-1 on older versions, so a raw UTF-8
// "§" arrives as "Â§". Escape every non-ASCII character as \uXXXX, like
// Java's own Properties.store, which every version reads back correctly.
export function stringifyServerProperties(values: Record<string, string>): string {
    const content = properties.stringify(values, {
        keySep: "=",
        lineWidth: null,
        latin1: false,
    });
    return content.replace(
        /[^\x00-\x7f]/g,
        (ch) => `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
    );
}
