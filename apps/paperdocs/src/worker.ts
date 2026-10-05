// Static assets are the whole site: the landing at the root, the prerendered
// root pages, and the prerendered docs pages under /docs. The Worker only
// canonicalizes the docs mount and answers a missing page with the shared 404
// document; there is no SPA fallback and no alias table (the /paperui and
// /paperapi aliases are static files).

const DOCS_PREFIX = "/docs";
const DOCS_MOUNT = `${DOCS_PREFIX}/`;
const DOCS_INDEX = `${DOCS_MOUNT}index.html`;
// The asset server canonicalizes /404.html to /404, so ask for the
// extensionless path or it answers with a 307 whose body is empty.
const NOT_FOUND = "/404";

interface AssetsBinding {
    fetch(request: Request): Promise<Response>;
}

function acceptsHtml(request: Request): boolean {
    const accept = request.headers.get("accept");
    return accept !== null && accept.includes("text/html");
}

export default {
    async fetch(
        request: Request,
        env: { ASSETS: AssetsBinding },
    ): Promise<Response> {
        const url = new URL(request.url);

        // Canonicalize the docs mount so /docs and /docs/index.html never
        // duplicate the docs landing.
        if (url.pathname === DOCS_PREFIX || url.pathname === DOCS_INDEX) {
            url.pathname = DOCS_MOUNT;
            return Response.redirect(url.toString(), 308);
        }

        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404 || !acceptsHtml(request)) {
            return asset;
        }

        // One 404 experience sitewide: a missing page renders the shared 404
        // document, served with a 404 status so crawlers do not index it. A
        // missing asset stays a bare 404.
        const notFound = await env.ASSETS.fetch(
            new Request(new URL(NOT_FOUND, url), request),
        );
        if (notFound.status === 404) {
            return asset;
        }
        return new Response(notFound.body, {
            status: 404,
            headers: notFound.headers,
        });
    },
};
