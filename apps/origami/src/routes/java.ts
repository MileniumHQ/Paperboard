import { updateJavaPackages } from "../updateJava";
import { jsonResponse, verifyAuth, type Env } from "../lib";

export async function handleJavaRoutes(
    request: Request,
    env: Env,
    url: URL,
    pathname: string,
): Promise<Response | null> {
    if (
        pathname === "/update/java" ||
        pathname === "/update/java/" ||
        pathname.startsWith("/update/java/")
    ) {
        // O8: this route writes KV (per-release records). A state-mutating
        // GET invites naive prefetchers and link-scanners to mutate
        // production state; updates are triggered deliberately, via POST.
        if (request.method !== "POST") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }
        if (!verifyAuth(request, env)) {
            return jsonResponse(
                {
                    error: "Unauthorized",
                    // query keys are refused by design (see lib.ts
                    // verifyAuth): header credentials only
                    message: "Valid auth key required (via Authorization header or X-Auth-Key; query parameters are refused)",
                },
                401,
            );
        }

        if (!env.PACKAGES) {
            return jsonResponse(
                { error: "PACKAGES KV binding not configured" },
                500,
            );
        }

        let targetVersion: string | undefined = undefined;
        const pathParts = pathname.split("/").filter(Boolean);
        if (pathParts.length >= 3 && pathParts[2]) {
            targetVersion = pathParts[2].replace(/^java-?/, "");
        } else if (url.searchParams.get("version")) {
            targetVersion = url.searchParams
                .get("version")
                ?.replace(/^java-?/, "");
        }

        const result = await updateJavaPackages(
            env.PACKAGES,
            targetVersion,
        );
        return jsonResponse(result);
    }

    return null;
}
