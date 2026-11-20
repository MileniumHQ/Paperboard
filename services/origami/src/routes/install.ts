// The base of i.paperboard.dev installs Paperboard:
//
//   curl -fsSL https://i.paperboard.dev | sh        (Linux, macOS)
//
// The script is packages/npx/install's, the same file
// `npx @mileniumhq/paperboard install` runs. There is deliberately no
// pipe-to-PowerShell install for Windows: it is indistinguishable from a
// ClickFix attack. A browser opening the base gets the
// downloads page, and PowerShell gets a 410 that says where to go.
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

// 410 with a plain-text body: `irm` shows it as its error and `iex` gets
// nothing to run, so an old copy of the command says where to go instead.
function noPowershellInstall(): Response {
    return new Response(`Paperboard no longer installs by piping into PowerShell. Download the Windows installer: ${DOWNLOADS_PAGE}\n`, {
        status: 410,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
    });
}

export function handleInstallRoutes(request: Request, pathname: string): Response | null {
    if (pathname === "/install.sh") return script(installSh);
    if (pathname === "/install.ps1") return noPowershellInstall();
    if (pathname !== "/") return null;
    // PowerShell's Invoke-RestMethod names itself in its User-Agent
    if (/PowerShell/i.test(request.headers.get("user-agent") ?? "")) return noPowershellInstall();
    if ((request.headers.get("accept") ?? "").includes("text/html")) {
        return new Response(null, { status: 302, headers: { Location: DOWNLOADS_PAGE, "Cache-Control": "no-cache" } });
    }
    return script(installSh);
}
