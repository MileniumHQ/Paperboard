// A computer reached through a host relay in the real shell. Such a host
// lists it with `via`; this suite's host lists computers as the desktop
// does, so once pairing is done the page marks one with `via` in every list
// it gets, the one it asks for and the ones pushed.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, errorShown, type Shell } from "./support/shell";

const THROUGH_RELAY = `(() => {
    const mark = (data) => {
        if (window.__throughRelay) for (const c of data?.computers ?? []) if (c.name === "pxlblade") c.via = "Remote Relay";
        return data;
    };
    const fetch = window.fetch;
    window.fetch = async (input, init) => {
        const res = await fetch(input, init);
        if (!String(input).endsWith("/_shell/invoke/computers-list")) return res;
        const body = await res.json();
        return new Response(JSON.stringify({ ...body, result: mark(body.result) }), { status: res.status, headers: res.headers });
    };
    const listen = EventSource.prototype.addEventListener;
    EventSource.prototype.addEventListener = function (type, listener, options) {
        if (type !== "computers-changed") return listen.call(this, type, listener, options);
        return listen.call(this, type, (event) => listener({ data: JSON.stringify(mark(JSON.parse(event.data))) }), options);
    };
})()`;

let shell: Shell;
let pxlblade: Awaited<ReturnType<Shell["pairComputer"]>>;

beforeAll(async () => {
    shell = await bootShell({ init: THROUGH_RELAY });
    pxlblade = await shell.pairComputer("pxlblade");
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — the can't-reach dialog for a computer with `via` never names an address it doesn't have.
test("the can't-reach dialog for a relayed computer shows its answer without an address", async () => {
    const { page } = shell;
    await page.evaluate(`window.__throughRelay = true`);
    // the stop is pushed, now as a relay host lists it: by name alone
    await pxlblade.daemon.stop();
    const rail = `[role=radio][aria-label="pxlblade"]`;
    await page.waitFor(`document.querySelector(${JSON.stringify(rail)})`, "pxlblade on the rail, through a relay");
    await page.click(rail);
    await page.waitFor(`document.body.innerText.includes("Can't reach pxlblade") && ${errorShown("Couldn't reach this computer")}`, "the can't-reach dialog with its answer");
    const dialog = await page.evaluate<string>(`document.querySelector("[role=dialog]").innerText`);
    expect(dialog).not.toContain("127.0.0.2");
    expect(dialog).not.toContain("Nothing responded");
    expect(page.exceptions).toEqual([]);
});
