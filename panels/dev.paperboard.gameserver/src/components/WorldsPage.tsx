import { createEffect, createSignal, For, on, Show, untrack, type JSX } from "solid-js";
import { useServer } from "../lib/server";
import {
    PaperAvatar,
    PaperBadge,
    PaperButton,
    PaperCard,
    PaperEffect,
    PaperError,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSettingList,
    PaperText,
    createRead,
    showError,
} from "@mileniumhq/paperui";
import { errorMessage, type Outcome } from "../lib/failure";

/** What every game's Worlds tab knows about a world. */
export interface WorldEntry {
    /** what the game calls it on disk, unique among the worlds */
    name: string;
    active: boolean;
    generated: boolean;
}

/** An uploaded world waiting for its name. */
export interface WorldUpload {
    /** where the service holds it until it is added or discarded */
    file: string;
    /** the name the dialog suggests */
    name: string;
    /** what the dialog says about it before the field */
    note?: string;
}

/** How a game's worlds are created, uploaded, switched and removed. */
export interface WorldsGame<W extends WorldEntry> {
    /** what the list and dialogs call a world */
    title(world: W): string;
    /** the row under its title */
    summary(world: W): string;
    /** badges under the summary in the world's dialog */
    badges?(world: () => W): JSX.Element;
    /** the world's dialog below its tile; `world` follows it as the list updates */
    details(world: () => W): JSX.Element;
    canDelete?(world: W): boolean;
    canSwitch?(world: W): boolean;
    /** saves the world where the person picks; `warn` tells of trouble after it was saved */
    download(world: W, warn: (outcome: Outcome) => void): Promise<unknown>;
    switchTo(world: W): Promise<unknown>;
    remove(world: W): Promise<unknown>;
    /** what deleting moves to the trash */
    deleteNote(world: W): JSX.Element;
    /** every name a new world cannot take */
    takenNames(worlds: readonly W[]): string[];
    namePattern: RegExp;
    /** the rule a name breaks, as the dialogs say it */
    nameHint: string;
    create: {
        /** the name the dialog starts on, free among `taken` */
        defaultName(taken: readonly string[]): string;
        /** reads what the dialog's settings start on */
        load(): Promise<void>;
        /** the dialog's settings, kept by the game */
        fields(): JSX.Element;
        note?: string;
        submit(name: string): Promise<void>;
    };
    upload: {
        /** asks for the file and brings it in; null when the person called it off */
        choose(taken: readonly string[]): Promise<WorldUpload | null>;
        discard(file: string): Promise<unknown>;
        add(file: string, name: string): Promise<unknown>;
        /** the name field's label */
        label: string;
    };
}

function WorldTile(props: { active: boolean }) {
    return <PaperAvatar shape="square" size="large" fallbackIcon="public" accent={props.active ? "success" : undefined} />;
}

const emptyCard = (text: string) => (
    <PaperCard>
        <PaperFlex padding="full" center>
            <PaperText size={3} color="text-subtle">{text}</PaperText>
        </PaperFlex>
    </PaperCard>
);

/**
 * A game's Worlds tab: the list, which is read again whenever the server
 * starts or stops; each world's dialog with Download, Delete and Switch; and
 * New World and Upload World. A failed listing keeps the last-known worlds
 * on screen and says why: replacing them with none would claim there are no
 * worlds, and would let a new world take a name that is in use.
 */
export default function WorldsPage<W extends WorldEntry>(props: { list: () => Promise<W[]>; game: WorldsGame<W> }) {
    const { serverStatus } = useServer();
    // starting and stopping change the active world's files: each is read again.
    // A failed listing keeps the last-known worlds, each world the row it is
    const listing = createRead(() => props.list(), {
        source: serverStatus,
        key: "name",
        message: errorMessage,
    });
    const worlds = () => listing.value() ?? null;
    const retryListing = () => ({ label: "Try again", disabled: listing.loading(), onClick: () => void listing.reload() });
    const [selected, setSelected] = createSignal<string | null>(null);
    const [mutating, setMutating] = createSignal(false);
    const [deleteOpen, setDeleteOpen] = createSignal(false);
    const online = () => serverStatus() !== "offline";
    const taken = () => props.game.takenNames(worlds() ?? []);
    const isTaken = (name: string) => {
        const clean = name.trim().toLowerCase();
        return clean !== "" && taken().some((t) => t.toLowerCase() === clean);
    };
    const nameValid = (name: string) => props.game.namePattern.test(name.trim()) && !isTaken(name);

    const fail = (title: string, err: unknown) => showError(title, errorMessage(err));
    /** runs a change to the worlds, then lists them again; false when it failed */
    const run = async (title: string, work: () => Promise<unknown>) => {
        setMutating(true);
        let done = false;
        try {
            await work();
            await listing.reload();
            done = true;
        } catch (err) {
            fail(title, err);
        } finally {
            setMutating(false);
        }
        return done;
    };

    const detail = () => worlds()?.find((w) => w.name === selected()) ?? null;
    // what the world's dialog shows: the last world it opened on, kept
    // through the close fade so the dialog doesn't empty out as it leaves
    const [shown, setShown] = createSignal<W | null>(null);
    createEffect(on(detail, (world) => { if (world) setShown(() => world); }));

    const switchTo = async (world: W) => {
        if (await run("Couldn't switch the world", () => props.game.switchTo(world))) setSelected(null);
    };
    const confirmDelete = async () => {
        const world = detail();
        setDeleteOpen(false);
        if (world && (await run("Couldn't delete the world", () => props.game.remove(world)))) setSelected(null);
    };

    const [downloading, setDownloading] = createSignal(false);
    const download = async (world: W) => {
        setDownloading(true);
        try {
            await props.game.download(world, (outcome) => showError(outcome.title, outcome.message));
        } catch (err) {
            fail("Couldn't download the world", err);
        } finally {
            setDownloading(false);
        }
    };

    // New World: a name, and the settings the game generates it with; Create
    // waits for those settings, so a world is never made from guesses
    const [createOpen, setCreateOpen] = createSignal(false);
    const [createReady, setCreateReady] = createSignal(false);
    const [newName, setNewName] = createSignal("");
    const openCreate = async () => {
        setCreateReady(false);
        setNewName(props.game.create.defaultName(taken()));
        setCreateOpen(true);
        try {
            await props.game.create.load();
            setCreateReady(true);
        } catch (err) {
            fail("Couldn't load the new world's settings", err);
        }
    };
    const canCreate = () => createReady() && worlds() !== null && nameValid(newName()) && !mutating();
    const submitCreate = async () => {
        if (!canCreate()) return;
        setMutating(true);
        try {
            await props.game.create.submit(newName().trim());
            setCreateOpen(false);
            await listing.reload();
        } catch (err) {
            fail("Couldn't create the world", err);
        } finally {
            setMutating(false);
        }
    };

    // Upload: the page brings the file in and the person names the world.
    // Nothing existing is replaced, so this works while the server runs.
    const [upload, setUpload] = createSignal<WorldUpload | null>(null);
    const [uploadName, setUploadName] = createSignal("");
    const [uploading, setUploading] = createSignal(false);
    const chooseUpload = async () => {
        try {
            const chosen = await props.game.upload.choose(taken());
            if (!chosen) return;
            setUploadName(chosen.name);
            setUpload(chosen);
        } catch (err) {
            fail("Couldn't upload the world", err);
        }
    };
    const cancelUpload = async () => {
        const current = upload();
        setUpload(null);
        if (!current) return;
        try {
            await props.game.upload.discard(current.file);
        } catch (err) {
            fail("Couldn't remove the uploaded world", err);
        }
    };
    const submitUpload = async () => {
        const current = upload();
        if (!current || !nameValid(uploadName()) || uploading()) return;
        setUploading(true);
        try {
            await props.game.upload.add(current.file, uploadName().trim());
            setUpload(null);
            await listing.reload();
        } catch (err) {
            // the service removed the upload; choosing again starts over
            setUpload(null);
            fail("Couldn't add the world", err);
        } finally {
            setUploading(false);
        }
    };

    /** why `name` can't be used, or "" when it can or nothing is typed */
    const nameProblem = (name: string) => {
        if (!name.trim()) return "";
        if (isTaken(name)) return "There's already a world that's named this.";
        return props.game.namePattern.test(name.trim()) ? "" : props.game.nameHint;
    };

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
            {/* the worlds read before stay listed, under why they couldn't be read again */}
            <Show when={worlds() !== null && listing.error()}>
                {(err) => <PaperError title="Couldn't load the worlds" error={err()} action={retryListing()} />}
            </Show>
            <Show
                when={worlds() !== null}
                fallback={
                    <Show when={listing.error()} fallback={emptyCard("Loading worlds...")}>
                        {(err) => <PaperError fill title="Couldn't load the worlds" error={err()} action={retryListing()} />}
                    </Show>
                }
            >
                <Show when={(worlds() ?? []).length > 0} fallback={emptyCard("No worlds yet. Create one, or start the server to generate one.")}>
                    <PaperMediaCardGroup minCardWidth="card-min">
                        <For each={worlds() ?? []}>
                            {(world) => (
                                <PaperMediaCard
                                    data-world={world.name}
                                    icon={<WorldTile active={world.active} />}
                                    title={props.game.title(world)}
                                    subtitle={props.game.summary(world)}
                                    badge={world.active ? <PaperBadge variant="success">Active</PaperBadge> : undefined}
                                    onClick={() => setSelected(world.name)}
                                />
                            )}
                        </For>
                    </PaperMediaCardGroup>
                </Show>
            </Show>

            <PaperModal
                open={detail() !== null}
                onClose={() => setSelected(null)}
                title={shown() ? props.game.title(shown()!) : ""}
                size="medium"
                footer={
                    <Show when={shown()}>
                        {(world) => (
                            <>
                                <PaperButton onClick={() => setSelected(null)}>Close</PaperButton>
                                <Show when={world().generated}>
                                    <PaperButton disabled={downloading() || mutating()} onClick={() => void download(world())}>
                                        <PaperIcon>download</PaperIcon>
                                        {downloading() ? "Downloading..." : "Download"}
                                    </PaperButton>
                                </Show>
                                <Show when={props.game.canDelete?.(world()) ?? true}>
                                    <PaperButton variant="danger" disabled={online() || mutating()} onClick={() => setDeleteOpen(true)}>
                                        <PaperIcon>delete</PaperIcon>
                                        Delete
                                    </PaperButton>
                                </Show>
                                <Show when={!world().active}>
                                    <PaperButton
                                        variant="success"
                                        disabled={online() || mutating() || !(props.game.canSwitch?.(world()) ?? true)}
                                        onClick={() => void switchTo(world())}
                                    >
                                        Switch to this world
                                    </PaperButton>
                                </Show>
                            </>
                        )}
                    </Show>
                }
            >
                <Show when={shown()}>
                    {(world) => (
                        <PaperFlex direction="column" gap="full">
                            <PaperFlex direction="row" gap="full" align="center">
                                <WorldTile active={world().active} />
                                <PaperFlex direction="column" gap="onefourth">
                                    <Show
                                        when={world().active}
                                        fallback={<PaperText size={3} color="text-subtle">Inactive. Switching takes effect after a restart.</PaperText>}
                                    >
                                        <PaperBadge variant="success">Active world</PaperBadge>
                                    </Show>
                                    <PaperText size={3}>{props.game.summary(world())}</PaperText>
                                    {untrack(() => props.game.badges?.(world))}
                                </PaperFlex>
                            </PaperFlex>
                            {untrack(() => props.game.details(world))}
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
                        <PaperButton variant="success" disabled={!nameValid(uploadName()) || uploading()} onClick={() => void submitUpload()}>
                            {uploading() ? "Adding..." : "Add world"}
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText size={3}>
                        {upload()?.note ? `${upload()!.note} ` : ""}The world is added beside the others. Switch to it when the server is stopped.
                    </PaperText>
                    <PaperInput
                        fullWidth
                        label={props.game.upload.label}
                        value={uploadName()}
                        error={nameProblem(uploadName()) || undefined}
                        onInput={(e) => setUploadName(e.currentTarget.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void submitUpload(); }}
                    />
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
                        <PaperButton variant="success" disabled={!canCreate()} onClick={() => void submitCreate()}>
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
                            error={nameProblem(newName()) || undefined}
                            onInput={(e) => setNewName(e.currentTarget.value)}
                        />
                        <Show when={worlds() === null && listing.error() === null}>
                            <PaperText size={2} color="text-subtle">Checking existing worlds...</PaperText>
                        </Show>
                        <Show when={props.game.create.note}>
                            <PaperText size={2} color="text-subtle">{props.game.create.note}</PaperText>
                        </Show>
                    </PaperFlex>
                    <PaperSettingList autoHeight>{untrack(() => props.game.create.fields())}</PaperSettingList>
                </PaperFlex>
            </PaperModal>

            <PaperModal
                open={deleteOpen()}
                onClose={() => setDeleteOpen(false)}
                title={`Delete world "${shown() ? props.game.title(shown()!) : ""}"`}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setDeleteOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" onClick={() => void confirmDelete()}>Delete</PaperButton>
                    </>
                }
            >
                <Show when={shown()}>
                    {(world) => (
                        <PaperText preset="body">
                            {props.game.deleteNote(world())}
                            <Show when={world().active}>
                                {" "}This is the active world. The server will generate a fresh one on the next start.
                            </Show>
                        </PaperText>
                    )}
                </Show>
            </PaperModal>
        </>
    );
}
