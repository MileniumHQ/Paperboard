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

// Package records share the namespace with panel records, the panel index,
// trashed records, the binary download-version database (dl/*) and the
// pre-rename board:*/boards:* keys no code reads; none of those are packages.
const NOT_PACKAGES = ["panel:", "panels:", "trash:", "dl/", "board:", "boards:"];
function isPackageKey(name: string): boolean {
    return !NOT_PACKAGES.some((prefix) => name.startsWith(prefix));
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

        // The index is one document of every package, read in one request.
        // Past the cap it fails instead of answering a partial map: a daemon
        // reading a cut list would silently stop updating what was cut.
        const MAX_PACKAGES = 200;
        const names: string[] = [];
        let cursor: string | undefined;
        do {
            const page: KVNamespaceListResult<unknown> = await env.PACKAGES.list({ cursor });
            names.push(...page.keys.map((k) => k.name).filter(isPackageKey));
            if (names.length > MAX_PACKAGES) {
                console.error(`[origami] package index holds more than ${MAX_PACKAGES} packages`);
                return jsonResponse(
                    { error: `The registry holds more than the ${MAX_PACKAGES} packages its index can list` },
                    500,
                );
            }
            cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);

        const values = await Promise.all(names.map((name) => readPackage(env.PACKAGES, name)));
        return jsonResponse(Object.fromEntries(names.map((name, i) => [name, values[i] ?? null])));
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
