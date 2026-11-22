// PaperPreview, PaperPreviewModal and the thumbnails, driven from window.t.
import { createSignal, type JSX } from "solid-js";
import {
    PaperButton,
    PaperPreview,
    PaperPreviewModal,
    PaperPreviewThumbnail,
    PaperProvider,
    paperPreviewThumbnail,
    type PaperPreviewFile,
} from "@mileniumhq/paperui";

const query = new URLSearchParams(location.search);
const shell = (content: () => JSX.Element) => (
    <PaperProvider fullScreen theme={query.get("theme") === "dark" ? "dark" : "light"}>
        {content()}
    </PaperProvider>
);

/** what a PNG blob decodes to, for a test to read */
async function measure(blob: Blob | null) {
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const size = { type: blob.type, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
}

/** a text file past the preview's 1 MB read */
const longText = () => URL.createObjectURL(new Blob(["line of a long log\n".repeat(80_000)], { type: "text/plain" }));

export const scenarios: Record<string, () => JSX.Element> = {
    preview() {
        const [file, setFile] = createSignal<PaperPreviewFile>({ name: "photo.png", src: "/files/photo.png" });
        window.t = { errors: [] as string[], show: setFile, longText };
        return shell(() => (
            <div style={{ width: "800px", height: "600px" }}>
                <PaperPreview {...file()} onError={(message) => window.t.errors.push(message)} />
            </div>
        ));
    },

    previewModal() {
        const [open, setOpen] = createSignal(false);
        const [file, setFile] = createSignal<PaperPreviewFile>({ name: "notes.md", src: "/files/notes.md" });
        const t = (window.t = {
            closes: 0,
            open: (f?: PaperPreviewFile) => {
                if (f) setFile(f);
                setOpen(true);
            },
            // a host that forgets the file as the preview closes
            closeAndClear: () => {
                setOpen(false);
                setFile({ name: "" });
            },
        });
        return shell(() => (
            <PaperPreviewModal
                open={open()}
                onClose={() => {
                    t.closes++;
                    setOpen(false);
                }}
                {...file()}
                actions={<PaperButton size="small">Save</PaperButton>}
            />
        ));
    },

    previewThumbnail() {
        window.t = {
            make: async (file: { src: string; name: string; type?: string }, size: number) => measure(await paperPreviewThumbnail(file, { size })),
            same: async () => {
                const file = { src: "/files/photo.png", name: "photo.png" };
                const [a, b] = await Promise.all([paperPreviewThumbnail(file, { size: 96 }), paperPreviewThumbnail(file, { size: 96 })]);
                const c = await paperPreviewThumbnail(file, { size: 96 });
                return a === b && b === c;
            },
            abort: async () => {
                const controller = new AbortController();
                const made = paperPreviewThumbnail({ src: "/files/photo.png", name: "photo.png" }, { size: 33, signal: controller.signal });
                controller.abort();
                return made.then(
                    () => "resolved",
                    (err: unknown) => (err instanceof DOMException ? err.name : String(err)),
                );
            },
            failure: () =>
                paperPreviewThumbnail({ src: "/files/missing.png", name: "missing.png" }, { size: 64 }).then(
                    () => "resolved",
                    (err: unknown) => String(err),
                ),
            errors: [] as string[],
        };
        return shell(() => (
            <div style={{ display: "flex", gap: "8px" }}>
                <PaperPreviewThumbnail id="photo" src="/files/photo.png" name="photo.png" fit="cover" />
                <PaperPreviewThumbnail id="zip" src="/files/archive.zip" name="archive.zip" />
                <PaperPreviewThumbnail id="broken" src="/files/missing.png" name="missing.png" onError={(m) => window.t.errors.push(m)} />
            </div>
        ));
    },
};
