import mime from "mime-types";

// shared MIME lookup with charset overrides
const OVERRIDES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
};

export function lookupMime(ext: string): string {
    const key = ext.toLowerCase();
    if (OVERRIDES[key]) return OVERRIDES[key];
    return mime.lookup(key) || "application/octet-stream";
}
