// A tool server's sign-in in a real browser, on another device than the
// agent's (loopbackStub.ts): the address the browser came back to is caught
// and handed over, and the server refuses it. The address can still be
// pasted, instead of waiting for a browser that has already come back.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import type { Tools } from "../../src/tools/api";
import SignInSteps from "../../src/tools/SignInSteps";
import { errors, report, until } from "./chatPage";
import { CAUGHT } from "./loopbackStub";

const handed: string[] = [];
const tools = {
    view: () => ({ signIns: { echo: { url: "https://echo.example/login", callback: "http://localhost:1455/callback", error: null } } }),
    finishSignIn: async (_name: string, address: string) => {
        handed.push(address);
        throw new Error("the code in the address was refused");
    },
    signIn: async () => {},
    cancelSignIn: async () => {},
} as unknown as Tools;

async function run(): Promise<Record<string, unknown>> {
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <SignInSteps tools={tools} name="echo" />
            </PaperProvider>
        ),
        document.getElementById("app")!,
    );
    await until("the refusal", () => document.body.innerText.includes("the code in the address was refused"));
    return {
        handed,
        canPaste: Boolean(await until("the address field", () => document.querySelector('input[autocomplete="off"]'))),
        uncaught: [...errors],
    };
}

report(run);
