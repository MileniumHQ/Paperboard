// A tool server's sign-in in the real Tools page over the real service
// (test/support/panel.ts), on another device than the agent's: the page is a
// frame of a stand-in for Paperboard's shell, which catches the browser
// coming back to the sign-in's loopback address at once and hands the
// address over (PaperAPI's catchLoopbackSignIn asks it over postMessage, as
// in Paperboard). The service refuses it (it came back from another
// sign-in), and the sign-in keeps waiting: the address can still be pasted,
// instead of waiting for a browser that has already come back. The server and
// its authorization server are on loopback in this test.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bootPanel, PANEL_DOC, type BootedPanel, type Page } from "./support/panel";
import { WIRE } from "./support/wire";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };

/** an MCP server that wants a bearer token, and its authorization server */
async function oauthServer(): Promise<{ base: string; close: () => Promise<void> }> {
    let base = "";
    const json = (res: http.ServerResponse, status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const server = http.createServer((req, res) => {
        const url = new URL(req.url!, base);
        req.resume();
        req.on("end", () => {
            if (url.pathname === "/.well-known/oauth-protected-resource/mcp") return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [`${base}/as`] });
            if (url.pathname === "/.well-known/oauth-authorization-server/as") {
                return json(res, 200, {
                    issuer: `${base}/as`,
                    authorization_endpoint: `${base}/as/authorize`,
                    token_endpoint: `${base}/as/token`,
                    registration_endpoint: `${base}/as/register`,
                    code_challenge_methods_supported: ["S256"],
                });
            }
            if (url.pathname === "/as/register") return json(res, 201, { client_id: "paperboard-1", token_endpoint_auth_method: "none" });
            if (url.pathname === "/mcp") return void res.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` }).end();
            res.writeHead(404).end();
        });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, close: () => new Promise((ok) => server.close(() => ok())) };
}

// The shell's side: the browser came back at once, to the address the frame asked about, with a code from
// another sign-in (its state isn't this one's). What it handed over is kept in window.handed.
const SHELL = `
window.handed = [];
window.addEventListener("message", (event) => {
    if (event.data?.type !== "paperboard:loopback-redirect") return;
    const { generation, requestId, redirectUri } = event.data;
    const caught = new URL(redirectUri);
    caught.searchParams.set("code", "caught");
    caught.searchParams.set("state", "another-sign-in");
    window.handed.push(caught.href);
    event.source.postMessage({ type: "paperboard:loopback-redirect-result", generation, requestId, result: { status: "caught", url: caught.href } }, "*");
});`;

let server: Awaited<ReturnType<typeof oauthServer>>;
let panel: BootedPanel;
let page: Page;
beforeAll(async () => {
    server = await oauthServer();
    const echo = { name: "echo", where: "host", transport: "http", url: `${server.base}/mcp`, headers: {}, oauth: true, sse: false, enabled: true };
    panel = await bootPanel({ settings: SETTINGS, tools: { actions: false, servers: [echo] } });
    page = await panel.open({ init: WIRE, shell: SHELL });
});
afterAll(async () => {
    await panel?.close();
    await server?.close();
});

/** `expr` read in the panel's frame: its `document` is the panel's */
const inPanel = (expr: string) => `((document) => ${expr})(${PANEL_DOC})`;
const click = (selector: string) => page.evaluate(inPanel(`document.querySelector(${JSON.stringify(selector)}).click()`));

describe("a tool server's sign-in, on another device", () => {
    test("a caught address the service refuses says why, and the address can be pasted", async () => {
        await page.waitFor(inPanel(`document?.querySelector('[aria-label="Ada: computer and settings"]')`), "the chat");
        await click('[aria-label="Ada: computer and settings"]');
        await page.waitFor(inPanel(`document.querySelector('input[name="ai-pages"][value="tools"]')`), "the menu");
        await click('input[name="ai-pages"][value="tools"]');
        const signIn = `[...document.querySelectorAll("button")].find((b) => b.innerText.trim().endsWith("Sign in"))`;
        await page.waitFor(inPanel(signIn), "echo's Sign in");
        await page.evaluate(inPanel(`${signIn}.click()`));

        await page.waitFor(inPanel(`document.body.innerText.includes("that address is from a different sign-in")`), "the refusal");
        const handed = await page.evaluate<string[]>(`window.handed`);
        expect(handed).toHaveLength(1);
        expect(handed[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback\?code=caught&state=another-sign-in$/);
        // what the shell caught is what the service was handed
        expect(await page.evaluate(`${PANEL_DOC}.defaultView.__wireApi.sent("finish-server-sign-in")`)).toEqual([{ name: "echo", address: handed[0] }]);
        await page.waitFor(inPanel(`[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("Sign in to echo"))?.querySelector('input[autocomplete="off"]')`), "the address field");
        expect(page.exceptions).toEqual([]);
    });
});
