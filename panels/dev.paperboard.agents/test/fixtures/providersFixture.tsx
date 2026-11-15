// OpenCode's providers in a real browser, over the stubbed service
// (paperapiStub.ts): a sign-in started, canceled and started again while the
// first one's status question is still on its way. That late answer belongs
// to a sign-in that is gone, and must not end the new one.
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
    methods: [{ id: "browser", kind: "oauth", label: "Sign in with Acme", fields: [] }],
    unsupported: null,
};

let begun = 0;
/** each attempt's status questions, and how to answer the first one's */
const questions: string[] = [];
let answerFirst!: (status: ProviderAttemptStatus) => void;
answers.set(UI_ACTION_IDS.providers, async () => ({ providers: [ACME] }));
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

    return {
        stillSigningIn: shows("Sign-in 2") && shows("Waiting for you to finish signing in"),
        refused: shows("the first sign-in was refused"),
        uncaught: [...errors],
    };
}

report(run);
