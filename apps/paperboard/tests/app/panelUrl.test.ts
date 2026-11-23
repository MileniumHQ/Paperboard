// panelUrl: where the shell loads a panel from, per host. Electron gives
// each panel its own panel:// origin; a browser host gives it a folder under
// /_panel/ on the shell's own origin.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const saved = { window: (globalThis as any).window, location: (globalThis as any).location };
let shell: typeof import("../../src/renderer/src/lib/shell");

beforeAll(async () => {
    // paperapi wires its frame listeners on import
    (globalThis as any).window = { addEventListener: () => undefined, removeEventListener: () => undefined };
    const url = new URL("https://app.example.com/");
    (globalThis as any).location = { protocol: url.protocol, host: url.host, origin: url.origin };
    shell = await import("../../src/renderer/src/lib/shell");
});

afterAll(() => {
    (globalThis as any).window = saved.window;
    (globalThis as any).location = saved.location;
});

describe("panelUrl in a browser host", () => {
    test("the panel's folder on the shell's own origin", () => {
        expect(shell.panelUrl("k3m9x2", "dev.paperboard.terminal", "?generation=1")).toBe(
            "https://app.example.com/_panel/k3m9x2/dev.paperboard.terminal/?generation=1",
        );
        expect(shell.panelUrl("k3m9x2", "dev.paperboard.terminal", "./branding/icon.png")).toBe(
            "https://app.example.com/_panel/k3m9x2/dev.paperboard.terminal/branding/icon.png",
        );
        expect(shell.panelUrl("k3m9x2", "dev.paperboard.terminal", "widget.html?generation=2")).toBe(
            "https://app.example.com/_panel/k3m9x2/dev.paperboard.terminal/widget.html?generation=2",
        );
    });
});
