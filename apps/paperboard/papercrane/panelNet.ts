// Panel document CSP. Panels are first-party and not sandboxed, so this
// policy is fixed rather than derived from a per-panel manifest block:
// scripts stay locked to the served document (the shell adds a per-response
// nonce), while the network directives do not pretend to restrict a
// first-party panel's reach. Panels disclose who they talk to in their
// store listing and their service code; there is no declared-egress
// manifest field and no per-panel allowlist.
export function buildPanelCsp(): string {
    return [
        "default-src 'self' panel: data: blob:",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' panel: http://*.paperboard.localhost:* data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' panel: ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:* https:",
        "media-src 'self' panel: blob:",
    ].join("; ");
}
