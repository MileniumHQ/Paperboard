import { afterEach, expect, test } from "bun:test";
import { startChrome } from "testkit/chrome";
import { Windows } from "../src/service/browserWindows";
import { Cdp } from "../src/service/cdp";
import { allowTestPort } from "./hermetic";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
});

// The agent's browser shows pages in the panel's light or dark theme: the windows open now, and each one after.
test("pages in the agent's browser follow the panel's theme, in open windows and new ones", async () => {
    const chrome = await startChrome();
    cleanups.push(() => chrome.stop());
    cleanups.push(allowTestPort(chrome.port));
    const { webSocketDebuggerUrl } = (await (await fetch(`http://127.0.0.1:${chrome.port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
    const cdp = await Cdp.connect(webSocketDebuggerUrl);
    cleanups.push(() => cdp.close());
    const windows = new Windows({ connection: () => cdp, note: () => {}, platform: "linux" });
    windows.listen(cdp);
    await cdp.send("Target.setDiscoverTargets", { discover: true });
    const dark = async (tab: Awaited<ReturnType<Windows["openWindow"]>>["tab"]) => windows.evaluate(tab, "matchMedia('(prefers-color-scheme: dark)').matches");

    const first = (await windows.openWindow("about:blank")).tab;
    await windows.setColorScheme("dark");
    expect(await dark(first)).toBe(true);
    const second = (await windows.openWindow("about:blank")).tab;
    expect(await dark(second)).toBe(true);

    await windows.setColorScheme("light");
    expect(await dark(first)).toBe(false);
    expect(await dark(second)).toBe(false);
}, 30_000);
