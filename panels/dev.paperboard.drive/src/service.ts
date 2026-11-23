// Drive's background service: it owns the drive folder in the panel's own
// data, and does everything the page and the blocks ask of it there. Each
// change says which folders it touched, so every open window lists them again.
// Uploads a stop cut short leave their parts behind, which the next start
// removes (Drive.open).
import path from "node:path";
import { blocksApi, definePanelService, fileApi, type CallHandlers, type ContractContext } from "@mileniumhq/paperapi";
import { driveBlocks } from "./blocks";
import { DRIVE_FOLDER, driveContract, PANEL_ID, parentOf } from "./lib/contract";
import { Drive } from "./lib/drive";

type Ctx = ContractContext<typeof driveContract>;

/** Where uploads wait beside the drive until they're whole. */
const UPLOADS_FOLDER = ".uploads";

let drive: Drive | null = null;
let context: Ctx | null = null;

function ready(): Drive {
    if (!drive) throw new Error("Drive is still starting.");
    return drive;
}

function changed(folders: string[]) {
    context?.emit("changed", { folders: [...new Set(folders)] });
}

const calls: CallHandlers<typeof driveContract> = {
    list: ({ folder }) => ready().list(folder),
    stat: ({ path }) => ready().stat(path),
    createFolder: async ({ folder, name }) => {
        const entry = await ready().createFolder(folder, name);
        changed([folder]);
        return entry;
    },
    rename: async ({ path, name }) => {
        const entry = await ready().rename(path, name);
        changed([parentOf(path)]);
        return entry;
    },
    move: async ({ paths, folder }) => {
        const moved = await ready().move(paths, folder);
        changed([folder, ...paths.map(parentOf)]);
        return moved;
    },
    delete: async ({ paths }) => {
        await ready().delete(paths);
        changed(paths.map(parentOf));
    },
    uploadBegin: ({ folder, name, size }) => ready().uploadBegin(folder, name, size),
    uploadPut: ({ id, offset, data }) => ready().uploadPut(id, offset, Buffer.from(data, "base64")),
    uploadFinish: async ({ id }) => {
        const entry = await ready().uploadFinish(id);
        changed([parentOf(entry.path)]);
        return entry;
    },
    uploadCancel: ({ id }) => ready().uploadCancel(id),
    read: async ({ path: file, offset }) => {
        const piece = await ready().read(file, offset);
        return { data: piece.data.toString("base64"), size: piece.size, modified: piece.modified };
    },
};

export default definePanelService({
    contract: driveContract,
    calls,
    async onInit(ctx) {
        context = ctx;
        const data = await fileApi.getPath("", PANEL_ID);
        const opened = new Drive(path.join(data, DRIVE_FOLDER), path.join(data, UPLOADS_FOLDER));
        await opened.open();
        drive = opened;
        await blocksApi.panel(PANEL_ID).register(driveBlocks(opened, changed));
        console.log(`[${PANEL_ID}] service ready.`);
    },
});
