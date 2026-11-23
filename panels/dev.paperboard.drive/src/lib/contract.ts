// What Drive's page and its service say to each other. Both import this
// file, so it runs in the browser and in Node and imports neither.
import { defineContract, shape, type Infer } from "@mileniumhq/paperapi";

/** Passed explicitly to every API call: ambient scope resolves to the last panel imported. */
export const PANEL_ID = "dev.paperboard.drive";

/** The drive's folder in the panel's own data. */
export const DRIVE_FOLDER = "Drive";

/** The most of a file one call carries: the page uploads and reads files in pieces this size. */
export const CHUNK_BYTES = 4 * 1024 * 1024;

// Paths in the drive are "/"-joined from its top, and "" is the top itself.
export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
export const parentOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
export const baseOf = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);

const entry = shape.object({
    name: shape.text(),
    /** "/"-joined from the drive's top; never "" (that is the drive itself) */
    path: shape.text(),
    kind: shape.oneOf("file", "folder"),
    /** a file's size in bytes; 0 for a folder */
    size: shape.number(),
    /** when it last changed, in ms since the epoch */
    modified: shape.number(),
    /** how many items a folder holds */
    count: shape.optional(shape.number()),
});
export type DriveEntry = Infer<typeof entry>;

const at = shape.object({ path: shape.text() });
const byId = shape.object({ id: shape.text() });

export const driveContract = defineContract(PANEL_ID, {
    calls: {
        /** what a folder holds; "" is the drive's top */
        list: { input: shape.object({ folder: shape.text() }), output: shape.list(entry) },
        /** one file or folder */
        stat: { input: at, output: entry },
        /** makes a folder; its entry */
        createFolder: { input: shape.object({ folder: shape.text(), name: shape.text() }), output: entry },
        /** gives a file or folder a new name in the same folder; its entry under the new name */
        rename: { input: shape.object({ path: shape.text(), name: shape.text() }), output: entry },
        /** moves files and folders into a folder; their entries there */
        move: { input: shape.object({ paths: shape.list(shape.text()), folder: shape.text() }), output: shape.list(entry) },
        /** deletes files and folders for good, folders with all they hold */
        delete: { input: shape.object({ paths: shape.list(shape.text()) }), output: shape.nothing() },
        /**
         * Starts an upload into a folder; its id. The file arrives in pieces
         * (uploadPut), in order, and lands under its name only once whole
         * (uploadFinish), beside any file already called that.
         */
        uploadBegin: { input: shape.object({ folder: shape.text(), name: shape.text(), size: shape.number() }), output: shape.object({ id: shape.text() }) },
        /** the next piece, base64, at the offset the upload has reached */
        uploadPut: { input: shape.object({ id: shape.text(), offset: shape.number(), data: shape.text() }), output: shape.nothing() },
        /** the upload is whole: it takes its place; its entry */
        uploadFinish: { input: byId, output: entry },
        /** drops an upload and what it had written */
        uploadCancel: { input: byId, output: shape.nothing() },
        /** a piece of a file from an offset, base64; `size` is the whole file's */
        read: {
            input: shape.object({ path: shape.text(), offset: shape.number() }),
            output: shape.object({ data: shape.text(), size: shape.number(), modified: shape.number() }),
        },
    },
    events: {
        /** files changed in these folders: a window showing one lists it again */
        changed: shape.object({ folders: shape.list(shape.text()) }),
    },
});
