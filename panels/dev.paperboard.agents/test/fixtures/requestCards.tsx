// The chat's request cards in a real browser: a sign-in, a prompt for a key
// and an access request, waiting in the conversation, answered as a person
// would. The service is the stub (paperapiStub.ts): it records what each card
// sent, holds each answer until the fixture lets it through or refuses it,
// and tells the chat the request's new status as the real one does.
import { EVENTS, UI_ACTION_IDS, type AccessEntry, type PromptEntry, type SignInEntry } from "../../src/contract";
import { errors, mountChat, report, until } from "./chatPage";
import { answers, conversation, emit } from "./paperapiStub";

export const PASSWORD = "correct horse battery staple";
export const KEY = "lin_api_secret-key";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

const signIn: SignInEntry = { id: "s1", at: 1, kind: "sign-in", site: "example.com", fields: [{ label: "Email", secret: false }, { label: "Password", secret: true }], status: "waiting" };
const prompt: PromptEntry = { id: "p1", at: 2, kind: "prompt", title: "Connect Linear", reason: "To read your issues.", fields: [{ label: "Workspace", secret: null }, { label: "API key", secret: { server: "linear", name: "api-key" } }], status: "waiting" };
const access: AccessEntry = { id: "a1", at: 3, kind: "access", reason: "To fix the build.", items: [{ kind: "folder", path: "/home/ada/project" }], status: "waiting" };
conversation.push(signIn, prompt, access);

/** what each card sent, and the answer the fixture hands back when it's ready */
const asked: { id: string; inputs: Record<string, unknown> }[] = [];
const pending: { resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];
for (const id of [UI_ACTION_IDS.signIn, UI_ACTION_IDS.answerPrompt, UI_ACTION_IDS.answerAccess]) {
    answers.set(id, (inputs) => {
        asked.push({ id, inputs });
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    });
}
answers.set(UI_ACTION_IDS.signInShot, async () => ({ image: PNG }));

const card = (id: string) => document.querySelector<HTMLElement>(`[data-message="${id}"]`)!;
const button = (id: string, text: string) => [...card(id).querySelectorAll<HTMLButtonElement>("button")].find((b) => b.innerText.trim() === text)!;
const alertIn = (id: string) => card(id).querySelector<HTMLElement>("[role=alert]")?.innerText ?? null;
/** types into a field as a keyboard does: the value changes, then the field says so */
function fill(id: string, name: string, text: string): void {
    const input = card(id).querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = text;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}
/** anywhere the page still holds `secret`: a field's value or its text */
const holds = (secret: string) => document.body.innerHTML.includes(secret) || [...document.querySelectorAll("input")].some((i) => i.value.includes(secret));

async function run(): Promise<Record<string, unknown>> {
    mountChat("420px", "900px");

    // the sign-in: pressed twice while the first is on its way, then refused
    await until("the sign-in's fields", () => card("s1")?.querySelector('input[name="sign-in-1"]'));
    fill("s1", "sign-in-0", "ada@example.com");
    fill("s1", "sign-in-1", PASSWORD);
    button("s1", "Sign in").click();
    button("s1", "Sign in").click();
    const signInSends = asked.length;
    pending.shift()!.reject(new Error("The browser window closed"));
    await until("the sign-in's refusal", () => alertIn("s1"));
    const signInResult = { sends: signInSends, values: asked[0]?.inputs.values, refusal: alertIn("s1"), holdsPassword: holds(PASSWORD) };

    // the prompt: sent once, and once the service says it went, the key is nowhere on the page
    fill("p1", "prompt-0", "acme");
    fill("p1", "prompt-1", KEY);
    await until("Send to be ready", () => !button("p1", "Send").disabled);
    button("p1", "Send").click();
    button("p1", "Send").click();
    const promptSends = asked.length - 1;
    pending.shift()!.resolve(undefined);
    emit(EVENTS.entry, { ...prompt, status: "sent" });
    await until("the prompt to say it was sent", () => card("p1").innerText.includes("Keys are saved for linear"));
    const promptResult = { sends: promptSends, values: asked[1]?.inputs.values, holdsKey: holds(KEY) };

    // the access request: a refused answer says why; a decline that goes through says so
    button("a1", "Always allow").click();
    const how = asked[2]?.inputs.how;
    pending.shift()!.reject(new Error("That request isn't waiting anymore."));
    await until("the access answer's refusal", () => alertIn("a1"));
    const refusal = alertIn("a1");
    button("a1", "Decline").click();
    pending.shift()!.resolve(undefined);
    emit(EVENTS.entry, { ...access, status: "declined" });
    await until("the access request to say no", () => card("a1").innerText.includes("You said no."));
    const accessResult = { how, refusal, afterDecline: alertIn("a1"), answers: [...card("a1").querySelectorAll("button")].filter((b) => /allow|decline/i.test(b.innerText)).length };

    return { signIn: signInResult, prompt: promptResult, access: accessResult, uncaught: [...errors] };
}

report(run);
