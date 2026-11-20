// The base of i.paperboard.dev installs Paperboard:
//
//   curl -fsSL https://i.paperboard.dev | sh        (Linux, macOS)
//
// The script is packages/npx/install's, the same file
// `npx @mileniumhq/paperboard install` runs. There is deliberately no
// pipe-to-PowerShell install for Windows: it is indistinguishable from a
// ClickFix attack. A browser or PowerShell opening the base gets the
// downloads page instead of a script.
import installSh from "@mileniumhq/paperboard/install.sh";

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
    if (pathname !== "/") return null;
    const powershell = /PowerShell/i.test(request.headers.get("user-agent") ?? "");
    if (powershell || (request.headers.get("accept") ?? "").includes("text/html")) {
        return new Response(null, { status: 302, headers: { Location: DOWNLOADS_PAGE, "Cache-Control": "no-cache" } });
    }
    return script(installSh);
}
