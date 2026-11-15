// The chat's sign-in card in a real browser, over a stand-in agent that
// holds each answer until the fixture lets it through or refuses it: a
// sign-in pressed twice is sent once, and refused, it says why and the
// typed password is gone from the page.
//
// Not over the real service: a waiting sign-in is made only by the agent's
// browser (ask_to_sign_in has the computer, Helium, mark the page and take
// its picture), and one in a saved conversation lapses when the service
// starts (transcript.ts). The prompt and access cards are tested over the
// real service in requestCards.test.ts.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import type { SignInEntry } from "../../src/contract";
import type { Agent } from "../../src/lib/agent";
import SignIn from "../../src/chat/SignIn";
import { errors, report, until } from "./chatPage";

export const PASSWORD = "correct horse battery staple";
// a 1x1 PNG: the page's picture
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";
const entry: SignInEntry = { id: "s1", at: 1, kind: "sign-in", site: "example.com", fields: [{ label: "Email", secret: false }, { label: "Password", secret: true }], status: "waiting" };

/** what the card sent, and the answer the fixture hands back when it's ready */
const asked: { values: string[] }[] = [];
let refuse!: (e: Error) => void;
const agent = {
    calls: {
        signInShot: async () => ({ image: PNG }),
        signIn: (inputs: { values: string[] }) => {
            asked.push(inputs);
            return new Promise((_, reject) => (refuse = reject));
        },
        declineSignIn: async () => undefined,
    },
} as unknown as Agent;

const card = () => document.querySelector<HTMLElement>('[data-message="s1"]')!;
const button = (text: string) => [...card().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.innerText.trim() === text)!;
const alertIn = () => card().querySelector<HTMLElement>("[role=alert]")?.innerText ?? null;
/** types into a field as a keyboard does: the value changes, then the field says so */
function fill(name: string, text: string): void {
    const input = card().querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = text;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}
/** anywhere the page still holds `secret`: a field's value or its text */
const holds = (secret: string) => document.body.innerHTML.includes(secret) || [...document.querySelectorAll("input")].some((i) => i.value.includes(secret));

async function run(): Promise<Record<string, unknown>> {
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <SignIn agent={agent} entry={entry} name="Ada" draft={{ values: [], image: null }} onDone={() => {}} />
            </PaperProvider>
        ),
        document.getElementById("app")!,
    );
    // pressed twice while the first is on its way, then refused
    await until("the sign-in's fields", () => card()?.querySelector('input[name="sign-in-1"]'));
    fill("sign-in-0", "ada@example.com");
    fill("sign-in-1", PASSWORD);
    button("Sign in").click();
    button("Sign in").click();
    const sends = asked.length;
    refuse(new Error("The browser window closed"));
    await until("the sign-in's refusal", () => alertIn());
    return { sends, values: asked[0]?.values, refusal: alertIn(), holdsPassword: holds(PASSWORD), uncaught: [...errors] };
}

report(run);
