// How the shell reaches its daemon as it starts: a host that names the
// daemon by URL (Paperboard web) is connected to, not refused.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, type Shell } from "./support/shell";

let shell: Shell;

// a host that reaches the daemon some other way, as Paperboard web does,
// names it by URL: here the same daemon, at its loopback URL
const CREDENTIALS_BY_URL = `(() => {
    const fetch = window.fetch;
    window.fetch = function (input, init) {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/_shell/invoke/crane-credentials") && sessionStorage.getItem("credentialsByUrl")) {
            return fetch.call(this, input, init).then((res) => res.json()).then(({ ok, result, error }) => {
                const answer = ok ? { ok, result: { url: "ws://127.0.0.1:" + result.port, token: result.token, computerId: result.computerId } } : { ok, error };
                return new Response(JSON.stringify(answer), { status: 200 });
            });
        }
        return fetch.call(this, input, init);
    };
})()`;

beforeAll(async () => {
    shell = await bootShell({ init: CREDENTIALS_BY_URL });
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — a host that names its daemon by URL (Paperboard web) is connected to, not refused.
test("a host that gives its daemon's address as a URL connects the shell", async () => {
    const { page } = shell;
    await page.evaluate(`sessionStorage.setItem("credentialsByUrl", "yes")`);
    await page.navigate(await page.evaluate<string>("location.href"));
    await page.waitFor(`document.body.innerText.includes("Edit Home")`, "Home, connected through the URL");
    expect(await page.evaluate<string>("document.body.innerText")).not.toContain("could not connect");
    expect(page.exceptions).toEqual([]);
    await page.evaluate(`sessionStorage.removeItem("credentialsByUrl")`);
});
