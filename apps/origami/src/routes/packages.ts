import { jsonResponse, type Env } from "../lib";

export async function handlePackagesRoutes(
    request: Request,
    env: Env,
    _url: URL,
    pathname: string,
    _bucket: R2Bucket | undefined,
): Promise<Response | null> {
    if (
        pathname === "/package/index.json" ||
        pathname === "/packages/index.json" ||
        pathname === "/package/index"
    ) {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }

        if (!env.PACKAGES) {
            return jsonResponse(
                { error: "PACKAGES KV binding not configured" },
                500,
            );
        }

        const packageIndex: Record<string, unknown> = {};
        let cursor: string | undefined = undefined;

        do {
            const listResult: KVNamespaceListResult<unknown> =
                await env.PACKAGES.list({
                    cursor,
                });

            const keys = listResult.keys
                .map((k) => k.name)
                .filter(
                    (name) =>
                        !name.startsWith("panel:") &&
                        !name.startsWith("panels:") &&
                        !name.startsWith("board:") &&
                        !name.startsWith("boards:"),
                );

            const values = await Promise.all(
                keys.map(async (key) => {
                    try {
                        const val = await env.PACKAGES.get(key, {
                            type: "json",
                        });
                        return { key, val };
                    } catch {
                        const textVal = await env.PACKAGES.get(key, {
                            type: "text",
                        });
                        return { key, val: textVal };
                    }
                }),
            );

            for (const { key, val } of values) {
                packageIndex[key] = val ?? null;
            }

            cursor = listResult.list_complete
                ? undefined
                : listResult.cursor;
        } while (cursor);

        return jsonResponse(packageIndex);
    }

    const singlePackageMatch = pathname.match(
        /^\/package\/([a-zA-Z0-9_\-\.]+)\.json$/,
    );
    if (singlePackageMatch) {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }

        const packageName = singlePackageMatch[1];
        if (!packageName) {
            return jsonResponse({ error: "Invalid package name" }, 400);
        }

        if (!env.PACKAGES) {
            return jsonResponse(
                { error: "PACKAGES KV binding not configured" },
                500,
            );
        }

        let pkgData: unknown = null;
        try {
            pkgData = await env.PACKAGES.get(packageName, {
                type: "json",
            });
        } catch {
            pkgData = await env.PACKAGES.get(packageName, {
                type: "text",
            });
        }

        if (pkgData === null || pkgData === undefined) {
            return jsonResponse(
                {
                    error: "Package not found",
                    package: packageName,
                },
                404,
            );
        }

        return jsonResponse(pkgData);
    }

    return null;
}
