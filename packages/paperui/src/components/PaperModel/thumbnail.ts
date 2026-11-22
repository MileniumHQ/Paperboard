// Still pictures of models, for file lists and grids. Every thumbnail is
// drawn by one offscreen renderer, made when the first is asked for, used
// by one job at a time, and freed once none has been asked for in a while:
// a folder of two hundred models costs one WebGL context, not two hundred.
import { WebGLRenderer } from "three";
import { loadModel } from "./load";
import { configureRenderer, Stage } from "./stage";
import type { PaperModelFormat } from "../../templates/PaperPreview/kinds";

/** How long the renderer is kept after the last thumbnail, in case more are coming. */
const IDLE_MS = 20_000;

interface Studio {
    renderer: WebGLRenderer;
    stage: Stage;
}

let studio: Studio | null = null;
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;
let idle: ReturnType<typeof setTimeout> | undefined;

function openStudio(): Studio {
    if (studio && !studio.renderer.getContext().isContextLost()) return studio;
    closeStudio();
    const canvas = document.createElement("canvas");
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    configureRenderer(renderer);
    renderer.setPixelRatio(1);
    studio = { renderer, stage: new Stage(renderer) };
    return studio;
}

function closeStudio() {
    if (!studio) return;
    studio.stage.dispose();
    studio.renderer.dispose();
    studio.renderer.forceContextLoss();
    studio = null;
}

/** Draws the model at `src` as a `size`×`size` PNG with a transparent background. */
export function renderModelThumbnail(src: string, format: PaperModelFormat, size: number, signal?: AbortSignal): Promise<Blob> {
    if (!Number.isInteger(size) || size <= 0) return Promise.reject(new RangeError(`renderModelThumbnail: size must be a positive whole number of pixels, not ${size}`));
    clearTimeout(idle);
    waiting++;
    const job = queue.then(() => draw(src, format, size, signal));
    // the next job starts once this one has ended, either way: its caller hears how through `job`
    queue = job.then(ended, ended);
    return job;
}

function ended() {
    if (--waiting === 0) idle = setTimeout(closeStudio, IDLE_MS);
}

async function draw(src: string, format: PaperModelFormat, size: number, signal?: AbortSignal): Promise<Blob> {
    signal?.throwIfAborted();
    const { renderer, stage } = openStudio();
    const model = await loadModel(src, format, { renderer, signal });
    try {
        await model.settled;
        signal?.throwIfAborted();
        stage.show(model);
        renderer.setSize(size, size, false);
        stage.setAspect(1);
        stage.look(stage.home(1, 0.9));
        stage.render(renderer, true);
        return await new Promise<Blob>((resolve, reject) =>
            renderer.domElement.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("renderModelThumbnail: the picture couldn't be encoded"))), "image/png"),
        );
    } finally {
        // the stage frees the model it shows; one that never got there is freed here
        if (stage.model === model) stage.clear();
        else model.dispose();
    }
}
