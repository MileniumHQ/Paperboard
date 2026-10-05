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

        // page cap: the index lists at most MAX_KEYS packages per request
        // — unbounded cursor loops die the day the registry grows
        const MAX_KEYS = 200;
        const packageIndex: Record<string, unknown> = {};
        let cursor: string | undefined = undefined;
        let collected = 0;
        let capped = false;

        do {
            const listResult: KVNamespaceListResult<unknown> =
                await env.PACKAGES.list({
                    cursor,
                });

            const keys = listResult.keys
                .map((k) => k.name)
                .filter(
                    (name) =>
                        // only package records belong in the package index.
                        // panel records, the panel index, trashed records,
                        // and the binary download-version database (dl/*)
                        // share this namespace and must not leak as packages.
                        !name.startsWith("panel:") &&
                        !name.startsWith("panels:") &&
                        !name.startsWith("trash:") &&
                        !name.startsWith("dl/") &&
                        // pre-rename deployed KV still holds board:*/boards:*
                        // keys; no code reads them, but they must not leak
                        // into the package listing either
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
                    } catch (err) {
                        console.warn(
                            `[origami] package index: JSON read failed for ${key}, falling back to text:`,
                            err instanceof Error ? err.message : String(err),
                        );
                        const textVal = await env.PACKAGES.get(key, {
                            type: "text",
                        });
                        return { key, val: textVal };
                    }
                }),
            );

            for (const { key, val } of values) {
                if (collected >= MAX_KEYS) {
                    capped = true;
                    break;
                }
                packageIndex[key] = val ?? null;
                collected++;
            }

            cursor = listResult.list_complete
                ? undefined
                : listResult.cursor;
        } while (cursor && collected < MAX_KEYS);

        return jsonResponse({
            ...packageIndex,
            ...(capped ? { truncated: `listing capped at ${MAX_KEYS} keys` } : {}),
        });
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
        } catch (err) {
            console.warn(
                `[origami] package ${packageName}: JSON read failed, falling back to text:`,
                err instanceof Error ? err.message : String(err),
            );
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
