import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider, PaperSlidePage, SWIPE_BACK_EVENT, type SwipeBackDetail, swipeFromFrame } from "../../index";
import "../../styles/styles.css";

const [open, setOpen] = createSignal(true);
let backs = 0;

const dispose = render(
    () => (
        <PaperProvider>
            <div id="list" style={{ position: "relative", width: "400px", height: "600px" }}>
                <p id="outside">the list</p>
                <PaperSlidePage enabled open={open()} title="Page" onBack={() => { backs++; setOpen(false); }}>
                    <p id="text">content</p>
                    <input id="slider" type="range" />
                    <div id="carousel" style={{ width: "100px", "overflow-x": "auto" }}>
                        <div style={{ width: "400px", height: "20px" }} />
                    </div>
                    <div id="owned" style={{ "touch-action": "pan-y" }}>owns sideways</div>
                    <iframe id="frame" title="frame" />
                </PaperSlidePage>
            </div>
        </PaperProvider>
    ),
    document.getElementById("app")!,
);

let id = 0;
/** a finger from `el`'s middle, `dx` px to the right over a few moves */
function swipe(el: Element, dx: number, dy = 0) {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const identifier = ++id;
    const fire = (type: string, cx: number, cy: number) => {
        const t = new Touch({ identifier, target: el, clientX: cx, clientY: cy });
        el.dispatchEvent(new TouchEvent(type, {
            bubbles: true, cancelable: true,
            touches: type === "touchend" ? [] : [t], changedTouches: [t],
        }));
    };
    fire("touchstart", x, y);
    for (let i = 1; i <= 4; i++) fire("touchmove", x + (dx * i) / 4, y + (dy * i) / 4);
    fire("touchend", x + dx, y + dy);
}

const reported: SwipeBackDetail[] = [];
window.addEventListener(SWIPE_BACK_EVENT, (e) => reported.push((e as CustomEvent<SwipeBackDetail>).detail));

const checks: Record<string, unknown> = {};
try {
    const $ = (sel: string) => document.querySelector(sel)!;
    ($("#carousel") as HTMLElement).scrollLeft = 50;

    const kept: string[] = [];
    const tries: [string, number, number][] = [["#slider", 300, 0], ["#carousel", 300, 0], ["#owned", 300, 0], ["#text", 300, 400], ["#text", -300, 0]];
    for (const [sel, dx, dy] of tries) {
        swipe($(sel), dx, dy);
        if (!open()) { kept.push(`${sel} ${dx},${dy}`); setOpen(true); }
    }
    checks.keptOpen = kept.join("; ") || true;
    backs = 0;

    swipe($("#text"), 300);
    checks.wentBack = !open() && backs === 1;

    // a closed page isn't there to swipe: the document reports it
    swipe($("#outside"), 300);
    checks.reported = reported.map((d) => d.phase).join(",");

    // a frame inside an open page drives that page
    setOpen(true);
    const frame = $("#frame");
    checks.junkRefused = swipeFromFrame(frame, { phase: "end", dx: "300", velocity: 0 });
    swipeFromFrame(frame, { phase: "move", dx: 200, velocity: 0 });
    checks.frameDrags = ($('[role="region"]') as HTMLElement).style.transform;
    swipeFromFrame(frame, { phase: "end", dx: 300, velocity: 0 });
    checks.frameWentBack = !open() && backs === 2;
    checks.closedFrameIgnored = swipeFromFrame(frame, { phase: "end", dx: 300, velocity: 0 });

    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: "" }))}`;
} catch (error) {
    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: String(error) }))}`;
} finally {
    dispose();
}
