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
    getVarCss,
    PaperCard,
    PaperAvatar,
} from "@paperboard-dev/paperui";
import { FieldControl } from "./PropertyFieldControl";
import { readServerProperties, writeServerProperties } from "../lib/properties";
import {
    deleteActiveWorldDirs,
    isWorldNameTaken,
    listWorlds,
    normalizeLevelType,
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
        <PaperAvatar
            shape="square"
            size="large"
            fallbackIcon="public"
            style={{
                background: props.active
                    ? `color-mix(in srgb, ${getVarCss("success")} 16%, transparent)`
                    : `color-mix(in srgb, ${getVarCss("contrast")} 8%, transparent)`,
            }}
        />
    );
}

export default function Worlds() {
    const [worlds, setWorlds] = createSignal<WorldInfo[] | null>(null);
    const [listError, setListError] = createSignal("");

    const [selected, setSelected] = createSignal<WorldInfo | null>(null);
    const [createOpen, setCreateOpen] = createSignal(false);
    const [newName, setNewName] = createSignal("world");
    const [createValues, setCreateValues] = createSignal<Record<string, string>>({});
    const [createError, setCreateError] = createSignal("");
    const [mutating, setMutating] = createSignal(false);
    const [actionError, setActionError] = createSignal("");
    const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);

    const online = () => serverStatus() !== "offline";

    // A listing failure keeps the last-known worlds on screen and shows the
    // error: replacing them with [] would claim "no worlds yet" and would
    // silently disable the duplicate check for the New World dialog.
    const refresh = async () => {
        try {
            setWorlds(await listWorlds());
            setListError("");
        } catch (err) {
            console.error("[Worlds] Failed to list worlds:", err);
            setListError("Could not list world directories. Check the console for details.");
        }
    };

    onMount(async () => {
        await refresh();
        const props = await readServerProperties();
        const next: Record<string, string> = {};
        for (const field of WORLD_CREATE_FIELDS) {
            const raw = props[field.key] ?? field.defaultValue;
            next[field.key] =
                field.key === "level-type" ? normalizeLevelType(raw) : raw;
        }
        setCreateValues(next);
    });

    // refresh whenever the server starts or stops: dimension data and the
    // active world's files change without any UI action, so the list keeps
    // itself current — no Refresh button to forget to press.
    createEffect(on(serverStatus, () => void refresh(), { defer: true }));

    const createValue = (key: string, fallback: string) => {
        const raw = createValues()[key] ?? fallback;
        return key === "level-type" ? normalizeLevelType(raw) : raw;
    };

    const setCreateValue = (key: string, value: string) =>
        setCreateValues((prev) => ({ ...prev, [key]: value }));

    const nameValid = () => WORLD_NAME_PATTERN.test(newName().trim());

    // Case-insensitive against every listed world (generated or pending).
    // null means the listing is unavailable — the boundary then decides.
    const nameTaken = () =>
        isWorldNameTaken(
            (worlds() ?? []).map((w) => w.name),
            newName(),
        );

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
        if (!nameValid() || nameTaken() || worlds() === null || mutating()) return;
        const name = newName().trim();
        setCreateError("");
        setMutating(true);
        try {
            try {
                // generation settings land first; setActiveWorld then reads the
                // merged file and writes level-name/level-seed on top
                await writeServerProperties(createValues());
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error("[Worlds] Failed to write generation settings:", message);
                setCreateError(message);
                return;
            }
            try {
                // createOnly: the service refuses an existing name instead of
                // degrading into a silent switch when the listing above was stale
                await setActiveWorld(name, createValue("level-seed", "").trim() || undefined, true);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[Worlds] Failed to create "${name}":`, message);
                setCreateError(message);
                return;
            }
            await refresh();
            setCreateOpen(false);
            setNewName("world");
        } finally {
            setMutating(false);
        }
    };

    const detail = () => {
        const target = selected();
        if (!target) return null;
        return worlds()?.find((w) => w.name === target.name) ?? target;
    };

    return (
        <>
                    <PaperPageHeader icon="public" title="Worlds">
                        <PaperEffect variant="success">
                            <PaperButton
                                variant="success"
                                disabled={online()}
                                onClick={() => {
                                    setCreateError("");
                                    setCreateOpen(true);
                                }}>
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
                        <PaperQuote variant="danger" icon="warning" title="Error">
                            {actionError()}
                        </PaperQuote>
                    </Show>
                    <Show when={listError()}>
                        <PaperQuote variant="danger" icon="warning" title="Error">
                            {listError()}
                        </PaperQuote>
                    </Show>

                    <Show
                        when={worlds() !== null}
                        fallback={
                            <PaperCard>
                                <PaperFlex padding="full" center>
                                    <PaperText size={3} color="text-subtle">
                                        {listError()
                                            ? "Couldn't load worlds."
                                            : "Loading worlds..."}
                                    </PaperText>
                                </PaperFlex>
                            </PaperCard>
                        }
                    >
                        <Show
                            when={(worlds() ?? []).length > 0}
                            fallback={
                                <PaperCard>
                                    <PaperFlex padding="full" center>
                                        <PaperText size={3} color="text-subtle">
                                            {listError()
                                                ? "Couldn't load worlds."
                                                : "No worlds yet. Create one, or start the server to generate one."}
                                        </PaperText>
                                    </PaperFlex>
                                </PaperCard>
                            }
                        >
                            <PaperCard>
                                <PaperFlex padding="full">
                                    <PaperMediaCardGroup minCardWidth={getVarCss("size-card-min")}>
                                        <For each={worlds() ?? []}>
                                            {(world) => (
                                                <PaperMediaCard
                                                    icon={<WorldTile active={world.active} />}
                                                    title={world.name}
                                                    subtitle={dimensionsLabel(world)}
                                                    badge={
                                                        world.active ? (
                                                            <PaperBadge variant="success">
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
                            </PaperCard>
                        </Show>
                    </Show>

            <PaperModal
                open={detail() !== null}
                onClose={() => setSelected(null)}
                title={detail()?.name ?? ""}
                size="medium"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={() => setSelected(null)}>
                            Close
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={online() || mutating()}
                            onClick={() => setDeleteConfirmOpen(true)}>
                            <PaperIcon>delete</PaperIcon>
                            Delete
                        </PaperButton>
                        <Show when={!(detail()?.active ?? false)}>
                            <PaperButton
                                variant="success"
                                disabled={online() || mutating()}
                                onClick={() => void confirmSwitch()}>
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
                                            <PaperText size={3} color="text-subtle">
                                                Inactive. Switching takes effect after a restart.
                                            </PaperText>
                                        }
                                    >
                                        <PaperBadge variant="success">Active world</PaperBadge>
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
                        <PaperButton onClick={() => setCreateOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="success"
                            disabled={
                                !nameValid() ||
                                nameTaken() ||
                                worlds() === null ||
                                mutating()
                            }
                            onClick={() => void submitCreate()}>
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
                            invalid={
                                (newName().trim() !== "" && !nameValid()) ||
                                nameTaken()
                            }
                            onInput={(e) => {
                                setNewName(e.currentTarget.value);
                                setCreateError("");
                            }}
                        />
                        <Show when={nameTaken()}>
                            <PaperText size={2} color="danger">
                                There's already a world that's named this.
                            </PaperText>
                        </Show>
                        <Show when={newName() && !nameValid() && !nameTaken()}>
                            <PaperText size={2} color="text-subtle">
                                Letters, numbers, _ and - only, starting with a letter or number.
                            </PaperText>
                        </Show>
                        <Show when={worlds() === null && !listError()}>
                            <PaperText size={2} color="text-subtle">
                                Checking existing worlds...
                            </PaperText>
                        </Show>
                        <Show when={createError()}>
                            <PaperQuote variant="danger" icon="warning" title="Error">
                                {createError()}
                            </PaperQuote>
                        </Show>
                    </PaperFlex>

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
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={deleteConfirmOpen()}
                onClose={() => setDeleteConfirmOpen(false)}
                title={`Delete world "${selected()?.name ?? ""}"`}
                size="small"
                footer={
                    <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                        <PaperButton onClick={() => setDeleteConfirmOpen(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton variant="danger" onClick={() => void confirmDelete()}>
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
                        {" "}This is the active world. The server will generate a
                        fresh one on the next start.
                    </Show>
                </PaperText>
            </PaperModal>
        </>
    );
}
