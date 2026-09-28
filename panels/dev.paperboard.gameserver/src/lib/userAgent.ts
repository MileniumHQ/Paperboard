// Outbound requests to third-party APIs carry one identifying User-Agent.
// Modrinth requires a uniquely identifying agent and may block generic clients
// (docs.modrinth.com "User Agents"); PaperMC's downloads service requires the
// same and rejects generic agents. Keep the string in sync with the app
// version in apps/paperboard/package.json.
export const PAPERBOARD_USER_AGENT =
    "MileniumHQ/Paperboard/3.0.0-alpha (+https://paperboard.dev)";

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
