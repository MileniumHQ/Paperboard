// The URL shape of i.paperboard.dev's downloads, shared by the worker that
// serves them (routes/paperdl.ts) and the publisher that writes the
// records behind them (scripts/publishLib.ts). Binaries live on GitHub
// Releases under the v<version> tag (one release holds both apps' assets);
// <host>/<app>/<version|latest>/<file> 302s to them.
export const DOWNLOAD_HOST = "i.paperboard.dev";

// The registry's production origin: record URLs are minted on it, the
// operator scripts read through it, and the library loads only images it
// hosts (or its own origin's), so every reader names this one constant.
export const REGISTRY_ORIGIN = "https://origami.ariapis.com";
export const GH_REPO = "MileniumHQ/Paperboard";

// A version or filename sits inside a URL path slot and inside the redirect
// target, so neither may contain "/", whitespace, "%", "?", or "#".
// "latest" matches VERSION_SEGMENT on purpose: the router checks the alias
// before the versioned route.
export const VERSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+\-]{0,63}$/;
export const FILE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._\-]{0,127}$/;
