// PaperModel's scenarios (test/browser/model.test.ts). Each puts the viewer
// in a sized box; `?motion=reduced` zeroes PaperUI's motion tokens, so a
// model appears at once instead of with its entrance. Every request a
// model's loaders make for a picture or a file is recorded in t.requests,
// and WebGL draw calls are counted in t.draws.
import { createSignal, For, Show, type JSX } from "solid-js";
import { PaperModel, PaperProvider, renderModelThumbnail, type PaperModelFormat } from "@mileniumhq/paperui";

const query = new URLSearchParams(location.search);

const requests: string[] = [];
let draws = 0;
let contexts = 0;

// installed by each scenario before its viewer loads, so other suites' pages run untouched
let spying = false;
function spy() {
    if (spying) return;
    spying = true;
    // what a loader reaches for goes through fetch() or an <img>
    const realFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(input instanceof Request ? input.url : String(input));
        return realFetch(input, init);
    };
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
        ...src,
        set(this: HTMLImageElement, value: string) {
            requests.push(value);
            src.set!.call(this, value);
        },
    });
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"] as const) {
            const real = (proto as unknown as Record<string, (...args: unknown[]) => void>)[name];
            if (!real) continue;
            (proto as unknown as Record<string, (...args: unknown[]) => void>)[name] = function (this: unknown, ...args: unknown[]) {
                draws++;
                return real.apply(this, args);
            };
        }
    }
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        const had = (this as unknown as { paperuiContext?: unknown }).paperuiContext;
        const context = (getContext as (...args: unknown[]) => unknown).call(this, type, ...rest);
        if (type.startsWith("webgl") && context && !had) {
            (this as unknown as { paperuiContext?: unknown }).paperuiContext = context;
            contexts++;
        }
        return context;
    } as typeof HTMLCanvasElement.prototype.getContext;
}

const shell = (content: () => JSX.Element) => (
    <PaperProvider fullScreen theme={query.get("theme") === "dark" ? "dark" : "light"}>
        <div data-paperui-motion={query.get("motion") === "reduced" ? "reduced" : undefined} style={{ padding: "24px" }}>
            {content()}
        </div>
    </PaperProvider>
);

const box = { width: `${query.get("w") ?? 480}px`, height: `${query.get("h") ?? 360}px` };

export const scenarios: Record<string, () => JSX.Element> = {
    model() {
        spy();
        const [file, setFile] = createSignal(query.get("src") ?? "");
        const errors: string[] = [];
        window.t = {
            errors,
            requests,
            draws: () => draws,
            contexts: () => contexts,
            setSrc: (next: string) => setFile(next),
        };
        return shell(() => (
            <div id="box" style={box}>
                <Show when={file()}>
                    <PaperModel
                        src={file()}
                        format={(query.get("format") as PaperModelFormat | null) ?? undefined}
                        name={query.get("name") ?? undefined}
                        autoRotate={query.get("autoRotate") === "1"}
                        onError={(message) => errors.push(message)}
                    />
                </Show>
            </div>
        ));
    },

    // one viewer that stays, and one that comes and goes
    modelMany() {
        spy();
        const [shown, setShown] = createSignal(false);
        const errors: string[] = [];
        window.t = { errors, contexts: () => contexts, setShown };
        return shell(() => (
            <div style={{ display: "flex", gap: "16px" }}>
                <div id="kept" style={box}>
                    <PaperModel src="/files/models/cube.glb" onError={(message) => errors.push(message)} />
                </div>
                <Show when={shown()}>
                    <div id="passing" style={box}>
                        <PaperModel src="/files/models/block.stl" onError={(message) => errors.push(message)} />
                    </div>
                </Show>
            </div>
        ));
    },

    modelThumbnails() {
        spy();
        const [urls, setUrls] = createSignal<string[]>([]);
        window.t = {
            contexts: () => contexts,
            requests,
            /** draws a thumbnail and describes the PNG it made */
            async thumb(file: string, format: PaperModelFormat, size: number, aborted = false) {
                const controller = new AbortController();
                if (aborted) controller.abort();
                const blob = await renderModelThumbnail(file, format, size, controller.signal);
                const bitmap = await createImageBitmap(blob);
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                const context = canvas.getContext("2d")!;
                context.drawImage(bitmap, 0, 0);
                const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
                let opaque = 0;
                for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 200) opaque++;
                setUrls((list) => [...list, URL.createObjectURL(blob)]);
                return {
                    type: blob.type,
                    width: bitmap.width,
                    height: bitmap.height,
                    corner: pixels[3],
                    opaque: opaque / (bitmap.width * bitmap.height),
                };
            },
        };
        return shell(() => (
            <div style={{ display: "flex", gap: "8px" }}>
                <For each={urls()}>{(url) => <img src={url} alt="" />}</For>
            </div>
        ));
    },
};
