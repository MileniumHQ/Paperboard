import { createEffect, createSignal, For, on, onMount, Show } from "solid-js";
import {
    PaperAvatar,
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperCopyButton,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperTable,
    PaperText,
} from "@mileniumhq/paperui";
import { fileApi } from "../../lib/api";
import { serverBridge, serverStatus } from "../../lib/server";
import { PANEL_ID } from "../../service/contract";
import { errorMessage, type Outcome } from "../../lib/failure";
import { GameOptionControl } from "../../components/GameOptions";
import { options } from "./index";
import { gameModeLabel, worldSizeLabel, type TerrariaWorldHeader } from "./worldFile";
import type { TerrariaWorld } from "./worldStore";

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

function fileSize(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function WorldTile(props: { active: boolean }) {
    return <PaperAvatar shape="square" size="large" fallbackIcon="public" accent={props.active ? "success" : undefined} />;
}

export default function TerrariaWorlds() {
    const [worlds, setWorlds] = createSignal<TerrariaWorld[] | null>(null);
    const [listError, setListError] = createSignal("");
    const [selected, setSelected] = createSignal<string | null>(null);
    const [mutating, setMutating] = createSignal(false);
    const [actionError, setActionError] = createSignal<Outcome | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);
    const online = () => serverStatus() !== "offline";

    // a failed listing keeps the last-known worlds and shows why
    const refresh = async () => {
        try {
            setWorlds(await serverBridge.call<TerrariaWorld[]>("terraria-worlds"));
            setListError("");
        } catch (err) {
            setListError(errorMessage(err));
        }
    };
    onMount(() => void refresh());
    // starting creates the active world and stopping saves it: list again
    createEffect(on(serverStatus, () => void refresh(), { defer: true }));

    const taken = (name: string) => (worlds() ?? []).some((w) => w.name.toLowerCase() === name.trim().toLowerCase());
    const detail = () => worlds()?.find((w) => w.name === selected()) ?? null;
    // what the world modal shows: the last world it opened on, kept through
    // the close fade so the modal doesn't empty out as it leaves
    const [shown, setShown] = createSignal<ReturnType<typeof detail>>(null);
    createEffect(() => { const world = detail(); if (world) setShown(world); });

    const run = async (title: string, work: () => Promise<unknown>) => {
        setMutating(true);
        setActionError(null);
        try {
            await work();
            await refresh();
            return true;
        } catch (err) {
            setActionError({ title, message: errorMessage(err) });
            return false;
        } finally {
            setMutating(false);
        }
    };

    const switchTo = async (name: string) => {
        if (await run("World not switched", () => serverBridge.call("terraria-world", { name, create: false }))) setSelected(null);
    };

    const confirmDelete = async () => {
        const name = selected();
        setDeleteConfirmOpen(false);
        if (!name) return;
        if (await run("World not deleted", () => serverBridge.call("terraria-world-delete", { name }))) setSelected(null);
    };

    const [downloading, setDownloading] = createSignal(false);
    const download = async (name: string) => {
        setDownloading(true);
        setActionError(null);
        try {
            await fileApi.exportFile(`worlds/${name}.wld`, PANEL_ID, { suggestedName: `${name}.wld`, filters: WLD_FILTERS });
        } catch (err) {
            setActionError({ title: "World not downloaded", message: errorMessage(err) });
        } finally {
            setDownloading(false);
        }
    };

    // New World: a name and the size, difficulty and seed Terraria generates it with
    const [createOpen, setCreateOpen] = createSignal(false);
    const [newName, setNewName] = createSignal("World");
    const [generation, setGeneration] = createSignal<Record<string, unknown>>({});
    const [createError, setCreateError] = createSignal("");
    const newNameValid = () => NAME_PATTERN.test(newName().trim());
    const openCreate = async () => {
        setCreateError("");
        setNewName(suggestName("World"));
        setCreateOpen(true);
        try {
            const saved = await serverBridge.call<Record<string, unknown>>("read-game-options");
            setGeneration(Object.fromEntries(GENERATION.map((field) => [field.id, saved[field.id] ?? (field.kind === "secret" ? "" : field.default)])));
        } catch (err) {
            setCreateError(errorMessage(err));
        }
    };
    const submitCreate = async () => {
        if (!newNameValid() || taken(newName()) || mutating()) return;
        setMutating(true);
        setCreateError("");
        try {
            await serverBridge.call("terraria-world", { name: newName().trim(), create: true, generation: generation() });
            setCreateOpen(false);
            await refresh();
        } catch (err) {
            setCreateError(errorMessage(err));
        } finally {
            setMutating(false);
        }
    };
    const suggestName = (base: string) => {
        if (!taken(base)) return base;
        for (let n = 2; ; n++) if (!taken(`${base} ${n}`)) return `${base} ${n}`;
    };

    // Upload: the page brings the .wld in, the service checks it is a world,
    // the user names it. Nothing existing is replaced, so this works while
    // the server runs.
    const [upload, setUpload] = createSignal<{ file: string; header: TerrariaWorldHeader } | null>(null);
    const [uploadName, setUploadName] = createSignal("");
    const [uploading, setUploading] = createSignal(false);
    const uploadNameValid = () => NAME_PATTERN.test(uploadName().trim()) && !taken(uploadName());

    const chooseUpload = async () => {
        setActionError(null);
        const file = `upload-${crypto.randomUUID()}.wld`;
        try {
            const result = await fileApi.importFile(`${UPLOAD_DIR}/${file}`, PANEL_ID, { filters: WLD_FILTERS });
            if (result.status === "canceled") return;
            const { header, suggestedName } = await serverBridge.call<{ header: TerrariaWorldHeader; suggestedName: string }>("terraria-world-inspect", { file });
            setUploadName(suggestedName);
            setUpload({ file, header });
        } catch (err) {
            setActionError({ title: "World not uploaded", message: errorMessage(err) });
        }
    };

    const cancelUpload = async () => {
        const current = upload();
        setUpload(null);
        if (!current) return;
        try {
            await serverBridge.call("terraria-world-discard", { file: current.file });
        } catch (err) {
            setActionError({ title: "Cleanup incomplete", message: `The uploaded world could not be removed: ${errorMessage(err)}` });
        }
    };

    const submitUpload = async () => {
        const current = upload();
        if (!current || !uploadNameValid() || uploading()) return;
        setUploading(true);
        try {
            await serverBridge.call("terraria-world-import", { file: current.file, name: uploadName().trim() });
            setUpload(null);
            await refresh();
        } catch (err) {
            // the service removed the upload; choosing again starts over
            setUpload(null);
            setActionError({ title: "World not added", message: errorMessage(err) });
        } finally {
            setUploading(false);
        }
    };

    const emptyCard = (text: string) => (
        <PaperCard>
            <PaperFlex padding="full" center>
                <PaperText size={3} color="text-subtle">{text}</PaperText>
            </PaperFlex>
        </PaperCard>
    );

    return (
        <>
            <PaperPageHeader icon="public" title="Worlds">
                <PaperButton onClick={() => void chooseUpload()}>
                    <PaperIcon>upload</PaperIcon>
                    Upload World
                </PaperButton>
                <PaperEffect variant="success">
                    <PaperButton variant="success" disabled={online()} onClick={() => void openCreate()}>
                        <PaperIcon>add</PaperIcon>
                        New World
                    </PaperButton>
                </PaperEffect>
            </PaperPageHeader>
            <Show when={online()}>
                <PaperQuote variant="warning" icon="warning" title="Server running">
                    Stop the server to switch, create, or delete worlds.
                </PaperQuote>
            </Show>
            <Show when={actionError()}>
                {(failure) => (
                    <PaperQuote variant="danger" icon="warning" title={failure().title}>
                        {failure().message}
                    </PaperQuote>
                )}
            </Show>
            <Show when={listError()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't list the worlds">
                    {listError()}
                </PaperQuote>
            </Show>

            <Show when={worlds() !== null} fallback={emptyCard(listError() ? "Couldn't load worlds." : "Loading worlds...")}>
                <Show when={(worlds() ?? []).length > 0} fallback={emptyCard("No worlds yet. Create one, or start the server to generate one.")}>
                    <PaperList
                        name="terraria-worlds"
                        value=""
                        onValueChange={(name) => setSelected(String(name))}
                        buttons
                        fullWidth
                    >
                        <For each={worlds() ?? []}>
                            {(world) => (
                                <PaperListItem
                                    value={world.name}
                                    icon={<WorldTile active={world.active} />}
                                    description={summary(world.header, world.generated)}
                                    actions={world.active ? <PaperBadge variant="success">Active</PaperBadge> : undefined}
                                >
                                    {world.header?.name ?? world.name}
                                </PaperListItem>
                            )}
                        </For>
                    </PaperList>
                </Show>
            </Show>

            <PaperModal
                open={detail() !== null}
                onClose={() => setSelected(null)}
                title={shown()?.header?.name ?? shown()?.name ?? ""}
                size="medium"
                footer={
                    <>
                        <PaperButton onClick={() => setSelected(null)}>Close</PaperButton>
                        <Show when={shown()?.generated}>
                            <PaperButton
                                disabled={downloading() || mutating()}
                                onClick={() => { const name = shown()?.name; if (name) void download(name); }}>
                                <PaperIcon>download</PaperIcon>
                                Download
                            </PaperButton>
                        </Show>
                        <Show when={shown()?.generated}>
                            <PaperButton variant="danger" disabled={online() || mutating()} onClick={() => setDeleteConfirmOpen(true)}>
                                <PaperIcon>delete</PaperIcon>
                                Delete
                            </PaperButton>
                        </Show>
                        <Show when={!(shown()?.active ?? false)}>
                            <PaperButton
                                variant="success"
                                disabled={online() || mutating() || !shown()?.header}
                                onClick={() => { const name = shown()?.name; if (name) void switchTo(name); }}>
                                Switch to this world
                            </PaperButton>
                        </Show>
                    </>
                }
            >
                <Show when={shown()} keyed>
                    {(world) => (
                        <PaperFlex direction="column" gap="full">
                            <PaperFlex direction="row" gap="full" align="center">
                                <WorldTile active={world.active} />
                                <PaperFlex direction="column" gap="onefourth">
                                    <Show
                                        when={world.active}
                                        fallback={<PaperText size={3} color="text-subtle">Inactive. Switching takes effect after a restart.</PaperText>}
                                    >
                                        <PaperBadge variant="success">Active world</PaperBadge>
                                    </Show>
                                    <PaperText size={3}>{summary(world.header, world.generated)}</PaperText>
                                    <Show when={world.header}>
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
                                </PaperFlex>
                            </PaperFlex>
                            <Show when={world.error}>
                                <PaperQuote variant="danger" icon="warning" title="This world can't be read">
                                    {world.error}
                                </PaperQuote>
                            </Show>
                            <PaperTable>
                                <tbody>
                                    <Show when={world.header}>
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
                                        when={world.generated}
                                        fallback={
                                            <tr>
                                                <th>World</th>
                                                <td>Generated the next time the server starts</td>
                                            </tr>
                                        }
                                    >
                                        <tr>
                                            <th>File</th>
                                            <td>{world.name}.wld · {fileSize(world.bytes)}</td>
                                        </tr>
                                        <tr>
                                            <th>Last saved</th>
                                            <td>{new Date(world.modified).toLocaleString()}</td>
                                        </tr>
                                    </Show>
                                </tbody>
                            </PaperTable>
                        </PaperFlex>
                    )}
                </Show>
            </PaperModal>

            <PaperModal
                open={upload() !== null}
                onClose={() => { if (!uploading()) void cancelUpload(); }}
                title="Add uploaded world"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" disabled={uploading()} onClick={() => void cancelUpload()}>Cancel</PaperButton>
                        <PaperButton variant="success" disabled={!uploadNameValid() || uploading()} onClick={() => void submitUpload()}>
                            {uploading() ? "Adding..." : "Add world"}
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText size={3}>
                        {upload()?.header.name}: {summary(upload()?.header ?? null)}. The world is added beside the others. Switch to it when the server is stopped.
                    </PaperText>
                    <PaperInput
                        fullWidth
                        label="File name"
                        value={uploadName()}
                        invalid={uploadName().trim() !== "" && !uploadNameValid()}
                        onInput={(e) => setUploadName(e.currentTarget.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void submitUpload(); }}
                    />
                    <Show when={uploadName().trim() && !uploadNameValid()}>
                        <PaperText size={2} color="danger">
                            {taken(uploadName()) ? "A world already has this name." : "Use letters, numbers, spaces, - and _ only."}
                        </PaperText>
                    </Show>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={createOpen()}
                onClose={() => setCreateOpen(false)}
                title="New World"
                size="medium"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setCreateOpen(false)}>Cancel</PaperButton>
                        <PaperButton
                            variant="success"
                            disabled={!newNameValid() || taken(newName()) || worlds() === null || mutating()}
                            onClick={() => void submitCreate()}>
                            Create
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="full">
                    <PaperFlex direction="column" gap="half">
                        <PaperInput
                            fullWidth
                            label="World name"
                            value={newName()}
                            invalid={(newName().trim() !== "" && !newNameValid()) || taken(newName())}
                            onInput={(e) => { setNewName(e.currentTarget.value); setCreateError(""); }}
                        />
                        <Show when={taken(newName())}>
                            <PaperText size={2} color="danger">There's already a world that's named this.</PaperText>
                        </Show>
                        <Show when={newName() && !newNameValid() && !taken(newName())}>
                            <PaperText size={2} color="text-subtle">Letters, numbers, spaces, _ and - only.</PaperText>
                        </Show>
                        <PaperText size={2} color="text-subtle">The world is generated the next time the server starts.</PaperText>
                        <Show when={createError()}>
                            <PaperQuote variant="danger" icon="warning" title="World not created">{createError()}</PaperQuote>
                        </Show>
                    </PaperFlex>
                    <PaperSettingList autoHeight>
                        <For each={GENERATION}>
                            {(field) => (
                                <PaperSettingItem title={field.label} description={field.description}>
                                    <GameOptionControl
                                        field={field}
                                        value={generation()[field.id]}
                                        onChange={(value) => setGeneration((prev) => ({ ...prev, [field.id]: value }))}
                                    />
                                </PaperSettingItem>
                            )}
                        </For>
                    </PaperSettingList>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={deleteConfirmOpen()}
                onClose={() => setDeleteConfirmOpen(false)}
                title={`Delete world "${shown()?.header?.name ?? selected() ?? ""}"`}
                size="small"
                footer={
                    <>
                        <PaperButton onClick={() => setDeleteConfirmOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" onClick={() => void confirmDelete()}>Delete</PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    This moves "{selected()}" and its backup to the server folder's trash, with everything built in it.
                    <Show when={shown()?.active}>
                        {" "}This is the active world. The server will generate a fresh one on the next start.
                    </Show>
                </PaperText>
            </PaperModal>
        </>
    );
}
