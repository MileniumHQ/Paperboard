// What the shell reads from its host as it starts, failing: it says so on
// screen instead of carrying on as if nothing happened. So does a start-up
// that can't go where App Settings says.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { bootShell, type Shell } from "./support/shell";

let shell: Shell;

// the host answers the launch options and the app version with its
// handler's failure, and the daemon's credentials too once a test asks
const FAIL_STARTUP_READS = `(() => {
    const fetch = window.fetch;
    const refuse = (error) => Promise.resolve(new Response(JSON.stringify({ ok: false, error }), { status: 200 }));
    window.fetch = function (input, init) {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/_shell/invoke/launch-options") || url.endsWith("/_shell/invoke/app-version")) {
            return refuse("The host lost its command line");
        }
        if (url.endsWith("/_shell/invoke/crane-credentials") && sessionStorage.getItem("failCredentials")) {
            return refuse("The host has no server credentials");
        }
        return fetch.call(this, input, init);
    };
})()`;

// every toast's text as it appears, so one that has timed out is still read
const RECORD_TOASTS = `(() => {
    window.__toasts = [];
    new MutationObserver(() => {
        for (const t of document.querySelectorAll("[aria-label=Notifications] [role=status], [aria-label=Notifications] [role=alert]")) {
            if (!window.__toasts.includes(t.innerText)) window.__toasts.push(t.innerText);
        }
    }).observe(document, { childList: true, subtree: true, characterData: true });
})()`;

beforeAll(async () => {
    shell = await bootShell({
        init: `${FAIL_STARTUP_READS};${RECORD_TOASTS}`,
        // App Settings opens Paperboard on a computer this one has never paired
        seed: (dataDir) =>
            fs.writeFileSync(
                path.join(dataDir, "local", "app-settings.json"),
                JSON.stringify({ darkMode: "system", reducedMotion: false, runOnStartup: false, startOn: "a-forgotten-computer" }),
            ),
    });
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

// Inventory: Core contracts — a start-up that can't open where App Settings says tells the person, not only the log.
test("opening on a computer that isn't listed opens Home and says so", async () => {
    const { page } = shell;
    await page.waitFor(`window.__toasts.some((t) => t.includes("Opened Home instead"))`, "a toast saying Home opened instead");
    await page.waitFor(`document.body.innerText.includes("Edit Home")`, "Home");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a shell that can't reach its local server says why, and offers to try again.
test("a shell that can't connect to its local server says why on screen", async () => {
    const { page } = shell;
    await page.evaluate(`sessionStorage.setItem("failCredentials", "yes")`);
    await page.navigate(await page.evaluate<string>("location.href"));
    await page.waitFor(
        `document.body.innerText.includes("Paperboard could not connect to its local server: The host has no server credentials")`,
        "the connection failure and why",
    );
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll("button")].map((b) => b.textContent)`)).toEqual(["Retry"]);
    await page.evaluate(`sessionStorage.removeItem("failCredentials")`);
});
