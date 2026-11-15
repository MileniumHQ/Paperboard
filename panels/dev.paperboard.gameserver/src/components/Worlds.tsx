import { createSignal, For } from "solid-js";
import { PaperTable } from "@mileniumhq/paperui";
import { useServer } from "../lib/server";
import { FieldItem } from "./PropertyFieldControl";
import WorldsPage from "./WorldsPage";
import { readServerPropertiesStrict, writeServerProperties } from "../lib/properties";
import { normalizeLevelType, worldCreateFields, WORLD_NAME_PATTERN, type WorldInfo } from "../lib/worlds";
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
    // the service owns listing, switching, deleting and zipping worlds (its trash discipline included)
    const server = useServer();
    const { calls, files } = server;
    const fields = worldCreateFields(server);
    // a world's zip runs through the transfer folder; zipping a big world takes a while
    const discard = (file: string) => calls.discardWorldTransfer({ file });
    // New World's settings, as server.properties holds them when it opens
    const [createValues, setCreateValues] = createSignal<Record<string, string>>({});
    const createValue = (key: string, fallback: string) => shownValue(key, createValues()[key] ?? fallback);

    return (
        <WorldsPage
            list={() => calls.listWorlds()}
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
                    const { file } = await calls.exportWorld({ levelName: world.name });
                    try {
                        await files.exportFile(`${WORLD_TRANSFER_DIR}/${file}`, PANEL_ID, { suggestedName: `${world.name}.zip`, filters: ZIP_FILTERS });
                    } finally {
                        await discard(file).catch((err) =>
                            warn({ title: "Cleanup incomplete", message: `The world's temporary zip could not be removed: ${errorMessage(err)}` }));
                    }
                },
                switchTo: (world) => calls.setActiveWorld({ levelName: world.name, createOnly: false }),
                remove: (world) => calls.deleteWorld({ levelName: world.name }),
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
                        const properties = await readServerPropertiesStrict(files);
                        setCreateValues(Object.fromEntries(fields.map((field) => [field.key, shownValue(field.key, properties[field.key] ?? field.defaultValue)])));
                    },
                    fields: () => (
                        <For each={fields}>
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
                        await writeServerProperties(files, createValues());
                        // createOnly: the service refuses an existing name instead of
                        // degrading into a silent switch when the listing was stale
                        await calls.setActiveWorld({ levelName: name, seed: createValue("level-seed", "").trim() || undefined, createOnly: true });
                    },
                },
                // the page brings the zip in and the service unpacks it into new folders
                upload: {
                    choose: async (taken) => {
                        const file = `upload-${crypto.randomUUID()}.zip`;
                        const result = await files.importFile(`${WORLD_TRANSFER_DIR}/${file}`, PANEL_ID, { filters: ZIP_FILTERS });
                        return result.status === "canceled" ? null : { file, name: worldNameFromFile(result.name, taken) };
                    },
                    discard,
                    add: (file, levelName) => calls.importWorld({ file, levelName }),
                    label: "World name",
                },
            }}
        />
    );
}
