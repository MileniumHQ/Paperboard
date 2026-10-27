// Build with failures.vite.ts and open /test/fixtures/failures.html. The real tabs against a
// service and vault that fail on cue: every failure must be shown, never read as "offline" or
// a stuck "Generating…", and a reset must stop at a failed step instead of overwriting the
// saved commands or claiming success with the token still stored.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi, config, secretsApi } from "@mileniumhq/paperapi";

const failing = new Set<string>();
const writes: unknown[] = [];
let configReads = 0;
let readsBeforeFailure = Infinity;
const saved = { configured: true, applicationId: "123456789012345678", commands: [] };
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.onTrigger = (() => () => {}) as typeof actionsApi.onTrigger;
actionsApi.call = (async (_panel: string, action: string) => {
    if (failing.has(action)) throw new Error(`${action} is down`);
    if (action === "get-health") return { connected: true, lastError: null, uptimeMs: 1000, wsPing: 40, guildCount: 1, cachedUsers: 2, cachedChannels: 3, commandsReceived: 4, pendingInteractions: 0, commandSyncError: null };
    if (action === "get-bot-info") return { name: "Bot", connected: true, recentMessages: [] };
    if (action === "list-guilds") return [];
    if (action === "get-invite-url" || action === "get-user-install-url") return "https://discord.com/oauth2/authorize?client_id=1";
    return true;
}) as typeof actionsApi.call;
(config as any).get = async () => {
    configReads++;
    if (configReads > readsBeforeFailure) throw new Error("config is down");
    return structuredClone(saved);
};
(config as any).set = async (value: unknown) => {
    writes.push(value);
};
(secretsApi as any).delete = async () => {
    if (failing.has("vault")) throw new Error("vault is down");
    return true;
};

const { default: Commands } = await import("../../src/components/Commands");
const { default: Overview } = await import("../../src/components/Overview");
const { default: Invite } = await import("../../src/components/Invite");
const { default: Configuration } = await import("../../src/components/Configuration");
const root = document.getElementById("app")!;
let dispose = () => {};
const wait = async (predicate: () => boolean, label: string) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`${label} (page: ${(document.body.textContent ?? "").slice(0, 300)})`);
};
const text = () => document.body.textContent ?? "";
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].reverse().find((b) => b.textContent?.trim() === label);
const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); };
const mount = (Tab: () => any) => {
    dispose();
    dispose = render(() => <PaperProvider><Tab /></PaperProvider>, root);
};

try {
    failing.clear();
    failing.add("get-health");
    mount(Commands);
    await wait(() => text().includes("get-health is down"), "Commands must show a failed health read");
    assert(!text().includes("Bot offline"), "Commands must not call an unknown connection offline");

    mount(Overview);
    await wait(() => text().includes("Couldn't check health"), "Overview must show a failed health read");
    assert(!text().includes("Commands received"), "Overview must not show a health table of zeros");

    failing.clear();
    failing.add("get-invite-url");
    mount(Invite);
    await wait(() => text().includes("Couldn't make the invite link"), "Invite must show a failed link");
    assert(!text().includes("Generating invite link"), "Invite must not keep generating after a failure");

    for (const [label, setup] of [
        ["the vault", () => failing.add("vault")],
        ["the saved settings", () => { readsBeforeFailure = configReads; }],
    ] as const) {
        failing.clear();
        readsBeforeFailure = Infinity;
        writes.length = 0;
        let reset = false;
        dispose();
        dispose = render(() => <PaperProvider><Configuration onReset={() => { reset = true; }} /></PaperProvider>, root);
        await wait(() => text().includes(saved.applicationId), "Configuration must load");
        await wait(() => !button("Cancel"), "the last reset modal must be gone");
        setup();
        button("Reset")!.click();
        await wait(() => Boolean(button("Cancel")), "the reset modal must open");
        button("Reset")!.click();
        await wait(() => text().includes("Reset incomplete"), `a reset with ${label} failing must say it stopped`);
        assert(!reset, `a reset with ${label} failing must not finish`);
        assert(writes.length === 0, `a reset with ${label} failing must not save over the settings`);
    }
    document.getElementById("result")!.textContent = "PASS";
} catch (err) {
    document.getElementById("result")!.textContent = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
} finally {
    dispose();
}
