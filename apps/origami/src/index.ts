import { CORS_HEADERS, jsonResponse, type Env } from "./lib";
import { handlePanelsRoutes } from "./routes/panels";
import { handlePackagesRoutes } from "./routes/packages";
import {
    handleDownloadHostRoutes,
    handlePaperdlRoutes,
    isDownloadHost,
} from "./routes/paperdl";

export type { Env };
export type { PackageMetadata } from "./lib";

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<Response> {
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: CORS_HEADERS,
            });
        }

        const bucket = env.PANELS_BUCKET;
        const url = new URL(request.url);
        const pathname = url.pathname;

        try {
            // i.paperboard.dev is downloads-only: short routes and feeds,
            // everything else is a 404 (no registry, panels, publish,
            // or health on this host).
            if (isDownloadHost(url.hostname)) {
                const dlRes = await handleDownloadHostRoutes(request, env, pathname);
                if (dlRes) return dlRes;
                return jsonResponse({ error: "Not Found" }, 404);
            }

            if (pathname === "/" || pathname === "/health") {
                return jsonResponse({
                    service: "Origami Package & Panel Registry",
                    status: "healthy",
                    endpoints: [
                        "/package/:name.json",
                        "/package/index.json",
                        "/library/",
                        "/panels/index.json",
                        "/panel/:id.json",
                        "/panel/:id/download",
                        "/panel/publish",
                        "/paperdl/:app/index.json",
                        "/paperdl/:app/:target/download",
                        "/paperdl/paperboard/latest.yml",
                        "/paperdl/paperboard/latest-mac.yml",
                        "/paperdl/paperboard/latest-linux.yml",
                        "/paperdl/:dlapp/latest/:file",
                        "/paperdl/:dlapp/:version/:file",
                        "/paperdl/pb/latest.yml",
                        "/paperdl/pb/latest-mac.yml",
                        "/paperdl/pb/latest-linux.yml",
                    ],
                });
            }

            const panelsRes = await handlePanelsRoutes(
                request,
                env,
                url,
                pathname,
                bucket,
            );
            if (panelsRes) return panelsRes;

            const packagesRes = await handlePackagesRoutes(
                request,
                env,
                url,
                pathname,
                bucket,
            );
            if (packagesRes) return packagesRes;

            const paperdlRes = await handlePaperdlRoutes(
                request,
                env,
                url,
                pathname,
                bucket,
            );
            if (paperdlRes) return paperdlRes;

            return jsonResponse({ error: "Not Found" }, 404);
        } catch (err) {
            // O9: the detail goes to the logs, not the caller — KV/R2
            // binding errors are internal facts, and echoing err.message
            // to an unauthenticated caller is an information leak.
            console.error("[origami] unhandled error:", err);
            return jsonResponse({ error: "Internal Server Error" }, 500);
        }
    },
};
