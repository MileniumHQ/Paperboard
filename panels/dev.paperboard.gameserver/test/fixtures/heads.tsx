// Build with heads.vite.ts and open /test/fixtures/heads.html. The real
// HeadAvatar, as the Players inspector uses it: one avatar whose player
// changes. Switching from a Bedrock player to a Java player whose head is
// still loading must not leave the Bedrock head on the Java player, and a
// player seen before paints their last head at once, then the fresh one.
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import HeadAvatar from "../../src/components/HeadAvatar";
import type { HeadRequest } from "../../src/lib/skins";

const BEDROCK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const JAVA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JAVA_NEW = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// each lookup waits until the test answers it
const waiting: { request: HeadRequest; answer: (src: string | null) => void }[] = [];
const loadHead = (request: HeadRequest) => new Promise<string | null>((answer) => waiting.push({ request, answer }));

const [player, setPlayer] = createSignal({ name: ".Huddybud780", uuid: "00000000-0000-0000-0009-01ffe8443ea0" });
const root = document.getElementById("app")!;
const dispose = render(
    () => (
        <PaperProvider>
            <HeadAvatar name={player().name} uuid={player().uuid} loadHead={loadHead} size="xlarge" />
        </PaperProvider>
    ),
    root,
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const src = () => root.querySelector("img")?.getAttribute("src") ?? null;
const assert = (value: unknown, label: string) => {
    if (!value) throw new Error(`${label} (img: ${src()?.slice(-20) ?? "none"})`);
};
const answer = async (name: string, head: string | null) => {
    const i = waiting.findIndex((w) => w.request.name === name);
    assert(i >= 0, `a lookup for ${name}`);
    waiting.splice(i, 1)[0].answer(head);
    await sleep(20);
};

try {
    await sleep(20);
    await answer(".Huddybud780", BEDROCK);
    assert(src() === BEDROCK, "the Bedrock head shows");

    setPlayer({ name: "_aze0", uuid: "1fc544c1-ce54-4679-aab1-e55dcf1768ad" });
    await sleep(20);
    assert(src() === null, "the Bedrock head is gone while _aze0's loads");
    await answer("_aze0", JAVA);
    assert(src() === JAVA, "_aze0's head shows");

    // back to someone drawn before: their head at once, then the fresh answer
    setPlayer({ name: ".Huddybud780", uuid: "00000000-0000-0000-0009-01ffe8443ea0" });
    await sleep(20);
    assert(src() === BEDROCK, "the Bedrock head paints at once from the last time");
    setPlayer({ name: "_aze0", uuid: "1fc544c1-ce54-4679-aab1-e55dcf1768ad" });
    await sleep(20);
    assert(src() === JAVA, "_aze0's last head paints at once");
    await answer("_aze0", JAVA_NEW);
    assert(src() === JAVA_NEW, "a new skin replaces the last head");
    // the late Bedrock answer lands on nobody
    await answer(".Huddybud780", BEDROCK);
    assert(src() === JAVA_NEW, "a late answer for another player changes nothing");

    document.getElementById("result")!.textContent = "PASS";
} catch (err) {
    document.getElementById("result")!.textContent = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
} finally {
    dispose();
}
