// The real chat in a real browser, for what goes into and out of a message:
// a message leaves once however its Send is pressed, and keeps what was
// typed while it was on its way; a YouTube link in the agent's message shows
// its thumbnail as the service fetched it, and the page asks YouTube for
// nothing; switched to another conversation twice, the chat shows the last
// one's history even when the first one's answers last. The service is the stub (paperapiStub.ts), answering the actions
// this needs the way the real one does, and recording what it was asked.
import type { ChatEntry } from "../../src/contract";
import { errors, field, frame, mountChat, report, type, until } from "./chatPage";
import { answers, emit } from "./paperapiStub";

// a 1x1 PNG, the thumbnail the service hands over
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

const sent: Record<string, unknown>[] = [];
const webImages: string[] = [];
let deliver!: () => void;
answers.set("send", (inputs) => {
    sent.push(inputs);
    // on its way until the fixture lets it arrive
    return new Promise((resolve) => (deliver = () => resolve({ id: `m${sent.length}`, waiting: false })));
});
answers.set("webImage", async (inputs) => {
    webImages.push(String(inputs.url));
    return { type: "image/png", data: PNG };
});

const sendButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
const ctrlEnter = () => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));

/** Everything the page has asked a host for, by URL: what it loaded and what its elements point at. */
const asked = () => [
    ...performance.getEntriesByType("resource").map((e) => e.name),
    ...[...document.querySelectorAll<HTMLElement>("[src], [srcset]")].flatMap((el) => [el.getAttribute("src") ?? "", el.getAttribute("srcset") ?? ""]).filter(Boolean),
];

async function run(): Promise<Record<string, unknown>> {
    mountChat("420px", "640px");
    await until("the message box", () => field());

    // pressed twice, and Ctrl+Enter on top, while the first is on its way; more is typed meanwhile
    type("Find me a recipe");
    await until("Send to be ready", () => !sendButton().disabled);
    sendButton().click();
    sendButton().click();
    ctrlEnter();
    type("Find me a recipe and a wine");
    const sendsInFlight = sent.length;
    deliver();
    await until("the message to arrive", () => field().value !== "Find me a recipe and a wine");
    const afterSend = { sends: sendsInFlight, text: sent[0]?.text, left: field().value };

    // a YouTube link in the agent's message
    emit("entry", { id: "yt1", at: Date.now(), kind: "agent", text: "Here it is:\n\n![How to make pasta](https://www.youtube.com/watch?v=dQw4w9WgXcQ)" });
    const thumb = await until("the thumbnail", () => document.querySelector<HTMLImageElement>('[data-message="yt1"] img[alt="How to make pasta"]'));
    await until("the thumbnail to be drawn", () => thumb.complete && thumb.naturalWidth > 0);
    const youTube = {
        src: thumb.src.split(":")[0],
        fetched: webImages,
        link: thumb.closest("a")?.getAttribute("href"),
        askedYouTube: asked().filter((url) => /ytimg\.com|youtube\.com/.test(url)),
    };

    // two switches in a row: the first one's history is on its way longest
    const histories: ((entries: ChatEntry[]) => void)[] = [];
    answers.set("history", () => new Promise((resolve) => histories.push(resolve)));
    emit("switched");
    emit("switched");
    await until("both histories asked for", () => histories.length === 2);
    histories[1]!([{ id: "last1", at: Date.now(), kind: "agent", text: "The conversation switched to last" }]);
    await until("the last conversation's history", () => document.querySelector('[data-message="last1"]'));
    histories[0]!([{ id: "first1", at: Date.now(), kind: "agent", text: "The conversation switched to first" }]);
    // what an answer sets lands before the next frame is drawn
    await frame();
    await frame();
    const switched = {
        last: Boolean(document.querySelector('[data-message="last1"]')),
        first: Boolean(document.querySelector('[data-message="first1"]')),
    };

    return { afterSend, youTube, switched, uncaught: [...errors] };
}

report(run);
