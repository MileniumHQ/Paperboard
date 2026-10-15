// Widget runtime: the page a panel serves at dist/widget.html calls
// defineWidgets once, and the shell's readiness challenge says which of
// them this frame shows. One frame shows one widget instance.
//
//   defineWidgets({
//       status: (root, widget) => render(() => <Status widget={widget} />, root),
//   });
//
// A mount function returns its cleanup (Solid's render already does).

import { parseWidgetOptionValues, parseWidgetSize, isWidgetId, type WidgetOptionValues, type WidgetSize } from "./widgetManifest";

export interface WidgetContext {
    readonly panelId: string;
    /** Which declared widget this frame shows. */
    readonly widgetId: string;
    /** This placement on Home; two copies of one widget get two ids. */
    readonly instanceId: string;
    /**
     * What was chosen in the gallery for this placement, by the option ids
     * the manifest declares. Fixed for the frame's life. A choice can stop
     * existing (a deleted workflow), so handle a value you no longer know.
     */
    readonly options: Readonly<WidgetOptionValues>;
    /** Current size in grid cells; one of the sizes the manifest declares. */
    size(): WidgetSize;
    /** False while Home is hidden or the widget is scrolled away: pause timers and polling. */
    visible(): boolean;
    onResize(callback: (size: WidgetSize) => void): () => void;
    onVisibilityChange(callback: (visible: boolean) => void): () => void;
    /** Asks the shell to open this widget's panel. */
    openPanel(): void;
}

export type WidgetMount = (root: HTMLElement, widget: WidgetContext) => (() => void) | void;

/** What the shell sends with its readiness challenge to a widget frame. */
export interface WidgetInitialize {
    id: string;
    instanceId: string;
    size: WidgetSize;
    visible: boolean;
    options: WidgetOptionValues;
}

const MAX_LISTENERS = 64;

let definitions: Record<string, WidgetMount> | null = null;
let notifyDefined: (() => void) | null = null;
const defined = new Promise<void>((resolve) => { notifyDefined = resolve; });
let mounted = false;

export function defineWidgets(widgets: Record<string, WidgetMount>): void {
    if (definitions) throw new Error("defineWidgets can only be called once per page");
    for (const [id, mount] of Object.entries(widgets)) {
        if (!isWidgetId(id)) throw new Error(`"${id}" is not a widget id; use lowercase letters, digits and dashes`);
        if (typeof mount !== "function") throw new Error(`widget "${id}" must be a mount function`);
    }
    definitions = { ...widgets };
    notifyDefined?.();
}

/** Parses the shell's widget payload; null when it is malformed. */
export function parseWidgetInitialize(raw: unknown): WidgetInitialize | null {
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    if (!isWidgetId(record.id)) return null;
    if (typeof record.instanceId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(record.instanceId)) return null;
    const size = record.size as Record<string, unknown> | undefined;
    const parsed = size ? parseWidgetSize(`${size.w}x${size.h}`) : null;
    if (!parsed || typeof record.visible !== "boolean") return null;
    const options = parseWidgetOptionValues(record.options);
    if (!options) return null;
    return { id: record.id, instanceId: record.instanceId, size: parsed, visible: record.visible, options };
}

function bounded<T>(set: Set<T>, value: T): () => void {
    if (set.size >= MAX_LISTENERS) throw new Error("Too many widget listeners; unsubscribe unused ones");
    set.add(value);
    return () => { set.delete(value); };
}

/**
 * Mounts the widget the shell asked for. Called by the readiness handler
 * before it answers, so "ready" means the widget is on screen.
 */
export async function mountRequestedWidget(panelId: string, generation: string, request: WidgetInitialize): Promise<void> {
    if (mounted) throw new Error("This frame already shows a widget");
    await defined;
    const mount = definitions?.[request.id];
    if (!mount) throw new Error(`This panel's widget page does not define "${request.id}"`);
    mounted = true;

    let size = request.size;
    let visible = request.visible;
    const resizeListeners = new Set<(size: WidgetSize) => void>();
    const visibilityListeners = new Set<(visible: boolean) => void>();

    const context: WidgetContext = {
        panelId,
        widgetId: request.id,
        instanceId: request.instanceId,
        options: Object.freeze({ ...request.options }),
        size: () => size,
        visible: () => visible,
        onResize: (callback) => bounded(resizeListeners, callback),
        onVisibilityChange: (callback) => bounded(visibilityListeners, callback),
        openPanel: () => window.parent.postMessage({ type: "paperboard:widget-open-panel", generation }, "*"),
    };

    const receive = (event: MessageEvent) => {
        if (event.source !== window.parent || event.data?.type !== "paperboard:widget-update" || event.data.generation !== generation) return;
        const nextSize = event.data.size ? parseWidgetSize(`${event.data.size.w}x${event.data.size.h}`) : null;
        if (nextSize && (nextSize.w !== size.w || nextSize.h !== size.h)) {
            size = nextSize;
            for (const callback of [...resizeListeners]) callback(size);
        }
        if (typeof event.data.visible === "boolean" && event.data.visible !== visible) {
            visible = event.data.visible;
            for (const callback of [...visibilityListeners]) callback(visible);
        }
    };
    window.addEventListener("message", receive);

    const root = document.createElement("div");
    root.setAttribute("data-paperboard-widget", request.id);
    root.style.cssText = "position:fixed;inset:0;overflow:hidden";
    document.body.append(root);
    const cleanup = mount(root, context);

    window.addEventListener("pagehide", () => {
        window.removeEventListener("message", receive);
        resizeListeners.clear();
        visibilityListeners.clear();
        if (typeof cleanup === "function") cleanup();
    }, { once: true });
}
