// Home on a phone (bootShell({ phone: true })), once a computer is paired:
// its tiles are small, and each still says all it shows.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, type Shell } from "./support/shell";

let shell: Shell;

beforeAll(async () => {
    shell = await bootShell({ phone: true });
    await shell.pairComputer("Shed");
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Home — a small tile keeps its bar, and a ring names every slice it draws.
test("on a phone, Disk keeps its bar, and CPU and Memory name every slice of their rings in words that fit", async () => {
    const { page } = shell;
    const disk = `document.querySelector('[aria-label^="Disk on Shed"]')`;
    await page.waitFor(`${disk}?.querySelector("[role=progressbar]")`, "the Disk tile");
    // the bar is drawn, not left out for want of room
    await page.waitFor(`${disk}.querySelector("[role=progressbar]").offsetHeight > 0`, "Disk's bar, drawn");

    for (const title of ["CPU", "Memory"]) {
        const ring = `document.querySelector('[aria-label^="${title} on Shed,"]')`;
        await page.waitFor(`${ring}?.getAttribute("aria-label").includes(": ")`, `the ${title} ring`);
        const said = await page.evaluate<{ slices: string[]; rows: string[]; cut: string[] }>(`(() => {
            const ring = ${ring};
            const slices = ring.getAttribute("aria-label").split(": ").slice(1).join(": ").split(", ").map((s) => s.replace(/ [\\d.<]+.*$/, ""));
            const items = [...ring.closest("[class*=usageBody]").querySelectorAll("li")];
            const labels = items.map((li) => [...li.querySelectorAll("*")].filter((el) => el.children.length === 0 && el.textContent.trim())[0]);
            return {
                slices,
                rows: labels.map((el) => el.textContent.trim()).filter((t) => t !== "Free"),
                cut: labels.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent.trim()),
            };
        })()`);
        // every slice the ring draws is a row of its legend, and no row is cut short
        expect(said.slices.sort()).toEqual(said.rows.sort());
        expect(said.cut).toEqual([]);
    }
    expect(page.exceptions).toEqual([]);
});
