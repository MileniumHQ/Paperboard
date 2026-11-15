// OpenCode's providers in a real browser, over the stubbed service
// (paperapiStub.ts): a sign-in started, canceled and started again while the
// first one's status question is still on its way. That late answer belongs
// to a sign-in that is gone, and must not end the new one. Then a key is
// connected, and the list read again keeps the provider's forms the ones
// they were.
import { onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import { UI_ACTION_IDS, type ProviderAttemptStatus, type ProviderInfo } from "../../src/contract";
import { createAgent } from "../../src/lib/agent";
import Providers from "../../src/settings/Providers";
import { errors, report, until } from "./chatPage";
import { answers } from "./paperapiStub";

const ACME: ProviderInfo = {
    id: "acme",
    name: "Acme",
    connected: false,
    connections: [],
    methods: [
        { id: "browser", kind: "oauth", label: "Sign in with Acme", fields: [] },
        { id: null, kind: "key", label: "Use an API key", fields: [] },
    ],
    unsupported: null,
};

let begun = 0;
/** each attempt's status questions, and how to answer the first one's */
const questions: string[] = [];
let answerFirst!: (status: ProviderAttemptStatus) => void;
// every read is a fresh copy, as the service's answer is; once a key is in, Acme has it
let keyed = false;
answers.set(UI_ACTION_IDS.providers, async () => ({
    providers: [{ ...structuredClone(ACME), ...(keyed ? { connected: true, connections: [{ id: "key1", label: "Acme key" }] } : {}) }],
}));
answers.set(UI_ACTION_IDS.connectKey, async () => void (keyed = true));
answers.set(UI_ACTION_IDS.beginProvider, async () => ({ id: `attempt${++begun}`, url: "https://acme.example/login", instructions: `Sign-in ${begun}`, mode: "auto" }));
answers.set(UI_ACTION_IDS.cancelProvider, async () => ({}));
answers.set(UI_ACTION_IDS.providerAttempt, (inputs) => {
    questions.push(String(inputs.attempt));
    if (inputs.attempt === "attempt1") return new Promise<ProviderAttemptStatus>((resolve) => (answerFirst = resolve));
    return Promise.resolve<ProviderAttemptStatus>({ status: "pending" });
});

const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const shows = (text: string) => document.body.innerText.includes(text);

function Fixture() {
    const agent = createAgent();
    onCleanup(agent.dispose);
    return <Providers agent={agent} open onClose={() => {}} />;
}

async function run(): Promise<Record<string, unknown>> {
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <Fixture />
            </PaperProvider>
        ),
        document.getElementById("app")!,
    );
    const trigger = await until("the provider menu", () => document.querySelector<HTMLElement>('[aria-label="Provider"] button, button[aria-label="Provider"]'));
    trigger.click();
    (await until("Acme in the menu", () => document.querySelector<HTMLElement>('[role=option][data-select-value="acme"]'))).click();
    (await until("Sign in", () => button("Sign in"))).click();

    // the first sign-in is asked about, and the answer takes its time
    await until("the first sign-in's status question", () => questions.includes("attempt1"));
    button("Cancel")!.click();
    await until("Sign in, again", () => button("Sign in") && !button("Sign in")!.disabled);
    button("Sign in")!.click();
    await until("the second sign-in", () => shows("Sign-in 2"));

    // the first one's late answer: it failed
    const asked = () => questions.filter((q) => q === "attempt2").length;
    const before = asked();
    answerFirst({ status: "failed", message: "the first sign-in was refused" });
    // the second one is asked about again after it (the next poll), so the late answer has been handled by then; or it ended
    await until("the second sign-in's next status question, or its end", () => asked() > before || !shows("Sign-in 2"));

    const stillSigningIn = shows("Sign-in 2") && shows("Waiting for you to finish signing in");
    const refused = shows("the first sign-in was refused");

    // a key connected: the list is read again, and the forms on show are the same nodes
    button("Cancel")!.click();
    await until("the sign-in canceled", () => !shows("Sign-in 2"));
    const form = await until("the key's field", () => document.querySelector<HTMLInputElement>('input[type="password"]'));
    form.value = "sk-test";
    form.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const signIn = button("Sign in")!;
    (await until("Connect", () => button("Connect") && !button("Connect")!.disabled && button("Connect")))!.click();
    await until("the list read again", () => shows("Acme key is connected."));

    return {
        stillSigningIn,
        refused,
        formsKept: form.isConnected && signIn.isConnected,
        uncaught: [...errors],
    };
}

report(run);
