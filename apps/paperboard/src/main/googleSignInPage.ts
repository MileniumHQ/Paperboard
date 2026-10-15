// The page Google's sign-in comes back to in the user's browser: PaperUI's
// empty state, drawn with PaperUI's own tokens and font in the app's theme,
// so the tab matches Paperboard instead of flashing a bare white page.
import colors from "../../../../packages/paperui/src/styles/colors.css?raw";
import tokens from "../../../../packages/paperui/src/styles/styles.css?raw";
import nunitoSans from "../../../../packages/paperui/src/font/NunitoSans.woff2?inline";

import { signInReasonHtml } from "./signInReason";

export type SignInPageOutcome = "connected" | "not-connected";

const ICONS: Record<SignInPageOutcome, string> = {
    connected: '<circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/>',
    "not-connected": '<circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/>',
};

const TEXT: Record<SignInPageOutcome, { title: string; description: string }> = {
    connected: { title: "Google Drive is connected", description: "You can close this tab and go back to Paperboard." },
    "not-connected": { title: "Google Drive wasn't connected", description: "You can close this tab and try again in Paperboard." },
};

/** reason: why the sign-in was not connected, shown under the title */
export function googleSignInPage(outcome: SignInPageOutcome, dark: boolean, reason?: string): string {
    const theme = dark ? "dark" : "light";
    const text = TEXT[outcome];
    return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="${theme}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paperboard</title>
<style>
@font-face { font-family: "Nunito Sans"; font-weight: 200 1000; font-stretch: 75% 125%; src: url(${nunitoSans}) format("woff2"); }
${colors}
${tokens.replace(/^@import .*$/gm, "")}
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--paper-surface-app); color: var(--paper-text); font-family: var(--paper-font-family); }
.state { display: flex; flex-direction: column; align-items: center; gap: var(--paper-uigap-half); padding: var(--paper-uigap-double) var(--paper-uigap); text-align: center; }
.icon { width: var(--paper-icon-size-huge); height: var(--paper-icon-size-huge); fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.connected { color: var(--paper-success); }
.not-connected { color: var(--paper-text-faint); }
.title { margin: 0; font-size: var(--paper-text-size-4); font-weight: 600; }
.description { margin: 0; font-size: var(--paper-text-size-2); color: var(--paper-text-subtle); }
</style>
</head>
<body>
<main class="state">
<svg class="icon ${outcome}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[outcome]}</svg>
<h1 class="title">${text.title}</h1>
<p class="description">${text.description}</p>${reason ? `\n<p class="description">${signInReasonHtml(reason)}</p>` : ""}
</main>
</body>
</html>`;
}
