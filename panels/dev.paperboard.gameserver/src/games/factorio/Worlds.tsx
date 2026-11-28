import { createSignal, For } from "solid-js";
import { PaperTable, formatBytes } from "@mileniumhq/paperui";
import { PANEL_ID } from "../../service/contract";
import { GameOptionItem } from "../../components/GameOptions";
import WorldsPage from "../../components/WorldsPage";
import { useServer } from "../../lib/server";
import { options } from "./index";
import { SAVE_NAME } from "./settings";
import type { FactorioWorld } from "./saves";

const SAVE_FILTERS = [{ name: "Factorio saves", extensions: ["zip"] }];
const UPLOAD_DIR = ".factorio-upload";
const GENERATION = options.filter((field) => field.scope === "world");

/** Factorio's worlds: its saves, one zip each in the server's saves folder. */
export default function FactorioWorlds() {
    const { calls, files } = useServer();
    // New World: the preset, seed and expansion the game makes it with
    const [generation, setGeneration] = createSignal<Record<string, unknown>>({});

    return (
        <WorldsPage
            list={() => calls.factorioWorlds()}
            game={{
                title: (world: FactorioWorld) => world.name,
                summary: (world) => `${formatBytes(world.bytes)} · Saved ${new Date(world.modified).toLocaleDateString()}`,
                details: (world) => (
                    <PaperTable>
                        <tbody>
                            <tr>
                                <th>File</th>
                                <td>{world().name}.zip · {formatBytes(world().bytes)}</td>
                            </tr>
                            <tr>
                                <th>Last saved</th>
                                <td>{new Date(world().modified).toLocaleString()}</td>
                            </tr>
                        </tbody>
                    </PaperTable>
                ),
                download: (world) => files.exportFile(`data/saves/${world.name}.zip`, PANEL_ID, { suggestedName: `${world.name}.zip`, filters: SAVE_FILTERS }),
                switchTo: (world) => calls.factorioWorld({ name: world.name, create: false }),
                remove: (world) => calls.factorioWorldDelete({ name: world.name }),
                deleteNote: (world) => `This moves "${world.name}" to the server folder's trash, with everything built in it. The server's autosaves stay in the saves folder.${world.active ? " This is the active world, so choose another before the next start; with no worlds left, the next start makes a new one." : ""}`,
                takenNames: (worlds) => worlds.map((w) => w.name),
                namePattern: SAVE_NAME,
                nameHint: "Letters, numbers, spaces, _, . and - only, starting with a letter or number.",
                create: {
                    defaultName: (taken) => {
                        const free = (name: string) => !taken.some((t) => t.toLowerCase() === name.toLowerCase());
                        if (free("World")) return "World";
                        for (let n = 2; ; n++) if (free(`World ${n}`)) return `World ${n}`;
                    },
                    load: async () => {
                        const saved = await calls.readGameOptions();
                        setGeneration(Object.fromEntries(GENERATION.map((field) => [field.id, saved[field.id] ?? (field.kind === "secret" ? "" : field.default)])));
                    },
                    fields: () => (
                        <For each={GENERATION}>
                            {(field) => (
                                <GameOptionItem
                                    field={field}
                                    value={generation()[field.id]}
                                    onChange={(value) => setGeneration((prev) => ({ ...prev, [field.id]: value }))}
                                />
                            )}
                        </For>
                    ),
                    note: "Factorio makes the world now, and the server plays it from its next start.",
                    submit: async (name) => {
                        await calls.factorioWorld({ name, create: true, generation: generation() });
                    },
                },
                // the page brings the zip in and the service checks it is a save
                upload: {
                    choose: async () => {
                        const file = `upload-${crypto.randomUUID()}.zip`;
                        const result = await files.importFile(`${UPLOAD_DIR}/${file}`, PANEL_ID, { filters: SAVE_FILTERS });
                        if (result.status === "canceled") return null;
                        const { suggestedName } = await calls.factorioWorldInspect({ file });
                        return { file, name: suggestedName, note: "Each start turns on the mods the save uses; put any it needs besides Space Age in the mods folder in Files first." };
                    },
                    discard: (file) => calls.factorioWorldDiscard({ file }),
                    add: (file, name) => calls.factorioWorldImport({ file, name }),
                    label: "World name",
                },
            }}
        />
    );
}
