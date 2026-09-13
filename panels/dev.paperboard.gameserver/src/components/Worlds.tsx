import {
    createEffect,
    createSignal,
    For,
    on,
    onMount,
    Show,
} from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSettingItem,
    PaperSettingList,
    PaperTable,
    PaperText,
} from "@paperboard-dev/paperui";
import { FieldControl } from "./PropertyFieldControl";
import { readServerProperties, writeServerProperties } from "../lib/properties";
import {
    deleteActiveWorldDirs,
    listWorlds,
    setActiveWorld,
    WORLD_CREATE_FIELDS,
    WORLD_NAME_PATTERN,
    type WorldInfo,
} from "../lib/worlds";
import { serverStatus } from "../lib/server";

function dimensionsLabel(info: WorldInfo): string {
    if (!info.generated) return "Not generated yet";
    const parts = ["Overworld"];
    if (info.hasNether) parts.push("Nether");
    if (info.hasEnd) parts.push("End");
    return parts.join(" · ");
}

function WorldTile(props: { active: boolean }) {
    return (
        <span
            style={{
                display: "inline-flex",
                "align-items": "center",
                "justify-content": "center",
                width: "4.5rem",
                height: "4.5rem",
                "border-radius": "var(--paper-border-radius)",
                background: props.active
                    ? "color-mix(in srgb, var(--paper-front-green) 16%, transparent)"
                    : "color-mix(in srgb, var(--paper-anti-background) 8%, transparent)",
                "font-size": "2.25rem",
            }}
        >
            <PaperIcon>public</PaperIcon>
        </span>
    );
}

export default function Worlds() {
    const [worlds, setWorlds] = createSignal<WorldInfo[] | null>(null);
    const [listError, setListError] = createSignal("");

    const [selected, setSelected] = createSignal<WorldInfo | null>(null);
    const [createOpen, setCreateOpen] = createSignal(false);
    const [newName, setNewName] = createSignal("world");
    const [createValues, setCreateValues] = createSignal<Record<string, string>>({});
    const [mutating, setMutating] = createSignal(false);
    const [actionError, setActionError] = createSignal("");
    const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);

    const online = () => serverStatus() !== "offline";

    const refresh = async () => {
        setListError("");
        try {
            setWorlds(await listWorlds());
        } catch (err) {
            console.error("[Worlds] Failed to list worlds:", err);
            setWorlds([]);
            setListError("Could not list world directories. Check the console for details.");
        }
    };

    onMount(async () => {
        await refresh();
        const props = await readServerProperties();
        const next: Record<string, string> = {};
        for (const field of WORLD_CREATE_FIELDS) {
            next[field.key] = props[field.key] ?? field.defaultValue;
        }
        setCreateValues(next);
    });

    // refresh whenever the server starts or stops: dimension data and the
    // active world's files change without any UI action, so the list keeps
    // itself current — no Refresh button to forget to press.
    createEffect(on(serverStatus, () => void refresh(), { defer: true }));

    const createValue = (key: string, fallback: string) =>
        createValues()[key] ?? fallback;

    const setCreateValue = (key: string, value: string) =>
        setCreateValues((prev) => ({ ...prev, [key]: value }));

    const nameValid = () => WORLD_NAME_PATTERN.test(newName().trim());

    const runActivate = async (name: string, seed?: string) => {
        setMutating(true);
        setActionError("");
        try {
            await setActiveWorld(name, seed || undefined);
            await refresh();
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Worlds] Failed to activate "${name}":`, message);
            setActionError(message);
            return false;
        } finally {
            setMutating(false);
        }
    };

    const confirmSwitch = async () => {
        const target = selected();
        if (!target || target.active) return;
        if (await runActivate(target.name)) setSelected(null);
    };

    const confirmDelete = async () => {
        const target = selected();
        setDeleteConfirmOpen(false);
        if (!target) return;
        setMutating(true);
        setActionError("");
        try {
            await deleteActiveWorldDirs(target.name);
            setSelected(null);
            await refresh();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Worlds] Failed to delete "${target.name}":`, message);
            setActionError(message);
        } finally {
            setMutating(false);
        }
    };

    const submitCreate = async () => {
        if (!nameValid()) return;
        const name = newName().trim();
        if ((worlds() ?? []).some((w) => w.name.toLowerCase() === name.toLowerCase())) {
            setActionError(`A world named "${name}" already exists.`);
            return;
        }
        setActionError("");
        try {
            // generation settings land first; setActiveWorld then reads the
            // merged file and writes level-name/level-seed on top
            await writeServerProperties(createValues());
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[Worlds] Failed to write generation settings:", message);
            setActionError(message);
            return;
        }
        if (await runActivate(name, createValue("level-seed", "").trim() || undefined)) {
            setCreateOpen(false);
            setNewName("world");
        }
    };

    const detail = () => {
        const target = selected();
        if (!target) return null;
        return worlds()?.find((w) => w.name === target.name) ?? target;
    };

    return (
        <PaperFlex direction="column" fullWidth fullHeight style={{ "min-height": 0 }}>
            <div class="gs-scroll">
                <div class="gs-page">
                    <PaperPageHeader icon="public" title="Worlds">
                        <PaperEffect>
                            <PaperButton
                                compact
                                variant="green"
                                disabled={online()}
                                onClick={() => setCreateOpen(true)}
                            >
                                <PaperIcon>add</PaperIcon>
                                New World
                            </PaperButton>
                        </PaperEffect>
                    </PaperPageHeader>
                    <Show when={online()}>
                        <PaperQuote variant="yellow" icon="warning" title="Server running">
                            Stop the server to switch, create, or delete worlds.
                        </PaperQuote>
                    </Show>
                    <Show when={actionError()}>
                        <PaperQuote variant="red" icon="warning" title="Error">
                            {actionError()}
                        </PaperQuote>
                    </Show>
                    <Show when={listError()}>
                        <PaperQuote variant="red" icon="warning" title="Error">
                            {listError()}
                        </PaperQuote>
                    </Show>

                    <Show
                        when={worlds() !== null}
                        fallback={
                            <div class="gs-surface">
                                <PaperFlex padding="full" center>
                                    <PaperText size={3} color="light-text">
                                        Loading worlds...
                                    </PaperText>
                                </PaperFlex>
                            </div>
                        }
                    >
                        <Show
                            when={(worlds() ?? []).length > 0}
                            fallback={
                                <div class="gs-surface">
                                    <PaperFlex padding="full" center>
                                        <PaperText size={3} color="light-text">
                                            No worlds on disk yet. Create one to get started.
                                        </PaperText>
                                    </PaperFlex>
                                </div>
                            }
                        >
                            <div class="gs-surface">
                                <PaperFlex padding="full">
                                    <PaperMediaCardGroup minCardWidth="15rem">
                                        <For each={worlds() ?? []}>
                                            {(world) => (
                                                <PaperMediaCard
                                                    icon={<WorldTile active={world.active} />}
                                                    title={world.name}
                                                    subtitle={dimensionsLabel(world)}
                                                    badge={
                                                        world.active ? (
                                                            <PaperBadge variant="green">
                                                                Active
                                                            </PaperBadge>
                                                        ) : undefined
                                                    }
                                                    onClick={() => setSelected(world)}
                                                />
                                            )}
                                        </For>
                                    </PaperMediaCardGroup>
                                </PaperFlex>
                            </div>
                        </Show>
                    </Show>
                </div>
            </div>

            <PaperModal
                open={detail() !== null}
                onClose={() => setSelected(null)}
                title={detail()?.name ?? ""}
                size="medium"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton compact onClick={() => setSelected(null)}>
                            Close
                        </PaperButton>
                        <PaperButton
                            compact
                            variant="red"
                            disabled={online() || mutating()}
                            onClick={() => setDeleteConfirmOpen(true)}
                        >
                            <PaperIcon>delete</PaperIcon>
                            Delete
                        </PaperButton>
                        <Show when={!(detail()?.active ?? false)}>
                            <PaperButton
                                compact
                                variant="green"
                                disabled={online() || mutating()}
                                onClick={() => void confirmSwitch()}
                            >
                                Switch to this world
                            </PaperButton>
                        </Show>
                    </PaperFlex>
                }
            >
                <Show when={detail()} keyed>
                    {(world) => (
                        <PaperFlex direction="column" gap="full">
                            <PaperFlex direction="row" gap="full" align="center">
                                <WorldTile active={world.active} />
                                <PaperFlex direction="column" gap="onefourth">
                                    <Show
                                        when={world.active}
                                        fallback={
                                            <PaperText size={3} color="light-text">
                                                Inactive — switching takes effect after a restart.
                                            </PaperText>
                                        }
                                    >
                                        <PaperBadge variant="green">Active world</PaperBadge>
                                    </Show>
                                    <PaperText size={3}>{dimensionsLabel(world)}</PaperText>
                                </PaperFlex>
                            </PaperFlex>
                            <PaperTable>
                                <tbody>
                                    <tr>
                                        <th>Overworld</th>
                                        <td>
                                            {world.generated
                                                ? "Generated"
                                                : "Not generated yet"}
                                        </td>
                                    </tr>
                                    <tr>
                                        <th>Nether</th>
                                        <td>{world.hasNether ? "Generated" : "Not generated yet"}</td>
                                    </tr>
                                    <tr>
                                        <th>End</th>
                                        <td>{world.hasEnd ? "Generated" : "Not generated yet"}</td>
                                    </tr>
                                </tbody>
                            </PaperTable>
                        </PaperFlex>
                    )}
                </Show>
            </PaperModal>

            <PaperModal
                open={createOpen()}
                onClose={() => setCreateOpen(false)}
                title="New World"
                size="medium"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton compact onClick={() => setCreateOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            compact
                            variant="green"
                            disabled={!nameValid() || mutating()}
                            onClick={() => void submitCreate()}
                        >
                            Create
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperFlex direction="column" gap="full">
                    <PaperFlex direction="column" gap="half">
                        <PaperInput
                            fullWidth
                            placeholder="World name"
                            value={newName()}
                            onInput={(e) => setNewName(e.currentTarget.value)}
                        />
                        <Show when={newName() && !nameValid()}>
                            <PaperText size={2} color="light-text">
                                Letters, numbers, _ and - only, starting with a letter or number.
                            </PaperText>
                        </Show>
                    </PaperFlex>

                    <div class="gs-surface">
                        <PaperSettingList autoHeight>
                            <For each={WORLD_CREATE_FIELDS}>
                                {(field) => (
                                    <PaperSettingItem
                                        title={field.title}
                                        description={field.description}
                                    >
                                        <FieldControl
                                            field={field}
                                            value={() => createValue(field.key, field.defaultValue)}
                                            onUpdate={(value) => setCreateValue(field.key, value)}
                                        />
                                    </PaperSettingItem>
                                )}
                            </For>
                        </PaperSettingList>
                    </div>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={deleteConfirmOpen()}
                onClose={() => setDeleteConfirmOpen(false)}
                title={`Delete world "${selected()?.name ?? ""}"`}
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton compact onClick={() => setDeleteConfirmOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton compact variant="red" onClick={() => void confirmDelete()}>
                            Delete
                        </PaperButton>
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    This moves the overworld
                    <Show when={selected()?.hasNether}> , nether</Show>
                    <Show when={selected()?.hasEnd}> and end</Show> directories of
                    "{selected()?.name}" to trash, including all builds and items
                    in them.
                    <Show when={selected()?.active}>
                        {" "}This is the active world — the server will generate a
                        fresh one on the next start.
                    </Show>
                </PaperText>
            </PaperModal>
        </PaperFlex>
    );
}
