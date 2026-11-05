import {
    PaperCode,
    PaperFlex,
    PaperTable,
    PaperText,
    PaperTextList,
} from "@mileniumhq/paperui";

export default function LoopbackApiDoc() {
    return (
        <PaperFlex direction="column" gap="double" fullWidth>
            <PaperText preset="header" as="h1">catchLoopbackRedirect</PaperText>
            <PaperText preset="body" as="p">
                catchLoopbackRedirect catches one browser redirect to a loopback address, such as <PaperCode>http://localhost:1455/auth/callback</PaperCode>, on the person's device, and hands the panel the address the browser landed on.
                It works only on a panel page in the Paperboard app.
                Use it for an installed-app sign-in (OAuth with a loopback redirect) run by a program the panel started on its computer, such as a command-line tool's browser sign-in.
            </PaperText>
            <PaperText preset="body" as="p">
                The browser sends the person to localhost on their own device. When the panel runs on another computer, the program listening there never sees it.
                Paperboard listens on the person's device instead, and the panel passes the address to its program, usually through its service.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="usage">Usage</PaperText>
            <PaperCode block language="tsx">
{`import { catchLoopbackRedirect, LoopbackRedirectError } from "@mileniumhq/paperapi";

// the program printed its sign-in page; open it, then wait for the redirect
window.open(signInUrl, "_blank");
const controller = new AbortController();
try {
    const result = await catchLoopbackRedirect("http://localhost:1455/auth/callback", { signal: controller.signal });
    // "local": the program runs on this device and receives the redirect itself
    if (result.status === "caught") await deliverRedirect(result.url);
} catch (err) {
    if (err instanceof LoopbackRedirectError && err.code === "unavailable") showPasteAddressField();
    else showError(err);
}`}
            </PaperCode>
            <PaperText preset="body" as="p">
                Start waiting before the browser can finish the sign-in. Call <PaperCode>controller.abort()</PaperCode> when the person cancels, or when the program reports the sign-in done another way.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="api">API</PaperText>
            <PaperCode block language="tsx">
{`catchLoopbackRedirect(redirectUri: string, options?: { signal?: AbortSignal }): Promise<LoopbackRedirectResult>;

type LoopbackRedirectResult =
    /** the full address the browser requested, e.g. "http://localhost:1455/auth/callback?code=...&state=..." */
    | { status: "caught"; url: string }
    /** the panel runs on this device: the program it started receives the redirect itself */
    | { status: "local" };

class LoopbackRedirectError extends Error {
    readonly code: LoopbackRedirectErrorCode;
}

type LoopbackRedirectErrorCode = "invalid-request" | "unavailable" | "in-use" | "busy" | "canceled" | "timeout" | "failed";`}
            </PaperCode>
            <PaperText preset="body" as="p">
                <PaperCode>redirectUri</PaperCode> is the address the program gave the sign-in page: <PaperCode>http</PaperCode>, on <PaperCode>localhost</PaperCode>, <PaperCode>127.0.0.1</PaperCode> or <PaperCode>[::1]</PaperCode>, with a port from 1024 to 65535 and a path.
                The caught address keeps that host and port, followed by the path and query the browser asked for.
            </PaperText>

            <PaperText preset="subheader" as="h2" id="behavior">Behavior</PaperText>
            <PaperTextList>
                <li>For a panel on this computer, it resolves <PaperCode>local</PaperCode> right away and listens on nothing.</li>
                <li>Otherwise the app listens on <PaperCode>127.0.0.1</PaperCode>, and on <PaperCode>[::1]</PaperCode> where the device has it, at the redirect's port.</li>
                <li>Only a GET for the redirect's path is caught. Any other path gets a 404 and the wait goes on.</li>
                <li>The browser tab gets a page asking the person to return to Paperboard. The port closes before the call settles.</li>
                <li>A page waits for one redirect at a time, and only one wait can use a port across the app.</li>
                <li>The wait stops when <PaperCode>signal</PaperCode> aborts, the page goes away, the panel closes, or after 15 minutes.</li>
            </PaperTextList>

            <PaperText preset="subheader" as="h2" id="errors">Errors</PaperText>
            <PaperTable>
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td><PaperCode>invalid-request</PaperCode></td><td><PaperCode>redirectUri</PaperCode> is not a loopback redirect as described above.</td></tr>
                    <tr><td><PaperCode>unavailable</PaperCode></td><td>A widget, a page outside Paperboard, or Paperboard in a web browser, which cannot listen on the person's device. Offer a field to paste the address the browser ended on.</td></tr>
                    <tr><td><PaperCode>in-use</PaperCode></td><td>Another program on the person's device holds the port. The message names it.</td></tr>
                    <tr><td><PaperCode>busy</PaperCode></td><td>This page is already waiting, or another panel waits on the same port.</td></tr>
                    <tr><td><PaperCode>canceled</PaperCode></td><td><PaperCode>signal</PaperCode> aborted, or the panel closed.</td></tr>
                    <tr><td><PaperCode>timeout</PaperCode></td><td>No redirect came within 15 minutes.</td></tr>
                    <tr><td><PaperCode>failed</PaperCode></td><td>Anything else, such as the port being impossible to open. The message says why.</td></tr>
                </tbody>
            </PaperTable>
        </PaperFlex>
    );
}
