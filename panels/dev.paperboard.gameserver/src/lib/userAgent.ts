// Outbound requests to third-party APIs carry one identifying User-Agent.
// Modrinth requires a uniquely identifying agent and may block generic clients
// (docs.modrinth.com "User Agents"); PaperMC's downloads service requires the
// same and rejects generic agents. The version is set with the app's by
// apps/paperboard/scripts/sync-versions.ts.
export const PAPERBOARD_USER_AGENT =
    "MileniumHQ/Paperboard/0.3.0 (+https://paperboard.dev)";

/** fetch with the Paperboard User-Agent unless the caller already set one. */
export function apiFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("User-Agent")) {
        headers.set("User-Agent", PAPERBOARD_USER_AGENT);
    }
    return fetch(input, { ...init, headers });
}
