// Build with failures.vite.ts and open /test/fixtures/failures.html. The real tabs against a
// service that fails on cue: every failure must be shown, never read as "offline" or a stuck
// "Generating…", and a delete the service refuses must say so and leave the bot in place.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi } from "@mileniumhq/paperapi";
import type { BotSummary } from "../../src/bots";

const failing = new Set<string>();
const bot: BotSummary = {
    id: "b-fixture",
    name: "Bot",
    avatar: "",
    applicationId: "123456789012345678",
    enabled: true,
    connected: true,
    hasToken: true,
    lastError: null,
    guildCount: 1,
    createdAt: 1,
};
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.onTrigger = (() => () => {}) as typeof actionsApi.onTrigger;
actionsApi.call = (async (_panel: string, action: string) => {
    if (failing.has(action)) throw new Error(`${action} is down`);
    if (action === "get-health") return { connected: true, lastError: null, uptimeMs: 1000, wsPing: 40, guildCount: 1, cachedUsers: 2, cachedChannels: 3, commandsReceived: 4, pendingInteractions: 0, commandSyncError: null };
    if (action === "get-bot-info") return { name: "Bot", connected: true, recentMessages: [] };
    if (action === "list-guilds" || action === "list-commands") return [];
    if (action === "delete-bot") throw new Error("Couldn't delete its token: vault is down");
    if (action === "get-invite-url" || action === "get-user-install-url") return "https://discord.com/oauth2/authorize?client_id=1";
    return true;
}) as typeof actionsApi.call;

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
const mount = (Tab: (props: { bot: () => BotSummary }) => any) => {
    dispose();
    dispose = render(() => <PaperProvider><Tab bot={() => bot} /></PaperProvider>, root);
};

try {
    failing.clear();
    failing.add("get-health");
    mount(Commands);
    await wait(() => text().includes("get-health is down"), "Commands must show a failed health read");
    assert(!text().includes("Bot offline"), "Commands must not call an unknown connection offline");

    mount((props) => <Overview bot={props.bot} onSetEnabled={async () => true} />);
    await wait(() => text().includes("Couldn't check health"), "Overview must show a failed health read");
    assert(!text().includes("Commands received"), "Overview must not show a health table of zeros");

    failing.clear();
    failing.add("get-invite-url");
    mount(Invite);
    await wait(() => text().includes("Couldn't make the invite link"), "Invite must show a failed link");
    assert(!text().includes("Generating invite link"), "Invite must not keep generating after a failure");

    failing.clear();
    let deleted = false;
    dispose();
    dispose = render(() => (
        <PaperProvider>
            <Configuration
                bot={() => bot}
                onReplaceToken={async () => true}
                onDelete={async (id) => {
                    await actionsApi.call("dev.paperboard.botcreator", "delete-bot", { bot: id });
                    deleted = true;
                }}
            />
        </PaperProvider>
    ), root);
    await wait(() => text().includes(bot.applicationId), "Configuration must load");
    button("Delete")!.click();
    await wait(() => Boolean(button("Cancel")), "the delete modal must open");
    button("Delete")!.click();
    await wait(() => text().includes("vault is down"), "a refused delete must say why");
    assert(!deleted, "a refused delete must not finish");
    assert(Boolean(button("Cancel")), "a refused delete must leave its modal open");
    document.getElementById("result")!.textContent = "PASS";
} catch (err) {
    document.getElementById("result")!.textContent = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
} finally {
    dispose();
}
