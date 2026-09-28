// The landing is plain static content registered at the dist root, and the
// docs SPA is mounted under /docs. Built docs assets carry the prefix (Vite
// base "/docs/") while the ASSETS binding keys them from the dist root, so the
// prefix is stripped for asset lookups; the docs HTML entry itself is emitted
// at /docs/index.html and reached through the /docs/ directory index. Only
// requests that ask for HTML fall back to the docs shell, so a missing asset
// stays a 404 and a static file is never answered with an SPA page.
const DOCS_PREFIX = "/docs";
const DOCS_MOUNT = `${DOCS_PREFIX}/`;
const DOCS_INDEX = `${DOCS_MOUNT}index.html`;

interface AssetsBinding {
    fetch(request: Request): Promise<Response>;
}

function isDocsRequest(pathname: string): boolean {
    return pathname === DOCS_PREFIX || pathname.startsWith(DOCS_MOUNT);
}

function acceptsHtml(request: Request): boolean {
    const accept = request.headers.get("accept");
    return accept !== null && accept.includes("text/html");
}

function shellRequest(request: Request): Request {
    const url = new URL(request.url);
    url.pathname = DOCS_MOUNT;
    return new Request(url, request);
}

export default {
    async fetch(
        request: Request,
        env: { ASSETS: AssetsBinding },
    ): Promise<Response> {
        const url = new URL(request.url);

        if (!isDocsRequest(url.pathname)) {
            const asset = await env.ASSETS.fetch(request);
            if (asset.status !== 404 || !acceptsHtml(request)) {
                return asset;
            }
            // A missing root page gets the static 404 document, still with a
            // 404 status so crawlers do not treat it as a real page. The
            // extensionless path is what the asset server resolves to
            // 404.html (it redirects /404.html to /404).
            const notFound = await env.ASSETS.fetch(
                new Request(new URL("/404", url), request),
            );
            if (notFound.status === 404) {
                return asset;
            }
            return new Response(notFound.body, {
                status: 404,
                headers: notFound.headers,
            });
        }

        // Canonicalize the docs mount so relative resolution and the SPA's
        // base stripper always see the trailing-slash form.
        if (url.pathname === DOCS_PREFIX || url.pathname === DOCS_INDEX) {
            url.pathname = DOCS_MOUNT;
            return Response.redirect(url.toString(), 308);
        }

        if (url.pathname === DOCS_MOUNT) {
            return env.ASSETS.fetch(request);
        }

        url.pathname = url.pathname.slice(DOCS_PREFIX.length);
        const asset = await env.ASSETS.fetch(new Request(url, request));
        if (asset.status !== 404 || !acceptsHtml(request)) {
            return asset;
        }

        return env.ASSETS.fetch(shellRequest(request));
    },
};
