import { jsonResponse, type Env } from "../lib";
import { UnreadableRecordError } from "../recordError";

// A package record daemons install from. One that isn't JSON is a broken
// record, never a string to hand them: it fails the request, naming the
// package, with the detail in the logs.
async function readPackage(kv: KVNamespace, name: string): Promise<unknown> {
    try {
        return await kv.get(name, { type: "json" });
    } catch (err) {
        console.error(`[origami] package record ${name} could not be read:`, err);
        throw new UnreadableRecordError(name);
    }
}

export async function handlePackagesRoutes(
    request: Request,
    env: Env,
    pathname: string,
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
                keys.map(async (key) => ({ key, val: await readPackage(env.PACKAGES, key) })),
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

        const pkgData = await readPackage(env.PACKAGES, packageName);

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
