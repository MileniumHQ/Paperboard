import { render } from "solid-js/web";
import { PaperProvider } from "../../index";
import "../../styles/styles.css";

const menus: string[] = [];
const clicks: string[] = [];

const dispose = render(
    () => (
        <PaperProvider>
            <button id="item" type="button" onClick={() => clicks.push("item")}
                onContextMenu={(e) => { e.preventDefault(); menus.push(`item@${e.clientX},${e.clientY}`); }}>
                a panel
            </button>
            <button id="plain" type="button" onClick={() => clicks.push("plain")}>no menu</button>
        </PaperProvider>
    ),
    document.getElementById("app")!,
);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let id = 0;
async function press(el: Element, ms: number, moveBy = 0) {
    const box = el.getBoundingClientRect();
    const x = Math.round(box.left + 5);
    const y = Math.round(box.top + 5);
    const identifier = ++id;
    const fire = (type: string, cx: number) => {
        const t = new Touch({ identifier, target: el, clientX: cx, clientY: y });
        return el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [t], changedTouches: [t] }));
    };
    fire("touchstart", x);
    if (moveBy) { await wait(50); fire("touchmove", x + moveBy); }
    await wait(ms);
    // the browser's own long press, which iOS never sends and Android does
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    const released = fire("touchend", x + moveBy);
    // a release that wasn't held back clicks
    if (released) (el as HTMLElement).click();
    else el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return `${x},${y}`;
}

const checks: Record<string, unknown> = {};
async function run() {
    const item = document.getElementById("item")!;
    const plain = document.getElementById("plain")!;
    const at = await press(item, 700);
    checks.heldOpensOnce = menus.join(";") === `item@${at}`;
    checks.heldDoesNotClick = !clicks.includes("item");
    menus.length = 0;
    await press(item, 100);
    checks.tapClicks = clicks.join(";");
    clicks.length = 0;
    menus.length = 0;
    await press(item, 700, 30);
    checks.movedOpensNoExtra = menus.length;
    clicks.length = 0;
    await press(plain, 700);
    checks.unhandledStillClicks = clicks.join(";");
}
run()
    .then(() => "", (error: unknown) => String(error))
    .then((error) => {
        document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error }))}`;
        dispose();
    });
