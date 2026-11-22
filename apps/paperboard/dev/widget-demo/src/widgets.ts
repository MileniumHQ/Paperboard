// Three widgets, one page: the shell says which one this frame shows.
// Plain DOM on purpose; a Solid widget is `(root, w) => render(() => <X w={w} />, root)`.
import "@mileniumhq/paperui/style.css";
import "./style.css";
import { defineWidgets, serviceClient, type WidgetContext } from "@mileniumhq/paperapi";
import { demoContract } from "./contract";

function el(root: HTMLElement, html: string, className: string): void {
    root.className = `demo-widget ${className}`;
    root.innerHTML = html;
}

// ticks only while visible: a hidden Home costs nothing
function every(widget: WidgetContext, ms: number, tick: () => void): () => void {
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = (visible: boolean) => {
        clearInterval(timer);
        timer = undefined;
        if (visible) {
            tick();
            timer = setInterval(tick, ms);
        }
    };
    const off = widget.onVisibilityChange(sync);
    sync(widget.visible());
    return () => { off(); clearInterval(timer); };
}

defineWidgets({
    clock: (root, widget) => {
        el(root, `<time class="big"></time><span class="sub"></span>`, "clock");
        const time = root.querySelector("time")!;
        const sub = root.querySelector<HTMLSpanElement>(".sub")!;
        // a tall clock has room for the long date
        const layout = () => root.classList.toggle("tall", widget.size().h > 1);
        const off = widget.onResize(layout);
        layout();
        const stop = every(widget, 1000, () => {
            const now = new Date();
            const tall = root.classList.contains("tall");
            time.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            sub.textContent = now.toLocaleDateString([], tall
                ? { weekday: "long", month: "long", day: "numeric" }
                : { weekday: "short", month: "short", day: "numeric" });
        });
        return () => { off(); stop(); };
    },

    counter: (root, widget) => {
        // chosen in the gallery; a step the service stopped offering is refused by it, and shown
        const step = Number(widget.options.step ?? 1);
        el(root, `<span class="big" aria-live="polite">0</span><button type="button"></button>`, "counter");
        root.querySelector("button")!.textContent = `+${step}`;
        const client = serviceClient(demoContract);
        const value = root.querySelector<HTMLSpanElement>(".big")!;
        const show = () => { value.textContent = String(client.state.current().count); };
        const off = client.state.subscribe(show);
        show();
        root.querySelector("button")!.addEventListener("click", () => {
            client.calls.increment({ by: step }).catch((err) => { value.textContent = "!"; value.title = err instanceof Error ? err.message : String(err); });
        });
        return () => { off(); client.state.dispose(); };
    },

    status: (root, widget) => {
        el(root, `<span class="dot" aria-hidden="true"></span><span class="label">Service running</span><span class="sub"></span><button type="button">Open panel</button>`, "status");
        const client = serviceClient(demoContract);
        const sub = root.querySelector<HTMLSpanElement>(".sub")!;
        root.querySelector("button")!.addEventListener("click", () => widget.openPanel());
        const stop = every(widget, 1000, () => {
            const startedAt = client.state.current().startedAt || Date.now();
            const seconds = Math.floor((Date.now() - startedAt) / 1000);
            sub.textContent = `up ${Math.floor(seconds / 60)}m ${seconds % 60}s · ${widget.instanceId.slice(0, 8)}`;
        });
        return () => { stop(); client.state.dispose(); };
    },
});
