// Small PNG pictures of files, for a grid or a list: the picture itself, a
// film's frame, a recording's waveform, a document's first page, a model at
// its three-quarter angle, a font's "Aa". Each is made once per file, size
// and look, shared by everything that asks for it, and made a few at a time
// so a folder of hundreds never stalls the page.

import { loadWaveform } from "../../components/PaperAudio/waveform";
import { renderModelThumbnail } from "../../components/PaperModel";
import { renderPdfThumbnail } from "../../components/PaperPdf";
import { getVar } from "../../utils/theme";
import { previewKind, previewModelFormat, type PaperPreviewKind } from "./kinds";
import { loadPreviewFont } from "./viewers/FontView";
import { readTextStart } from "./viewers/read";
import { parseDelimited, sniffDelimiter } from "./viewers/TableView";

/** The file a thumbnail is made of: its address, its name, and what's known of its kind. */
export interface PaperPreviewThumbnailFile {
    src: string;
    name: string;
    type?: string;
    /** How the file previews, when its type and name don't say; null has no thumbnail. */
    kind?: PaperPreviewKind | null;
}

export interface PaperPreviewThumbnailOptions {
    /** The thumbnail's longer edge, in device pixels. */
    size: number;
    /** Stops waiting for it; the work stops too once nothing else is waiting. */
    signal?: AbortSignal;
}

// how many thumbnails are made at once, and how many are kept, by count and by bytes
const CONCURRENCY = 3;
const CACHE_ENTRIES = 300;
const CACHE_BYTES = 48 * 1024 * 1024;
// a text thumbnail reads only what fits on its page
const TEXT_BYTES = 16 * 1024;

interface Job {
    promise: Promise<Blob | null>;
    controller: AbortController;
    waiting: number;
    done: boolean;
    bytes: number;
}

// newest last, so the first key is the one used longest ago
const cache = new Map<string, Job>();
let cachedBytes = 0;

/**
 * A small PNG of a file, its longer edge `size` pixels, or null for a file
 * that has no picture (an archive, a program): show its kind's symbol
 * instead. It rejects when the file can't be read or drawn. Asking again for
 * the same file, size and look answers from memory.
 */
export function paperPreviewThumbnail(file: PaperPreviewThumbnailFile, options: PaperPreviewThumbnailOptions): Promise<Blob | null> {
    const kind = file.kind !== undefined ? file.kind : previewKind(file.name, file.type);
    if (!kind) return Promise.resolve(null);
    const size = Math.max(1, Math.round(options.size));
    const key = `${kind}|${size}|${tinted(kind) ? palette().join(",") : ""}|${file.src}`;

    let job = cache.get(key);
    if (job) {
        cache.delete(key);
        cache.set(key, job);
    } else {
        const controller = new AbortController();
        const made: Job = { controller, waiting: 0, done: false, bytes: 0, promise: Promise.resolve(null) };
        made.promise = queued(controller.signal, () => draw(kind, file, size, controller.signal)).then(
            (blob) => {
                made.done = true;
                if (cache.get(key) === made) {
                    made.bytes = blob?.size ?? 0;
                    cachedBytes += made.bytes;
                    trim();
                }
                return blob;
            },
            (err: unknown) => {
                // a failure is not remembered: the file may be readable next time
                forget(key, made);
                throw err;
            },
        );
        job = made;
        cache.set(key, job);
        trim();
    }
    return wait(key, job, options.signal);
}

/** Forgets every thumbnail made so far, such as after the files they show changed. */
export function clearPaperPreviewThumbnails(): void {
    for (const job of cache.values()) if (!job.done) job.controller.abort();
    cache.clear();
    cachedBytes = 0;
}

function wait(key: string, job: Job, signal?: AbortSignal): Promise<Blob | null> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    job.waiting++;
    // a caller that can't stop waiting keeps the work going to the end
    if (!signal) return job.promise.finally(() => job.waiting--);
    return new Promise((resolve, reject) => {
        const leave = () => {
            job.waiting--;
            // nobody wants it any more: stop making it
            if (job.waiting === 0 && !job.done) {
                job.controller.abort();
                forget(key, job);
            }
            reject(signal.reason);
        };
        signal.addEventListener("abort", leave, { once: true });
        job.promise.then(
            (blob) => {
                signal.removeEventListener("abort", leave);
                job.waiting--;
                resolve(blob);
            },
            (err: unknown) => {
                signal.removeEventListener("abort", leave);
                job.waiting--;
                reject(err);
            },
        );
    });
}

function forget(key: string, job: Job) {
    if (cache.get(key) !== job) return;
    cache.delete(key);
    cachedBytes -= job.bytes;
}

function trim() {
    for (const [key, job] of cache) {
        if (cache.size <= CACHE_ENTRIES && cachedBytes <= CACHE_BYTES) break;
        // one still being made is kept: someone is waiting on it
        if (!job.done) continue;
        forget(key, job);
    }
}

// ---------- a few at a time ----------

let running = 0;
const pending: Array<() => void> = [];

async function queued<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (running < CONCURRENCY) running++;
    else {
        // a job that finishes hands its place straight to this one
        await new Promise<void>((resolve, reject) => {
            const start = () => {
                signal.removeEventListener("abort", drop);
                resolve();
            };
            const drop = () => {
                pending.splice(pending.indexOf(start), 1);
                reject(signal.reason);
            };
            pending.push(start);
            signal.addEventListener("abort", drop, { once: true });
        });
    }
    try {
        signal.throwIfAborted();
        return await work();
    } finally {
        const next = pending.shift();
        if (next) next();
        else running--;
    }
}

// ---------- drawing ----------

// kinds drawn in the theme's colours, whose thumbnails change with the look
const tinted = (kind: PaperPreviewKind) => kind === "audio" || kind === "markdown" || kind === "code" || kind === "text" || kind === "table" || kind === "font";

function palette() {
    return [getVar("surface-raised"), getVar("text"), getVar("text-subtle"), getVar("border"), getVar("primary")];
}

async function draw(kind: PaperPreviewKind, file: PaperPreviewThumbnailFile, size: number, signal: AbortSignal): Promise<Blob> {
    switch (kind) {
        case "image":
            return drawImage(file.src, size, signal);
        case "video":
            return drawVideo(file.src, size, signal);
        case "audio":
            return drawWaveform(file.src, size, signal);
        case "pdf":
            return renderPdfThumbnail(file.src, size, signal);
        case "model": {
            const format = previewModelFormat(file.name, file.type);
            if (!format) throw new Error(`${file.name} isn't a 3D format PaperModel opens`);
            return renderModelThumbnail(file.src, format, size, signal);
        }
        case "table":
            return drawTable(file, size, signal);
        case "font":
            return drawFont(file.src, size, signal);
        case "markdown":
        case "code":
        case "text":
            return drawText(file.src, size, signal);
    }
}

interface Surface {
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    png(): Promise<Blob>;
}

/** A canvas off the page where the browser has one, else a detached one. */
function surface(width: number, height: number): Surface {
    if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(width, height);
        return { context: canvas.getContext("2d")!, png: () => canvas.convertToBlob({ type: "image/png" }) };
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return {
        context: canvas.getContext("2d")!,
        png: () =>
            new Promise((resolve, reject) =>
                canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("the thumbnail couldn't be encoded"))), "image/png"),
            ),
    };
}

/** A picture or film from a site that doesn't share it taints the canvas, which then can't be read. */
async function encode(png: () => Promise<Blob>): Promise<Blob> {
    try {
        return await png();
    } catch (err) {
        if (err instanceof DOMException && err.name === "SecurityError") throw new Error("is on a site that doesn't let it be drawn here");
        throw err;
    }
}

/** The size a picture takes when its longer edge is at most `size`, never enlarged. */
function fit(width: number, height: number, size: number) {
    const scale = Math.min(1, size / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function drawImage(src: string, size: number, signal: AbortSignal): Promise<Blob> {
    const img = new Image();
    img.decoding = "async";
    const stop = () => img.removeAttribute("src");
    signal.addEventListener("abort", stop, { once: true });
    try {
        img.src = src;
        try {
            await img.decode();
        } catch {
            // quiet: decode()'s own message ("The source image cannot be decoded") is replaced by one that names the cause
            signal.throwIfAborted();
            throw new Error("isn't a picture this browser can open");
        }
        signal.throwIfAborted();
        // a picture with no size of its own (an SVG without one) fills the square
        const { width, height } = fit(img.naturalWidth || size, img.naturalHeight || size, size);
        const { context, png } = surface(width, height);
        context.imageSmoothingQuality = "high";
        // a resize the browser does itself is sharper than one drawImage scales
        // quiet: a browser without resize options still draws it, scaled by drawImage below
        const bitmap = await createImageBitmap(img, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" }).catch(() => null);
        if (bitmap) {
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
        } else {
            context.drawImage(img, 0, 0, width, height);
        }
        return await encode(png);
    } finally {
        signal.removeEventListener("abort", stop);
        stop();
    }
}

async function drawVideo(src: string, size: number, signal: AbortSignal): Promise<Blob> {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const event = (name: string) =>
        new Promise<void>((resolve, reject) => {
            const done = () => {
                cleanup();
                resolve();
            };
            const failed = () => {
                cleanup();
                reject(signal.aborted ? signal.reason : new Error("isn't a film this browser can play"));
            };
            const cleanup = () => {
                video.removeEventListener(name, done);
                video.removeEventListener("error", failed);
                signal.removeEventListener("abort", failed);
            };
            video.addEventListener(name, done, { once: true });
            video.addEventListener("error", failed, { once: true });
            signal.addEventListener("abort", failed, { once: true });
        });
    try {
        const loaded = event("loadeddata");
        video.src = src;
        await loaded;
        // a frame a moment in reads better than a fade from black
        const at = Number.isFinite(video.duration) ? Math.min(video.duration * 0.1, 2) : 0;
        if (at > 0) {
            const seeked = event("seeked");
            video.currentTime = at;
            await seeked;
        }
        const { width, height } = fit(video.videoWidth, video.videoHeight, size);
        const { context, png } = surface(width, height);
        context.imageSmoothingQuality = "high";
        context.drawImage(video, 0, 0, width, height);
        return await encode(png);
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

/** A rounded bar, drawn as a path so it works where roundRect doesn't. */
function bar(context: Surface["context"], x: number, y: number, width: number, height: number) {
    const r = Math.min(width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
    context.fill();
}

async function drawWaveform(src: string, size: number, signal: AbortSignal): Promise<Blob> {
    const peaks = await loadWaveform(src, signal);
    signal.throwIfAborted();
    const { context, png } = surface(size, size);
    const bars = 24;
    const pitch = size / bars;
    const width = pitch * 0.55;
    const tallest = size * 0.6;
    context.fillStyle = getVar("primary");
    for (let i = 0; i < bars; i++) {
        // the loudest moment in this bar's stretch, so a short clap still shows
        const from = Math.floor((i * peaks.length) / bars);
        const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / bars));
        const peak = Math.max(0, ...peaks.slice(from, to));
        const height = Math.max(width, peak * tallest);
        bar(context, i * pitch + (pitch - width) / 2, (size - height) / 2, width, height);
    }
    return png();
}

/** A page, a little taller than wide, that a document's thumbnail is drawn on. */
function page(size: number) {
    const height = size;
    const width = Math.round(size * 0.78);
    const s = surface(width, height);
    const [paper, , , border] = palette();
    const line = Math.max(1, Math.round(size / 160));
    s.context.fillStyle = paper;
    s.context.fillRect(0, 0, width, height);
    s.context.strokeStyle = border;
    s.context.lineWidth = line;
    s.context.strokeRect(line / 2, line / 2, width - line, height - line);
    return { ...s, width, height, margin: Math.round(size * 0.08) };
}

async function drawText(src: string, size: number, signal: AbortSignal): Promise<Blob> {
    const { text } = await readTextStart(src, signal, TEXT_BYTES);
    const sheet = page(size);
    const { context, width, height, margin } = sheet;
    const [, ink] = palette();
    const fontSize = Math.max(4, size / 22);
    const lineHeight = fontSize * 1.4;
    context.fillStyle = ink;
    context.font = `${fontSize}px ${getVar("font-family-code") || "monospace"}`;
    // the page's own typeface, once it's in; until then the canvas would draw a stand-in
    await document.fonts.load(context.font);
    signal.throwIfAborted();
    context.textBaseline = "top";
    const lines = text.replace(/\t/g, "    ").split(/\r?\n/);
    const room = Math.floor((height - margin * 2) / lineHeight);
    for (let i = 0; i < Math.min(room, lines.length); i++) {
        context.fillText(lines[i], margin, margin + i * lineHeight, width - margin * 2);
    }
    return sheet.png();
}

async function drawTable(file: PaperPreviewThumbnailFile, size: number, signal: AbortSignal): Promise<Blob> {
    const { text } = await readTextStart(file.src, signal, TEXT_BYTES);
    const sheet = page(size);
    const { context, width, height, margin } = sheet;
    const [, ink, subtle, border] = palette();
    const rowHeight = Math.max(4, size / 14);
    const room = Math.floor((height - margin * 2) / rowHeight);
    const { rows } = parseDelimited(text, sniffDelimiter(text, file.name, file.type), room);
    const columns = Math.min(4, Math.max(1, ...rows.map((r) => r.length)));
    const columnWidth = (width - margin * 2) / columns;
    const fontSize = rowHeight * 0.55;
    await document.fonts.load(`600 ${fontSize}px ${getVar("font-family") || "sans-serif"}`);
    signal.throwIfAborted();
    context.textBaseline = "middle";
    context.strokeStyle = border;
    context.lineWidth = Math.max(1, Math.round(size / 200));
    rows.forEach((row, r) => {
        const y = margin + r * rowHeight;
        context.font = `${r === 0 ? 600 : 400} ${fontSize}px ${getVar("font-family") || "sans-serif"}`;
        context.fillStyle = r === 0 ? ink : subtle;
        for (let c = 0; c < columns; c++) {
            const cell = row[c] ?? "";
            context.fillText(cell, margin + c * columnWidth + fontSize * 0.3, y + rowHeight / 2, columnWidth - fontSize * 0.6);
        }
        context.beginPath();
        context.moveTo(margin, y + rowHeight);
        context.lineTo(width - margin, y + rowHeight);
        context.stroke();
    });
    return sheet.png();
}

let fonts = 0;
async function drawFont(src: string, size: number, signal: AbortSignal): Promise<Blob> {
    const family = `paper-thumbnail-${++fonts}`;
    const face = await loadPreviewFont(src, family, signal);
    document.fonts.add(face);
    try {
        const sheet = page(size);
        const { context, width, height } = sheet;
        const [, ink] = palette();
        context.fillStyle = ink;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.font = `${Math.round(size * 0.38)}px "${family}"`;
        context.fillText("Aa", width / 2, height / 2, width * 0.84);
        return await sheet.png();
    } finally {
        document.fonts.delete(face);
    }
}
