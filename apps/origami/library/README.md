# Panel Library

A division of [Origami](../README.md): the Paperboard panel store as a
standalone web app, served at `/library/` from the registry origin. It reads
`/panels/index.json` and `/panel/:id/download` from that same origin — there
is no separate API for it.

## Embed contract

Paperboard embeds the page in an iframe. The library posts
`paperboard:library-hello`; the shell answers `paperboard:library-connected`
with the current theme and the active computer's installed panels. Install
clicks then become a signal round-trip:

| library → shell | shell → library |
| --- | --- |
| `paperboard:library-hello` | `paperboard:library-connected` (`theme`, `installed`) |
| `paperboard:library-install` (`requestId`, `panelId`) | `paperboard:library-install-result` (`ok`, `error?`) |
| `paperboard:library-open` (`panelId`) | `paperboard:library-installed` (`installed`, `theme`, pushed on every change) |
| `paperboard:library-media` (`requestId`, `panelId`, `full`) | `paperboard:library-media-result` (`ok`, `icon?`, `store?`, `error?`) |

An installed panel the registry doesn't list (a dev link, a direct install)
still gets a page. The library asks for its media by panel id, never by path:
the icon for the grid, and the full listing only for the page being viewed.
The shell reads the panel's own `manifest.json` and `store/` files through
the same resolver as `panel://`, and answers with data URLs. The library
parses them with the same listing parser as registry records.

The shell validates sender window, origin, and panel id before an install can
reach the daemon; the library treats any non-answering embedder as absent. A
direct browser load never completes the handshake, so the action is a plain
archive download instead of an install.

## Development

```bash
# Vite dev server (proxies /panels and /panel to ORIGAMI_URL, default the deployed registry)
bun run dev

# Typecheck, build into dist/library/ (static assets for Origami), and test
bun run typecheck
bun run build
bun run test
```

`bun run build:library` in the parent Origami package builds this app; `dev`
and `deploy` there run it automatically. To develop the library against a
Paperboard window, set `VITE_PANEL_LIBRARY_URL` when starting Paperboard
(`VITE_PANEL_LIBRARY_URL=http://localhost:5175/library/ bun run dev`).
