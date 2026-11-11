// The base of i.paperboard.dev installs Paperboard:
//
//   curl -fsSL https://i.paperboard.dev | sh        (Linux, macOS)
//   irm https://i.paperboard.dev | iex              (Windows PowerShell)
//
// Both scripts are packages/crane-launcher/install's, the same files
// `npx @mileniumhq/paperboard install` runs. A browser opening the base gets
// the downloads page instead of a script.
import installPs1 from "../../../../packages/crane-launcher/install/install.ps1";
import installSh from "../../../../packages/crane-launcher/install/install.sh";

const DOWNLOADS_PAGE = "https://paperboard.dev/downloads/";

function script(text: string): Response {
    return new Response(text, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

export function handleInstallRoutes(request: Request, pathname: string): Response | null {
    if (pathname === "/install.sh") return script(installSh);
    if (pathname === "/install.ps1") return script(installPs1);
    if (pathname !== "/") return null;
    // PowerShell's Invoke-RestMethod names itself in its User-Agent
    if (/PowerShell/i.test(request.headers.get("user-agent") ?? "")) return script(installPs1);
    if ((request.headers.get("accept") ?? "").includes("text/html")) {
        return new Response(null, { status: 302, headers: { Location: DOWNLOADS_PAGE, "Cache-Control": "no-cache" } });
    }
    return script(installSh);
}
