import { createSignal, For, Show } from "solid-js";
import { PaperBadge, PaperCopyButton, PaperFlex, PaperQuote, PaperTable, formatBytes } from "@mileniumhq/paperui";
import { PANEL_ID } from "../../service/contract";
import { GameOptionItem } from "../../components/GameOptions";
import WorldsPage from "../../components/WorldsPage";
import { options } from "./index";
import { gameModeLabel, worldSizeLabel, type TerrariaWorldHeader } from "./worldFile";
import type { TerrariaWorld } from "./worldStore";
import { useServer } from "../../lib/server";

const WLD_FILTERS = [{ name: "Terraria worlds", extensions: ["wld"] }];
const UPLOAD_DIR = ".terraria-upload";
const NAME_PATTERN = /^[\p{L}\p{N} _-]{1,80}$/u;
const GENERATION = options.filter((field) => field.scope === "world");

/** 1.4.5 stores special-seed flags before the number: "pumpkinseason|345702611" */
function seedParts(seed: string): { number: string; flags: string[] } {
    const parts = seed.split("|");
    return { number: parts.at(-1) ?? "", flags: parts.slice(0, -1).filter(Boolean) };
}

function summary(header: TerrariaWorldHeader | null, generated = true): string {
    if (!generated) return "Not generated yet";
    return header ? `${worldSizeLabel(header.width)} · ${gameModeLabel(header.gameMode)}` : "Can't be read";
}

/** Terraria's worlds: each one .wld file in the server's worlds folder. */
export default function TerrariaWorlds() {
    const { calls, files } = useServer();
    // New World: the size, difficulty and seed Terraria generates it with
    const [generation, setGeneration] = createSignal<Record<string, unknown>>({});

    return (
        <WorldsPage
            list={() => calls.terrariaWorlds()}
            game={{
                title: (world) => world.header?.name ?? world.name,
                summary: (world) => summary(world.header, world.generated),
                badges: (world) => (
                    <Show when={world().header}>
                        {(header) => (
                            <PaperFlex direction="row" gap="onefourth" wrap>
                                <PaperBadge variant={header().evil === "crimson" ? "danger" : "primary"}>
                                    {header().evil === "crimson" ? "Crimson" : "Corruption"}
                                </PaperBadge>
                                <PaperBadge variant={header().hardmode ? "warning" : "monochrome"}>
                                    {header().hardmode ? "Hardmode" : "Pre-Hardmode"}
                                </PaperBadge>
                            </PaperFlex>
                        )}
                    </Show>
                ),
                details: (world) => (
                    <>
                        <Show when={world().error}>
                            <PaperQuote variant="warning" icon="warning" title="This world can't be read">
                                {world().error}
                            </PaperQuote>
                        </Show>
                        <PaperTable>
                            <tbody>
                                <Show when={world().header}>
                                    {(header) => (
                                        <>
                                            <tr>
                                                <th>Size</th>
                                                <td>{worldSizeLabel(header().width)} ({header().width} × {header().height} tiles)</td>
                                            </tr>
                                            <tr>
                                                <th>Difficulty</th>
                                                <td>{gameModeLabel(header().gameMode)}</td>
                                            </tr>
                                            <tr>
                                                <th>Seed</th>
                                                <td>
                                                    <PaperFlex direction="row" gap="half" align="center">
                                                        {seedParts(header().seed).number}
                                                        <PaperCopyButton text={seedParts(header().seed).number} />
                                                    </PaperFlex>
                                                </td>
                                            </tr>
                                            <tr>
                                                <th>Bosses defeated</th>
                                                <td>{header().bosses.length ? header().bosses.join(", ") : "None yet"}</td>
                                            </tr>
                                            <Show when={seedParts(header().seed).flags.length > 0}>
                                                <tr>
                                                    <th>Special seeds</th>
                                                    <td>{seedParts(header().seed).flags.join(", ")}</td>
                                                </tr>
                                            </Show>
                                        </>
                                    )}
                                </Show>
                                <Show
                                    when={world().generated}
                                    fallback={
                                        <tr>
                                            <th>World</th>
                                            <td>Generated the next time the server starts</td>
                                        </tr>
                                    }
                                >
                                    <tr>
                                        <th>File</th>
                                        <td>{world().name}.wld · {formatBytes(world().bytes)}</td>
                                    </tr>
                                    <tr>
                                        <th>Last saved</th>
                                        <td>{new Date(world().modified).toLocaleString()}</td>
                                    </tr>
                                </Show>
                            </tbody>
                        </PaperTable>
                    </>
                ),
                canDelete: (world) => world.generated,
                canSwitch: (world) => world.header !== null,
                download: (world) => files.exportFile(`worlds/${world.name}.wld`, PANEL_ID, { suggestedName: `${world.name}.wld`, filters: WLD_FILTERS }),
                switchTo: (world) => calls.terrariaWorld({ name: world.name, create: false }),
                remove: (world) => calls.terrariaWorldDelete({ name: world.name }),
                deleteNote: (world) => `This moves "${world.name}" and its backup to the server folder's trash, with everything built in it.${world.active ? " This is the active world. The server will generate a fresh one on the next start." : ""}`,
                takenNames: (worlds) => worlds.map((w) => w.name),
                namePattern: NAME_PATTERN,
                nameHint: "Letters, numbers, spaces, _ and - only.",
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
                    note: "The world is generated the next time the server starts.",
                    submit: async (name) => {
                        await calls.terrariaWorld({ name, create: true, generation: generation() });
                    },
                },
                // the page brings the .wld in and the service checks it is a world
                upload: {
                    choose: async () => {
                        const file = `upload-${crypto.randomUUID()}.wld`;
                        const result = await files.importFile(`${UPLOAD_DIR}/${file}`, PANEL_ID, { filters: WLD_FILTERS });
                        if (result.status === "canceled") return null;
                        const { header, suggestedName } = await calls.terrariaWorldInspect({ file });
                        return { file, name: suggestedName, note: `${header.name}: ${summary(header)}.` };
                    },
                    discard: (file) => calls.terrariaWorldDiscard({ file }),
                    add: (file, name) => calls.terrariaWorldImport({ file, name }),
                    label: "File name",
                },
            }}
        />
    );
}
