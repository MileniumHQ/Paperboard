// pdf.js as PaperPdf uses it: one shared worker thread, the data files pdf.js
// asks for at runtime, and the options every document opens with. Only the
// lazily loaded parts of PaperPdf import this, so pdf.js stays out of the
// main bundle.
// PaperUI's build bundles pdf.js's worker into a file of its own (pdf.worker.ts)
// and a consumer's build copies it next to its pages: same origin, so it
// loads under a panel's `worker-src 'self'`
import workerUrl from "./pdf.worker.ts?worker&url";
import { getDocument, PDFWorker, VerbosityLevel, type PDFDocumentLoadingTask } from "pdfjs-dist";

type DataKind = "cMapUrl" | "standardFontDataUrl" | "wasmUrl";

/** The glob's paths, keyed by file name, which is how pdf.js asks for them. */
function byName(files: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [path, url] of Object.entries(files)) out[path.slice(path.lastIndexOf("/") + 1)] = url;
    return out;
}

// The files pdf.js fetches while it reads a document: character maps for CJK
// text, the standard 14 fonts for text whose font isn't embedded, and the
// JBIG2 and JPEG 2000 image decoders. pdf.js normally builds each URL from a
// folder, but a consumer's bundler renames what it copies, so the files are
// looked up here by name instead. `?no-inline` keeps PaperUI's library build
// from inlining them as base64. The ICC colour decoder is left out: pdf.js
// only loads it by URL from inside its worker.
const DATA: Record<DataKind, Record<string, string>> = {
    cMapUrl: byName(
        import.meta.glob<string>("../../../node_modules/pdfjs-dist/cmaps/*.bcmap", {
            query: "?url&no-inline",
            import: "default",
            eager: true,
        }),
    ),
    standardFontDataUrl: byName(
        import.meta.glob<string>("../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}", {
            query: "?url&no-inline",
            import: "default",
            eager: true,
        }),
    ),
    wasmUrl: byName(
        import.meta.glob<string>("../../../node_modules/pdfjs-dist/wasm/{jbig2,openjpeg}.wasm", {
            query: "?url&no-inline",
            import: "default",
            eager: true,
        }),
    ),
};

/** A consumer's build may inline a small file as a data: URL, which a panel's connect-src won't fetch. */
function decodeDataUrl(url: string): Uint8Array {
    const comma = url.indexOf(",");
    const meta = url.slice(5, comma);
    const body = url.slice(comma + 1);
    if (!meta.endsWith(";base64")) return new TextEncoder().encode(decodeURIComponent(body));
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** Hands pdf.js its data files by name (getDocument's `BinaryDataFactory`). */
class BundledData {
    async fetch({ kind, filename }: { kind: DataKind; filename: string }): Promise<Uint8Array> {
        const url = DATA[kind]?.[filename];
        if (!url) throw new Error(`PDF data file ${filename} isn't part of PaperUI`);
        if (url.startsWith("data:")) return decodeDataUrl(url);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Can't load PDF data file ${filename}: HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    }
}

let worker: Promise<PDFWorker> | null = null;

/**
 * The worker every document shares. Starting one costs a module load and a
 * parse of pdf.js's core, so it starts on the first document and stays.
 * Each document is handed it explicitly: pdf.js then leaves it running when
 * that document is destroyed, while others still use it.
 */
export function pdfWorker(): Promise<PDFWorker> {
    worker ??= startWorker().catch((err: unknown) => {
        worker = null;
        throw err;
    });
    return worker;
}

async function startWorker(): Promise<PDFWorker> {
    let thread: Worker;
    try {
        thread = new Worker(workerUrl, { type: "module" });
    } catch (err) {
        return mainThreadWorker(err);
    }
    // the worker says "ready" once pdf.js has loaded in it; a file that is
    // missing or refused fires "error" instead, and pdf.js alone would wait
    // on it forever
    const failure = await new Promise<unknown>((resolve) => {
        const done = new AbortController();
        thread.addEventListener(
            "message",
            (event: MessageEvent) => {
                if (event.data?.action !== "ready") return;
                done.abort();
                resolve(null);
            },
            { signal: done.signal },
        );
        thread.addEventListener(
            "error",
            (event) => {
                event.preventDefault();
                done.abort();
                resolve(event.message || "the PDF worker didn't load");
            },
            { signal: done.signal },
        );
    });
    // pdf.js types `port` as null, but takes any MessagePort-like: a Worker is what it means
    if (failure === null) {
        // a worker that dies later (out of memory on a hostile file) isn't
        // handed to the next document: that one starts a fresh worker
        thread.addEventListener("error", () => (worker = null), { once: true });
        return new PDFWorker({ port: thread as unknown as null, verbosity: VerbosityLevel.ERRORS });
    }
    thread.terminate();
    return mainThreadWorker(failure);
}

/**
 * pdf.js's own fallback when no worker can start (a browser without module
 * workers, or a page whose policy refuses them): documents are parsed on the
 * page's thread, slower on big files but still opened. The same worker file
 * loads as a script here; it sets `globalThis.pdfjsWorker`, which is where
 * pdf.js looks for it, and leaves the page's messages alone.
 */
async function mainThreadWorker(reason: unknown): Promise<PDFWorker> {
    console.warn("PaperPdf: the PDF worker didn't start, so PDFs are read on the page's thread:", reason);
    await import(/* @vite-ignore */ workerUrl);
    return new PDFWorker({ verbosity: VerbosityLevel.ERRORS });
}

/**
 * Opens `src` (any URL the page can fetch, blob: included). PDFs are
 * untrusted, so nothing in one runs or reaches out: pdf.js 6 has no eval path
 * left, document JavaScript needs a scripting sandbox PaperPdf never loads,
 * XFA forms are off, and nothing renders links. Fonts that aren't embedded use
 * pdf.js's own metric-compatible fonts, so a page looks the same on every
 * system.
 */
export function openPdf(src: string, thread: PDFWorker): PDFDocumentLoadingTask {
    return getDocument({
        url: src,
        worker: thread,
        BinaryDataFactory: BundledData,
        useWorkerFetch: false,
        useSystemFonts: false,
        enableXfa: false,
        verbosity: VerbosityLevel.ERRORS,
    });
}

export interface PdfFailure {
    message: string;
    /** whether trying again could help: not for a locked or damaged file */
    retryable: boolean;
}

/** What a failed open or render says to the person, from pdf.js's error. */
export function describePdfError(err: unknown): PdfFailure {
    const name = err instanceof Error || (typeof err === "object" && err !== null) ? (err as { name?: unknown }).name : undefined;
    switch (name) {
        case "PasswordException":
            return { message: "This PDF is password-protected", retryable: false };
        case "InvalidPDFException":
        case "FormatError":
            return { message: "This PDF is damaged", retryable: false };
        case "ResponseException":
        case "UnexpectedResponseException":
        case "MissingPDFException":
            return { message: "Can't load PDF", retryable: true };
        default:
            return { message: "PDF unavailable", retryable: true };
    }
}

/** A render or text task stopped on purpose: the page scrolled away or the document closed. */
export function isCancellation(err: unknown): boolean {
    const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
    return name === "RenderingCancelledException" || name === "AbortException";
}
