// What the shell reads from its host as it starts, failing: it says so on
// screen instead of carrying on as if nothing happened.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, type Shell } from "./support/shell";

let shell: Shell;

// the host answers the launch options and the app version with its handler's failure
const FAIL_STARTUP_READS = `(() => {
    const fetch = window.fetch;
    window.fetch = function (input, init) {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/_shell/invoke/launch-options") || url.endsWith("/_shell/invoke/app-version")) {
            return Promise.resolve(new Response(JSON.stringify({ ok: false, error: "The host lost its command line" }), { status: 200 }));
        }
        return fetch.call(this, input, init);
    };
})()`;

beforeAll(async () => {
    shell = await bootShell({ init: FAIL_STARTUP_READS });
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — a failure reading how Paperboard was started is shown, not only logged.
test("launch options and the version that can't be read are said on screen, and the desktop layout still shows", async () => {
    const { page } = shell;
    await page.waitFor(
        `[...document.querySelectorAll("[role=region][aria-label=Notifications] [role=alert]")].some((t) => t.innerText.includes("Couldn't read how Paperboard was started") && t.innerText.includes("The host lost its command line"))`,
        "the launch options' failure",
    );
    await page.waitFor(`document.body.innerText.includes("Version unknown")`, "the version label to say it is unknown");
    // the desktop layout: Home, beside the rail
    await page.waitFor(`document.body.innerText.includes("Edit Home")`, "Home");
    expect(page.exceptions).toEqual([]);
});
