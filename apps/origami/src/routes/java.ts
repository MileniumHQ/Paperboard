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
        if (!verifyAuth(request, env)) {
            return jsonResponse(
                {
                    error: "Unauthorized",
                    message:
                        "Valid auth key required (via Authorization header, X-Auth-Key, or ?key= query parameter)",
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
