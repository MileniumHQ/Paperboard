// Drive's background service: it owns the places Drive shows (its own
// folder in the panel's data, the disks plugged in, the folders linked from
// this computer), and does everything the page and the blocks ask of them.
// The places live in the service's state, which every window mirrors. Each
// change to files says which folders of which place it touched, so every
// open window lists them again. Uploads a stop cut short leave their parts
// behind, which a later list of their folder removes (Drive.list).
import path from "node:path";
import { blocksApi, definePanelService, errorMessage, fileApi, problemsApi, type CallHandlers, type ContractContext } from "@mileniumhq/paperapi";
import { driveBlocks } from "./blocks";
import { DRIVE_FOLDER, driveContract, OWN_PLACE, PANEL_ID, parentOf } from "./lib/contract";
import { Places } from "./lib/places";

type Ctx = ContractContext<typeof driveContract>;

/** Which folders are linked into Drive. */
const PLACES_FILE = "places.json";

let places: Places | null = null;
let context: Ctx | null = null;

function ready(): Places {
    if (!places) throw new Error("Drive is still starting.");
    return places;
}

const drive = (place: string) => ready().drive(place);

function changed(place: string, folders: string[]) {
    context?.emit("changed", { place, folders: [...new Set(folders)] });
    places?.changed(place);
}

const calls: CallHandlers<typeof driveContract> = {
    link: ({ folder }) => ready().link(folder),
    unlink: ({ id }) => ready().unlink(id),
    eject: ({ id }) => ready().eject(id),
    browse: ({ folder }) => ready().browse(folder),
    list: async ({ place, folder }) => (await drive(place)).list(folder),
    stat: async ({ place, path }) => (await drive(place)).stat(path),
    createFolder: async ({ place, folder, name }) => {
        const entry = await (await drive(place)).createFolder(folder, name);
        changed(place, [folder]);
        return entry;
    },
    rename: async ({ place, path, name }) => {
        const entry = await (await drive(place)).rename(path, name);
        changed(place, [parentOf(path)]);
        return entry;
    },
    move: async ({ place, paths, folder }) => {
        const moved = await (await drive(place)).move(paths, folder);
        changed(place, [folder, ...paths.map(parentOf)]);
        return moved;
    },
    delete: async ({ place, paths }) => {
        await (await drive(place)).delete(paths);
        changed(place, paths.map(parentOf));
    },
    uploadBegin: async ({ place, folder, name, size }) => (await drive(place)).uploadBegin(folder, name, size),
    uploadPut: async ({ place, id, offset, data }) => (await drive(place)).uploadPut(id, offset, Buffer.from(data, "base64")),
    uploadFinish: async ({ place, id }) => {
        const entry = await (await drive(place)).uploadFinish(id);
        changed(place, [parentOf(entry.path)]);
        return entry;
    },
    uploadCancel: async ({ place, id }) => (await drive(place)).uploadCancel(id),
    read: async ({ place, path: file, offset }) => {
        const piece = await (await drive(place)).read(file, offset);
        return { data: piece.data.toString("base64"), size: piece.size, modified: piece.modified };
    },
};

export default definePanelService({
    contract: driveContract,
    calls,
    async onInit(ctx) {
        context = ctx;
        const data = await fileApi.getPath("", PANEL_ID);
        const opened = new Places({
            root: path.join(data, DRIVE_FOLDER),
            saved: path.join(data, PLACES_FILE),
            onChange: (list) => ctx.setState({ places: list }),
            onProblem: (key, title, error) => {
                if (error === null) problemsApi.clear(PANEL_ID, key);
                else problemsApi.report(PANEL_ID, { key, title, message: errorMessage(error) });
            },
        });
        await opened.open();
        places = opened;
        await blocksApi.panel(PANEL_ID).register(driveBlocks(opened.own, (folders) => changed(OWN_PLACE, folders)));
        console.log(`[${PANEL_ID}] service ready.`);
    },
});
