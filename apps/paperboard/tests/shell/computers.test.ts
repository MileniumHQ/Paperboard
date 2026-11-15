// The computer rail and its dialogs in the real shell: what a pushed computer
// list keeps, and how often a dialog checks a computer. Everything waits on
// what the page does, never on a delay.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, clickText, type Shell } from "./support/shell";

let shell: Shell;
let workshop: Awaited<ReturnType<Shell["pairComputer"]>>;
const rail = (label: string) => `[role=radio][aria-label=${JSON.stringify(label)}]`;
const LOCAL = rail("This Computer (127.0.0.1)");
const WORKSHOP = rail("Workshop (127.0.0.2)");
const SHED = rail("Shed (127.0.0.2)");

beforeAll(async () => {
    shell = await bootShell();
    workshop = await shell.pairComputer("Workshop");
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — a pushed computer list keeps every computer's elements and what is being typed.
test("a computer list pushed while a new name is being typed keeps every computer's elements and the typing", async () => {
    const { page } = shell;
    await page.click(LOCAL);
    await page.waitFor(`document.querySelector("label[data-value='library']")`, "this computer's sidebar");
    await page.click(WORKSHOP, "right");
    await page.waitFor(`document.querySelector("[data-context-item='Change Name']")`, "Workshop's menu");
    await page.click("[data-context-item='Change Name']");
    await page.waitFor(`document.querySelector("input[placeholder='Name']")?.value === "Workshop"`, "Change Name to open on Workshop's name");
    await page.evaluate(`document.querySelector("input[placeholder='Name']").select()`);
    await page.type("input[placeholder='Name']", "Garage");
    // every element the push could rebuild, marked
    await page.evaluate(`(() => {
        for (const selector of [${JSON.stringify(LOCAL)}, ${JSON.stringify(WORKSHOP)}, "label[data-value='library']", "input[placeholder='Name']"]) {
            document.querySelector(selector).dataset.kept = "yes";
        }
    })()`);

    // Workshop renamed elsewhere (another window, another tab) while this
    // dialog is open: the whole list is pushed again
    expect(await shell.host({ cmd: "rename", id: workshop.id, name: "Shed" })).toBe(true);
    await page.waitFor(`document.querySelector(${JSON.stringify(SHED)})`, "the renamed computer in the rail");

    expect(await page.evaluate(`[...document.querySelectorAll("[data-kept]")].length`)).toBe(4);
    expect(await page.evaluate(`document.querySelector(${JSON.stringify(LOCAL)}).dataset.kept`)).toBe("yes");
    expect(await page.evaluate(`document.querySelector(${JSON.stringify(SHED)}).dataset.kept`)).toBe("yes");
    expect(await page.evaluate(`document.querySelector("label[data-value='library']").dataset.kept`)).toBe("yes");
    expect(await page.evaluate(`document.querySelector("input[placeholder='Name']").value`)).toBe("Garage");

    await clickText(page, "button", "Cancel");
    await page.waitFor(`!document.querySelector("input[placeholder='Name']")`, "Change Name to close");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a computer that refuses a panel file says why, in its own words.
test("a panel file another computer refuses answers with that computer's reason", async () => {
    const answer = await shell.page.evaluate<[number, string]>(
        `fetch("/_panel/${workshop.id}/dev.example.missing/index.html").then(async (r) => [r.status, await r.text()])`,
    );
    expect(answer[0]).toBe(404);
    expect(answer[1]).toMatch(/^\w+ refused dev\.example\.missing\/index\.html: File Not Found$/);
});

// Inventory: Core contracts — a check that answers late never stands for what is typed now.
test("Add Computer: a check of an earlier address that answers late does not enable Next", async () => {
    const { page } = shell;
    // which probes the page asked, and which answers it has taken in: an
    // answer counts once every step the page takes on it has run
    await page.evaluate(`(() => {
        const seen = { asked: [], answered: [] };
        const waiting = [];
        const note = (list, host) => {
            seen[list].push(host);
            for (const check of waiting.splice(0)) check();
        };
        window.__probeSeen = (list, host) => new Promise((resolve) => {
            const check = () => (seen[list].includes(host) ? resolve(true) : waiting.push(check));
            check();
        });
        const fetch = window.fetch;
        window.fetch = async (input, init) => {
            if (!String(input).endsWith("/computer-probe")) return fetch(input, init);
            const { host } = JSON.parse(init.body).args[0];
            note("asked", host);
            const res = await fetch(input, init);
            const json = res.json.bind(res);
            res.json = async () => {
                const body = await json();
                // a task later, every step the page takes on the answer has run
                setTimeout(() => note("answered", host));
                return body;
            };
            return res;
        };
    })()`);
    const until = (list: "asked" | "answered", host: string) => page.evaluate(`window.__probeSeen(${JSON.stringify(list)}, ${JSON.stringify(host)})`);
    await shell.host({ cmd: "hold-probe", host: "127.0.0.2" });
    await shell.host({ cmd: "hold-probe", host: "127.0.0.3" });

    await page.click(`[role=button][aria-label='Add Computer'], button[aria-label='Add Computer']`);
    await clickText(page, "label", "Custom IP");
    await clickText(page, "button", "Next");
    await page.waitFor(`document.querySelector("input[placeholder='192.168.1.50']")`, "the address step");
    await page.evaluate(`document.querySelector("input[placeholder='45464']").select()`);
    await page.type("input[placeholder='45464']", String(workshop.daemon.port));
    // Workshop is up there: its check would find it
    await page.type("input[placeholder='192.168.1.50']", "127.0.0.2");
    await until("asked", "127.0.0.2");
    await page.evaluate(`document.querySelector("input[placeholder='192.168.1.50']").select()`);
    await page.type("input[placeholder='192.168.1.50']", "127.0.0.3");
    await until("asked", "127.0.0.3");

    await shell.host({ cmd: "release-probe", host: "127.0.0.2" });
    await until("answered", "127.0.0.2");
    expect(await page.evaluate(`[...document.querySelectorAll("button")].filter((b) => b.textContent.includes("Next")).pop().disabled`)).toBe(true);

    await shell.host({ cmd: "release-probe", host: "127.0.0.3" });
    await until("answered", "127.0.0.3");
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await page.waitFor(`!document.querySelector("input[placeholder='192.168.1.50']")`, "Add Computer to close");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a pairing that doesn't finish says why instead of leaving the wizard as it was.
test("Add Computer: a pairing answered without the computer says so", async () => {
    const { page } = shell;
    // main answers the pairing with nothing that names a computer
    await page.evaluate(`(() => {
        const fetch = window.fetch;
        window.fetch = (input, init) => String(input).endsWith("/computer-pair")
            ? Promise.resolve(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }))
            : fetch(input, init);
    })()`);
    await page.click(`[role=button][aria-label='Add Computer'], button[aria-label='Add Computer']`);
    await clickText(page, "label", "Custom IP");
    await clickText(page, "button", "Next");
    await page.waitFor(`document.querySelector("input[placeholder='192.168.1.50']")`, "the address step");
    await page.evaluate(`document.querySelector("input[placeholder='45464']").select()`);
    await page.type("input[placeholder='45464']", String(workshop.daemon.port));
    await page.type("input[placeholder='192.168.1.50']", "127.0.0.2");
    await page.waitFor(`![...document.querySelectorAll("button")].filter((b) => b.textContent.includes("Next")).pop().disabled`, "the address to be reachable");
    await clickText(page, "button", "Next");
    await page.waitFor(`document.querySelector("input[placeholder='123 456']")`, "the pairing step");
    await page.type("input[placeholder='123 456']", "123456");
    await clickText(page, "button", "Add Computer");
    await page.waitFor(`document.body.innerText.includes("The computer answered the pairing without saying who it is.")`, "the pairing's failure");
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await page.waitFor(`!document.querySelector("input[placeholder='123 456']")`, "Add Computer to close");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a network discovery that broke says why in Add Computer instead of an empty list.
test("Add Computer: when looking for computers on the network broke, the list says why", async () => {
    const { page } = shell;
    const WARNING = `document.querySelector("[role=alert]")?.textContent ?? ""`;
    const open = async () => {
        await page.click(`[role=button][aria-label='Add Computer'], button[aria-label='Add Computer']`);
        await page.waitFor(`[...document.querySelectorAll("label")].some((l) => l.textContent.includes("Custom IP"))`, "Add Computer to open");
    };
    const close = async () => {
        await page.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
        await page.waitFor(`![...document.querySelectorAll("label")].some((l) => l.textContent.includes("Custom IP"))`, "Add Computer to close");
    };

    // the network changes while nothing is open: the mDNS socket fails
    expect(await shell.host({ cmd: "fail-mdns", message: "send EHOSTUNREACH 224.0.0.251:5353" })).toBe(true);
    await open();
    await page.waitFor(`(${WARNING}).includes("Paperboard can't look for computers on this network: send EHOSTUNREACH 224.0.0.251:5353")`, "why nearby computers aren't listed");
    expect(await page.evaluate(`document.body.innerText.includes("Looking for computers on your network")`)).toBe(false);
    await close();
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — the can't-reach dialog checks once per opening and once per Try Again.
test("the can't-reach dialog checks the computer once when it opens and once per Try Again", async () => {
    const { page } = shell;
    await workshop.daemon.stop();
    const before = await shell.host<number>({ cmd: "probes" });
    await page.click(SHED);
    await page.waitFor(`document.body.innerText.includes("Can't reach Shed") && document.body.innerText.includes("Last error")`, "the can't-reach dialog with its answer");
    expect(await shell.host<number>({ cmd: "probes" })).toBe(before + 1);

    await clickText(page, "button", "Try Again");
    await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Try Again") && !b.disabled)`, "Try Again to answer");
    expect(await shell.host<number>({ cmd: "probes" })).toBe(before + 2);
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a panel on a computer that can't be reached says so, never that its file is missing.
test("a panel file from a computer that can't be reached answers 502 with why", async () => {
    await workshop.daemon.stop();
    const answer = await shell.page.evaluate<[number, string]>(
        `fetch("/_panel/${workshop.id}/dev.example.notes/index.html").then(async (r) => [r.status, await r.text()])`,
    );
    expect(answer[0]).toBe(502);
    // named as the rail names it (an earlier test renamed it)
    expect(answer[1]).toMatch(/^\w+ could not be reached: Connection refused/);
});

// Inventory: Security — the shell's computer list never carries a pairing's token or pinned certificate.
test("the computer list the shell gets has no paired computer's token or certificate", async () => {
    const { result: listed } = await shell.page.evaluate<{ result: { computers: Record<string, unknown>[] } }>(
        `fetch("/_shell/invoke/computers-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: [] }) }).then((r) => r.json())`,
    );
    const paired = listed.computers.find((c) => c.id === workshop.id);
    expect(paired?.host).toBe("127.0.0.2");
    expect(listed.computers.every((c) => !("token" in c) && !("cert" in c))).toBe(true);
});
