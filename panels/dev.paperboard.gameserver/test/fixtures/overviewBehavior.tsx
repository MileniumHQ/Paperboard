// The shared Overview and Chat on real PaperUI, over a server whose console,
// chat and save refuse. Every refusal must reach the screen with its reason.
// Opened as overviewBehavior.html?server=s1 by test/overviewBehavior.test.ts.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import { actionsApi } from "@mileniumhq/paperapi";
import { initialServerState } from "../../src/service/initialState";
import { serverStateKey } from "../../src/servers";

const checks: Record<string, unknown> = {};
const uncaught: string[] = [];
window.addEventListener("unhandledrejection", (e) => uncaught.push(String(e.reason)));
window.addEventListener("error", (e) => uncaught.push(String(e.message)));
const calls: string[] = [];
const state = {
    servers: [{ id: "s1", name: "Fixture", game: "minecraft", directory: "servers/s1", createdAt: 1, configured: true, icon: null, state: { serverStatus: "online", serverSoftware: "paper", serverVersion: "1.21.4", serverPort: "25565", recoveryBlock: null, maxPlayers: 20, playerCount: 0 } }],
    serversError: null,
    [serverStateKey("s1")]: { ...initialServerState(), serverStatus: "online", serverVersion: "1.21.4" },
};
actionsApi.on = (() => () => {}) as typeof actionsApi.on;
actionsApi.call = (async (_panel: string, action: string) => {
    calls.push(action);
    if (action === "__getState") return state;
    if (action === "s1/run-command") throw new Error("Use Options for the password");
    if (action === "s1/say-chat") throw new Error("The server closed its console");
    if (action === "s1/save-world") throw new Error("The server did not confirm that the world is saved within 120 seconds");
    return {};
}) as typeof actionsApi.call;

const wait = async (what: string, predicate: () => boolean) => {
    for (let i = 0; i < 200; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${what}: ${document.body.innerText.slice(0, 400)}`);
};
const text = () => document.body.innerText;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));
const typeInto = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
};

let error = "";
try {
    const { default: ServerOverview } = await import("../../src/components/ServerOverview");
    const { default: Chat } = await import("../../src/components/Chat");
    const root = document.getElementById("app")!;

    const overview = render(() => <PaperProvider><ServerOverview avatar={<span />} software="Paper" /></PaperProvider>, root);
    await wait("the server to load as online", () => Boolean(button("Save world")));
    checks.saveShown = true;
    button("Save world")!.click();
    await wait("the save failure", () => text().includes("World not saved"));
    checks.saveFailureTitled = text().includes("World not saved");
    checks.saveFailureReason = text().includes("did not confirm that the world is saved");

    const consoleInput = [...root.querySelectorAll<HTMLInputElement>("input")].find((i) => i.placeholder === "Enter command...")!;
    typeInto(consoleInput, "password hunter2");
    consoleInput.closest("form")!.requestSubmit();
    await wait("the command failure", () => text().includes("Command not run"));
    checks.commandFailureTitled = true;
    checks.commandFailureReason = text().includes("Use Options for the password");
    overview();

    // a game without a console messages everyone from the same line
    const broadcast = render(() => <PaperProvider><ServerOverview avatar={<span />} software="Steam" control={{ kind: "broadcast" }} /></PaperProvider>, root);
    await wait("the broadcast line", () => [...root.querySelectorAll<HTMLInputElement>("input")].some((i) => i.placeholder === "Message everyone on the server..."));
    const broadcastInput = [...root.querySelectorAll<HTMLInputElement>("input")].find((i) => i.placeholder === "Message everyone on the server...")!;
    const before = calls.length;
    typeInto(broadcastInput, "restart at six");
    broadcastInput.closest("form")!.requestSubmit();
    await wait("the broadcast failure", () => text().includes("Message not sent"));
    checks.broadcastSent = calls.slice(before).filter((c) => c !== "__getState");
    checks.broadcastFailureReason = text().includes("The server closed its console");
    broadcast();

    const chat = render(() => <PaperProvider><Chat avatar={() => <span />} /></PaperProvider>, root);
    const chatInput = [...root.querySelectorAll<HTMLInputElement>("input")].find((i) => i.placeholder === "Message server...")!;
    typeInto(chatInput, "hello world");
    root.querySelector("form")!.requestSubmit();
    await wait("the chat failure", () => text().includes("Message not sent"));
    checks.chatFailureTitled = true;
    checks.chatFailureReason = text().includes("The server closed its console");
    checks.chatKeepsMessage = chatInput.value;
    // the Say button sends, as Enter does: clicked, it is the form's submit
    const sent = () => calls.filter((c) => c === "s1/say-chat").length;
    const sentBefore = sent();
    typeInto(chatInput, "from the button");
    button("Say")!.click();
    await wait("the Say button to send", () => sent() > sentBefore);
    checks.sayButtonSends = true;
    chat();
    checks.calls = calls.filter((c) => c !== "__getState");
} catch (err) {
    error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
}
checks.uncaught = uncaught;
document.getElementById("results")!.textContent = `RESULT:${btoa(unescape(encodeURIComponent(JSON.stringify({ checks, error }))))}`;
