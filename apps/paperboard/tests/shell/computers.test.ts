// The computer list the shell gets: it never carries a paired computer's
// token or certificate.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, type Shell } from "./support/shell";

let shell: Shell;
let workshop: Awaited<ReturnType<Shell["pairComputer"]>>;

beforeAll(async () => {
    shell = await bootShell();
    workshop = await shell.pairComputer("Workshop");
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Security — pairing answers the shell with the computer's id alone, never its token or certificate.
test("pairing a computer answers the shell with its id and nothing else", () => {
    expect(workshop.answer).toEqual({ id: workshop.id });
});

// Inventory: Security — the shell's computer list never carries a pairing's token or pinned certificate.
test("the computer list the shell gets has no paired computer's token or certificate", async () => {
    const { result: listed } = await shell.page.evaluate<{ result: { computers: Record<string, unknown>[] } }>(
        `fetch("/_shell/invoke/computers-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then((r) => r.json())`,
    );
    const paired = listed.computers.find((c) => c.id === workshop.id);
    expect(paired?.host).toBe("127.0.0.2");
    expect(listed.computers.every((c) => !("token" in c) && !("cert" in c))).toBe(true);
});
