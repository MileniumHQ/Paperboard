// What Drive's page and its service say to each other. Both import this
// file, so it runs in the browser and in Node and imports neither.
import { defineContract, shape, type Fields, type Infer } from "@mileniumhq/paperapi";

/** Passed explicitly to every API call: ambient scope resolves to the last panel imported. */
export const PANEL_ID = "dev.paperboard.drive";

/** Drive's own folder in the panel's storage: a folder like any linked one. */
export const DRIVE_FOLDER = "files";
/** The id of Drive's own folder among the places. */
export const OWN_PLACE = "drive";

/** What browse is given for the computer's own top: on Windows, the drive letters above each disk's top. */
export const COMPUTER = "computer";

/** The most of a file one call carries: the page uploads and reads files in pieces this size. */
export const CHUNK_BYTES = 4 * 1024 * 1024;

// Paths in a place are "/"-joined from its top, and "" is the top itself.
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

const place = shape.object({
    id: shape.text(),
    /** Drive's own folder, a disk plugged in, or a folder linked from this computer */
    kind: shape.oneOf("own", "disk", "folder"),
    name: shape.text(),
    /** where it is on this computer */
    location: shape.text(),
    /** false for a linked folder that isn't there now (on a disk unplugged) */
    available: shape.boolean(),
    /** the disk a linked folder is on, when it's on one that's plugged in */
    disk: shape.optional(shape.text()),
    /** bytes free and in all on its disk, once read */
    free: shape.optional(shape.number()),
    total: shape.optional(shape.number()),
});
export type Place = Infer<typeof place>;

const hostFolder = shape.object({
    path: shape.text(),
    name: shape.text(),
    /** the folder above (COMPUTER above a Windows drive letter); null at the top */
    parent: shape.nullable(shape.text()),
    folders: shape.list(shape.object({ name: shape.text(), path: shape.text() })),
    /** why this folder can't be linked, when it can't */
    cannotLink: shape.optional(shape.text()),
});
export type HostFolder = Infer<typeof hostFolder>;

/** Every call about files names the place they're in. */
const inPlace = <F extends Fields>(fields: F) => shape.object({ place: shape.text(), ...fields });
const at = inPlace({ path: shape.text() });
const byId = inPlace({ id: shape.text() });

export const driveContract = defineContract(PANEL_ID, {
    state: {
        shape: shape.object({ places: shape.list(place) }),
        initial: { places: [] },
    },
    calls: {
        /** links a folder on this computer into Drive; the place it is now */
        link: { input: shape.object({ folder: shape.text() }), output: place },
        /** stops showing a linked folder; its files stay where they are */
        unlink: { input: shape.object({ id: shape.text() }), output: shape.nothing() },
        /** lets a disk go so it can be pulled out */
        eject: { input: shape.object({ id: shape.text() }), output: shape.nothing() },
        /** the folders in a folder on this computer, to pick one to link; "" is the home folder, COMPUTER its top */
        browse: { input: shape.object({ folder: shape.text() }), output: hostFolder },
        /** what a folder holds; "" is the drive's top */
        list: { input: inPlace({ folder: shape.text() }), output: shape.list(entry) },
        /** one file or folder */
        stat: { input: at, output: entry },
        /** makes a folder; its entry */
        createFolder: { input: inPlace({ folder: shape.text(), name: shape.text() }), output: entry },
        /** gives a file or folder a new name in the same folder; its entry under the new name */
        rename: { input: inPlace({ path: shape.text(), name: shape.text() }), output: entry },
        /** moves files and folders into a folder; their entries there */
        move: { input: inPlace({ paths: shape.list(shape.text()), folder: shape.text() }), output: shape.list(entry) },
        /** deletes files and folders for good, folders with all they hold */
        delete: { input: inPlace({ paths: shape.list(shape.text()) }), output: shape.nothing() },
        /**
         * Starts an upload into a folder; its id. The file arrives in pieces
         * (uploadPut), in order, and lands under its name only once whole
         * (uploadFinish), beside any file already called that.
         */
        uploadBegin: { input: inPlace({ folder: shape.text(), name: shape.text(), size: shape.number() }), output: shape.object({ id: shape.text() }) },
        /** the next piece, base64, at the offset the upload has reached */
        uploadPut: { input: inPlace({ id: shape.text(), offset: shape.number(), data: shape.text() }), output: shape.nothing() },
        /** the upload is whole: it takes its place; its entry */
        uploadFinish: { input: byId, output: entry },
        /** drops an upload and what it had written */
        uploadCancel: { input: byId, output: shape.nothing() },
        /** a piece of a file from an offset, base64; `size` is the whole file's */
        read: {
            input: inPlace({ path: shape.text(), offset: shape.number() }),
            output: shape.object({ data: shape.text(), size: shape.number(), modified: shape.number() }),
        },
    },
    events: {
        /** files changed in these folders of a place: a window showing one lists it again */
        changed: shape.object({ place: shape.text(), folders: shape.list(shape.text()) }),
        /** a disk left without being ejected: pulled out, or let go by the system */
        unplugged: shape.object({ id: shape.text(), name: shape.text() }),
    },
});
