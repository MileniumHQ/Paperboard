import { createSignal, For } from "solid-js";
import { PaperTable } from "@mileniumhq/paperui";
import { fileApi } from "../lib/api";
import { FieldItem } from "./PropertyFieldControl";
import WorldsPage from "./WorldsPage";
import { readServerPropertiesStrict, writeServerProperties } from "../lib/properties";
import {
    deleteActiveWorldDirs,
    discardWorldTransfer,
    exportWorld,
    importWorld,
    listWorlds,
    normalizeLevelType,
    setActiveWorld,
    WORLD_CREATE_FIELDS,
    WORLD_NAME_PATTERN,
    type WorldInfo,
} from "../lib/worlds";
import { PANEL_ID } from "../service/contract";
import { DIMENSION_SUFFIXES, WORLD_TRANSFER_DIR, worldNameFromFile } from "../core/worldArchive";
import { errorMessage } from "../lib/failure";

const ZIP_FILTERS = [{ name: "World zips", extensions: ["zip"] }];

function dimensionsLabel(info: WorldInfo): string {
    if (!info.generated) return "Not generated yet";
    const parts = ["Overworld"];
    if (info.hasNether) parts.push("Nether");
    if (info.hasEnd) parts.push("End");
    return parts.join(" · ");
}

// a level type as the select names it
const shownValue = (key: string, raw: string) => (key === "level-type" ? normalizeLevelType(raw) : raw);

const generated = (made: boolean) => (made ? "Generated" : "Not generated yet");

/** Minecraft's worlds: each a level folder with its Nether and End beside it. */
export default function Worlds() {
    // New World's settings, as server.properties holds them when it opens
    const [createValues, setCreateValues] = createSignal<Record<string, string>>({});
    const createValue = (key: string, fallback: string) => shownValue(key, createValues()[key] ?? fallback);

    return (
        <WorldsPage
            list={listWorlds}
            game={{
                listName: "worlds",
                title: (world) => world.name,
                summary: dimensionsLabel,
                details: (world) => (
                    <PaperTable>
                        <tbody>
                            <tr>
                                <th>Overworld</th>
                                <td>{generated(world().generated)}</td>
                            </tr>
                            <tr>
                                <th>Nether</th>
                                <td>{generated(world().hasNether)}</td>
                            </tr>
                            <tr>
                                <th>End</th>
                                <td>{generated(world().hasEnd)}</td>
                            </tr>
                        </tbody>
                    </PaperTable>
                ),
                // the service zips the world, the page saves the zip, and the
                // zip is removed again whatever the person chose
                download: async (world, warn) => {
                    const { file } = await exportWorld(world.name);
                    try {
                        await fileApi.exportFile(`${WORLD_TRANSFER_DIR}/${file}`, PANEL_ID, { suggestedName: `${world.name}.zip`, filters: ZIP_FILTERS });
                    } finally {
                        await discardWorldTransfer(file).catch((err) =>
                            warn({ title: "Cleanup incomplete", message: `The world's temporary zip could not be removed: ${errorMessage(err)}` }));
                    }
                },
                switchTo: (world) => setActiveWorld(world.name),
                remove: (world) => deleteActiveWorldDirs(world.name),
                deleteNote: (world) =>
                    `This moves the overworld${world.hasNether ? ", nether" : ""}${world.hasEnd ? " and end" : ""} directories of "${world.name}" to trash, including all builds and items in them.`,
                // a world's Nether and End are folders of their own beside it
                takenNames: (worlds) => worlds.flatMap((w) => DIMENSION_SUFFIXES.map((suffix) => `${w.name}${suffix}`)),
                namePattern: WORLD_NAME_PATTERN,
                nameHint: "Letters, numbers, _ and - only, starting with a letter or number.",
                create: {
                    defaultName: () => "world",
                    // never filled with defaults over settings that can't be read
                    load: async () => {
                        const properties = await readServerPropertiesStrict();
                        setCreateValues(Object.fromEntries(WORLD_CREATE_FIELDS.map((field) => [field.key, shownValue(field.key, properties[field.key] ?? field.defaultValue)])));
                    },
                    fields: () => (
                        <For each={WORLD_CREATE_FIELDS}>
                            {(field) => (
                                <FieldItem
                                    field={field}
                                    value={() => createValue(field.key, field.defaultValue)}
                                    onUpdate={(value) => setCreateValues((prev) => ({ ...prev, [field.key]: value }))}
                                />
                            )}
                        </For>
                    ),
                    submit: async (name) => {
                        // generation settings land first; setActiveWorld then reads the
                        // merged file and writes level-name/level-seed on top
                        await writeServerProperties(createValues());
                        // createOnly: the service refuses an existing name instead of
                        // degrading into a silent switch when the listing was stale
                        await setActiveWorld(name, createValue("level-seed", "").trim() || undefined, true);
                    },
                },
                // the page brings the zip in and the service unpacks it into new folders
                upload: {
                    choose: async (taken) => {
                        const file = `upload-${crypto.randomUUID()}.zip`;
                        const result = await fileApi.importFile(`${WORLD_TRANSFER_DIR}/${file}`, PANEL_ID, { filters: ZIP_FILTERS });
                        return result.status === "canceled" ? null : { file, name: worldNameFromFile(result.name, taken) };
                    },
                    discard: discardWorldTransfer,
                    add: importWorld,
                    label: "World name",
                },
            }}
        />
    );
}
