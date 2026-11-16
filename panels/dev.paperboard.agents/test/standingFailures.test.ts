// Failures that stand in the service's own state, in a real browser over the
// real service (test/support/panel.ts): a memory it can't read, a routine
// whose last run failed, and a tools file that doesn't parse. Each stays
// until what caused it goes, so each is said in place, as a PaperError where
// it happened, never as a toast: a toast goes by itself, and the failure
// would stay with nothing saying so. Each is there when its page opens, so
// none is an alert.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { Routines } from "../src/service/routines";
import { bootPanel, openSection, type BootedPanel, type Page } from "./support/panel";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
const RUN_FAILED = "The mail server refused the sign-in";

const TOASTS = `[...document.querySelectorAll("[data-paper-toasts] [role=alert], [data-paper-toasts] [role=status]")].map((a) => a.innerText)`;
/** the failures said in place on the page: each PaperError's name, role, words and buttons */
const ERRORS = `[...document.querySelectorAll("[role=dialog] [data-paper-error]")].map((e) => ({ title: e.getAttribute("aria-label"), role: e.getAttribute("role"), text: e.innerText, buttons: [...e.querySelectorAll("button")].map((b) => b.innerText.trim()) }))`;

interface Said {
    title: string;
    role: string;
    text: string;
    buttons: string[];
}

let panel: BootedPanel;
let page: Page;
const seen: Record<string, { errors: Said[]; toasts: string[]; page: string }> = {};

/** Opens `section` and keeps what it says once `title` is said there. */
async function look(section: string, title: string) {
    await openSection(page, "Ada", section);
    await page.waitFor(`${ERRORS}.some((e) => e.title === ${JSON.stringify(title)})`, `${title} on the ${section} page`);
    seen[section] = { errors: await page.evaluate(ERRORS), toasts: await page.evaluate(TOASTS), page: await page.evaluate(`document.querySelector("[role=dialog]").innerText`) };
}

beforeAll(async () => {
    panel = await bootPanel({
        settings: SETTINGS,
        // memory's index is there, and isn't one
        storage: { "memory/index.json": "{ not an index" },
        // the tools file doesn't parse
        tools: "{ not a tools file",
        // two routines, written by the service's own store; the second's last run failed
        seed: async (storage) => {
            const file = path.join(storage, "routines.json");
            const routines = new Routines({ file, run: () => {}, onChange: () => {} });
            await routines.load();
            await routines.add("Water the plants", { kind: "every", minutes: 60 });
            await routines.add("Check the mail", { kind: "every", minutes: 60 });
            await routines.shutdown();
            const doc = JSON.parse(fs.readFileSync(file, "utf8"));
            doc.routines[1].lastRun = 1_700_000_000_000;
            doc.routines[1].lastError = RUN_FAILED;
            fs.writeFileSync(file, JSON.stringify(doc));
        },
    });
    page = await panel.open();
    await look("memories", "Couldn't read the memory");
    await look("routines", "Couldn't run “Check the mail”");
    await look("tools", "Couldn't read Ada's tools file");
});
afterAll(() => panel?.close());

describe("a failure that stands in the service", () => {
    test("memory it can't read fills the page with why, and Try again", () => {
        const { errors, toasts } = seen.memories!;
        expect(toasts, "a failure that stands is a toast").toEqual([]);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ title: "Couldn't read the memory", role: "region", buttons: ["Try again"] });
        expect(errors[0]!.text).toContain("index.json");
    });

    test("a routine whose last run failed says so over the routines, which stay", () => {
        const { errors, toasts, page: text } = seen.routines!;
        expect(toasts).toEqual([]);
        expect(errors, "only the routine that failed says so").toHaveLength(1);
        expect(errors[0]).toMatchObject({ title: "Couldn't run “Check the mail”", role: "region", buttons: [] });
        expect(errors[0]!.text).toContain(RUN_FAILED);
        expect(text).toContain("Water the plants");
        expect(text).toContain("Check the mail");
    });

    test("a tools file that doesn't parse says why over the tool servers, with Try again", () => {
        const { errors, toasts, page: text } = seen.tools!;
        expect(toasts).toEqual([]);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ title: "Couldn't read Ada's tools file", role: "region", buttons: ["Try again"] });
        expect(errors[0]!.text.replace("Couldn't read Ada's tools file", "").trim(), "it doesn't say why").not.toBe("Try again");
        expect(text).toContain("Fix or delete tools.json");
        expect(page.exceptions).toEqual([]);
    });
});
