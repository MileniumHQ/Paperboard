// Reads that fail in a real browser, each over a stand-in agent that answers
// when the fixture says. The pages: a first read that fails is told on the
// Pages page and on a page's card in the chat, and one that fails after a good
// read is told above the list it leaves. Access: a failed first read gives way
// to the view the service pushes next.
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import Access from "../../src/access/Access";
import type { AccessView, PageInfo } from "../../src/contract";
import type { Agent } from "../../src/lib/agent";
import { createLauncher } from "../../src/pages/launcher";
import PageCard from "../../src/pages/PageCard";
import Pages from "../../src/pages/Pages";
import { errors, frame, report, until } from "./chatPage";

const [state, setState] = createStore({ pages: { revision: 0 }, settings: { name: "Ada" } });
let pagesRead: () => Promise<PageInfo[]> = () => Promise.reject(new Error("The pages folder is locked"));
let pushAccess!: (next: AccessView) => void;
const agent = {
    state,
    name: () => "Ada",
    calls: {
        pages: () => pagesRead(),
        pagePicture: () => new Promise(() => {}),
        access: () => Promise.reject(new Error("access.json is busy")),
    },
    events: { access: (cb: (next: AccessView) => void) => ((pushAccess = cb), () => {}) },
} as unknown as Agent;

const REPORT: PageInfo = { name: "report", title: "Report", description: "The month's numbers", kind: "document", picture: false, pictureAt: 0 };
const region = (name: string) => document.querySelector<HTMLElement>(`[data-region="${name}"]`)!;
const alerts = (name: string) => [...region(name).querySelectorAll<HTMLElement>("[role=alert]")].map((a) => a.innerText);
const text = (name: string) => region(name).innerText;

async function run(): Promise<Record<string, unknown>> {
    render(() => {
        const pages = createLauncher(agent);
        return (
            <PaperProvider fullWidth fullHeight>
                <div data-region="pages">
                    <Pages pages={pages} name="Ada" onOpened={() => {}} />
                </div>
                <div data-region="card">
                    <PageCard entry={{ id: "e1", at: 1, kind: "app", app: "report", title: "Report", description: "The month's numbers" }} pages={pages} />
                </div>
                <div data-region="access">
                    <Access agent={agent} />
                </div>
            </PaperProvider>
        );
    }, document.getElementById("app")!);

    // the first read of the pages fails
    await until("the pages' refusal", () => text("pages").includes("The pages folder is locked"));
    await until("the access refusal", () => text("access").includes("access.json is busy"));
    await frame();
    const firstCard = alerts("card");

    // the service pushes what's allowed: that is what the page shows now
    pushAccess({ grants: [{ kind: "folder", path: "/srv/share", at: 1, once: false }], error: null });
    await frame();
    await frame();
    const accessAfterPush = { refusal: text("access").includes("Access can't be read"), grant: text("access").includes("/srv/share") };

    // a read again finds the page; then the pages change and that read fails
    pagesRead = () => Promise.resolve([REPORT]);
    [...region("pages").querySelectorAll<HTMLButtonElement>("button")].find((b) => b.innerText.includes("Try again"))!.click();
    await until("the page in the list", () => text("pages").includes("Report"));
    let refused: Promise<unknown> | undefined;
    pagesRead = () => (refused = Promise.reject(new Error("The disk went away")));
    setState("pages", "revision", 1);
    await until("the read again", () => refused !== undefined);
    await refused!.catch(() => undefined);
    await frame();
    return {
        firstCard,
        accessAfterPush,
        later: { alerts: alerts("pages"), list: text("pages").includes("Report"), card: alerts("card") },
        uncaught: [...errors],
    };
}

report(run);
