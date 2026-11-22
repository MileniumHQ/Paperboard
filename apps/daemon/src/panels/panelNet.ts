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
        // workers a panel's own code starts: its bundled files, and the decoders
        // libraries build from a blob at runtime (3D meshes and textures). A
        // blob worker runs code the page's script assembles, which script-src
        // alone refuses: panels are first-party and reviewed, so it's allowed.
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' panel: data: blob: https:",
        "font-src 'self' data:",
        // blob: and data: are bytes the panel already holds (a file it read, a
        // model's embedded buffer), which a preview reads back with fetch
        "connect-src 'self' panel: blob: data: ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:* https:",
        "media-src 'self' panel: blob:",
        // a local web page shown in a panel (a page its service serves on loopback); it gets its own origin
        "frame-src 'self' panel: http://127.0.0.1:* http://localhost:* http://*.localhost:*",
    ].join("; ");
}
