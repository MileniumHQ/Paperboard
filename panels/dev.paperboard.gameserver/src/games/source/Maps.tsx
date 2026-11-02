import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperEmptyState,
    PaperFlex,
    PaperList,
    PaperListItem,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperText,
} from "@mileniumhq/paperui";
import { serverBridge, serverLevel, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { mapMode, sourceActions, type SourceGameSpec, type SourceMapCycle } from "./index";

// The maps a server plays through, in order. The server reads a map cycle
// file; until the rotation is edited here that is the game's own or one the
// user wrote, which this page shows and never changes. Editing makes the
// rotation Paperboard's, written to a file of its own that the server is
// pointed at (games/source/mapcycle.ts).
export default function SourceMaps(props: { spec: SourceGameSpec; active: boolean }) {
    const ids = sourceActions(props.spec.id);
    const [view, setView] = createSignal<SourceMapCycle | null>(null);
    const [loadError, setLoadError] = createSignal("");
    const [working, setWorking] = createSignal(false);
    const [error, setError] = createSignal<{ title: string; message: string } | null>(null);
    const [notice, setNotice] = createSignal("");
    const [resetting, setResetting] = createSignal(false);

    const load = async () => {
        setLoadError("");
        try {
            setView(await serverBridge.call<SourceMapCycle>(ids.mapCycle));
        } catch (err) {
            setLoadError(errorMessage(err));
        }
    };
    createEffect(on([() => props.active, serverStatus], ([active]) => { if (active) void load(); }));

    /** Sets the rotation, or hands it back to the game's file with null. */
    const save = async (maps: string[] | null, title: string) => {
        setWorking(true);
        setError(null);
        setNotice("");
        try {
            setView(await serverBridge.call<SourceMapCycle>(ids.mapCycleSet, { maps }));
            return true;
        } catch (err) {
            setError({ title, message: errorMessage(err) });
            // whatever did land is what the page shows
            await load();
            return false;
        } finally {
            setWorking(false);
        }
    };

    const label = (name: string) => mapMode(props.spec, name);
    const installed = createMemo(() => new Set(view()?.installed ?? []));
    const addable = createMemo(() => (view()?.installed ?? []).filter((name) => !view()!.maps.includes(name)));
    const editable = () => !!view() && !view()!.overriddenBy;

    const add = (name: string) => {
        if (name) void save([...view()!.maps, name], `${name} was not added`);
    };
    const remove = (name: string) => {
        const maps = view()!.maps.filter((m) => m !== name);
        if (maps.length === 0) setError({ title: `${name} was not removed`, message: "A rotation needs at least one map. Use the game's map cycle instead to stop choosing." });
        else void save(maps, `${name} was not removed`);
    };
    const move = (name: string, by: number) => {
        const maps = [...view()!.maps];
        const from = maps.indexOf(name);
        maps.splice(from + by, 0, ...maps.splice(from, 1));
        void save(maps, `${name} was not moved`);
    };

    /** Makes the file's rotation Paperboard's, leaving out what the server couldn't play anyway. */
    const takeOver = async () => {
        const current = view()!;
        const missing = [...new Set(current.maps.filter((name) => !installed().has(name)))];
        const maps = [...new Set(current.maps.filter((name) => installed().has(name)))];
        const repeated = current.maps.length - missing.length - maps.length;
        const left = [
            missing.length > 0 ? `${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} installed, so ${missing.length === 1 ? "it was" : "they were"} left out.` : "",
            repeated > 0 ? `${repeated === 1 ? "A map was" : `${repeated} maps were`} listed more than once and play once.` : "",
        ].filter(Boolean).join(" ");
        if (await save(maps, "Rotation not changed") && left) setNotice(left);
    };
    const reset = async () => {
        if (await save(null, "Rotation not reset")) setResetting(false);
    };

    const status = () => {
        const current = view();
        if (!current) return "";
        if (current.custom) return serverStatus() === "online" ? "The server plays these maps in order, then starts over. Changes apply at once." : "The server plays these maps in order, then starts over, once it starts.";
        if (current.overriddenBy && current.file) return `The server reads ${current.file}.`;
        if (current.file) return `The server reads ${current.file}. Edit the rotation to make a copy that Paperboard keeps; that file stays as it is.`;
        return "The server has no map cycle file, so it plays the map it started on.";
    };

    return (
        <>
            <PaperPageHeader icon="map" title="Maps">
                <Show when={view()?.custom}>
                    <PaperButton variant="text" disabled={working() || !editable()} onClick={() => setResetting(true)}>Use the game's map cycle</PaperButton>
                </Show>
                <Show when={view() && !view()!.custom}>
                    <PaperButton variant="primary" disabled={working() || !editable() || view()!.maps.length === 0} onClick={() => void takeOver()}>Edit rotation</PaperButton>
                </Show>
            </PaperPageHeader>

            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="Could not read the map rotation">
                    <PaperFlex direction="column" gap="half">
                        <span>{loadError()}</span>
                        <PaperButton onClick={() => void load()}>Try again</PaperButton>
                    </PaperFlex>
                </PaperQuote>
            </Show>
            <Show when={view()}>
                {(current) => (
                    <PaperFlex direction="column" gap="full">
                        <PaperText color="text-subtle">{status()}</PaperText>

                        <Show when={current().overriddenBy}>
                            {(file) => (
                                <PaperQuote variant="warning" icon="info" title="server.cfg picks the map cycle">
                                    The server.cfg in the server folder sets mapcyclefile to {file()}, which the server follows over this page. Remove that line to set the rotation here.
                                </PaperQuote>
                            )}
                        </Show>
                        <Show when={error()}>
                            {(failure) => (
                                <PaperQuote variant="danger" icon="warning" title={failure().title} onDismiss={() => setError(null)}>
                                    {failure().message}
                                </PaperQuote>
                            )}
                        </Show>
                        <Show when={notice()}>
                            <PaperQuote variant="warning" icon="info" title="Rotation made from the file" onDismiss={() => setNotice("")}>
                                {notice()}
                            </PaperQuote>
                        </Show>

                        <Show when={current().custom && editable()}>
                            <PaperSelectMenu
                                name="source-map-cycle-add"
                                fullWidth
                                searchable
                                searchPlaceholder="Search maps"
                                placeholder="Add a map"
                                disabled={working() || addable().length === 0}
                                value=""
                                onValueChange={(value) => add(String(value))}
                            >
                                <For each={addable()}>
                                    {(name) => <PaperSelectMenuItem value={name} description={label(name)} keywords={label(name)}>{name}</PaperSelectMenuItem>}
                                </For>
                            </PaperSelectMenu>
                        </Show>

                        <Show
                            when={current().maps.length > 0}
                            fallback={
                                <PaperEmptyState icon="map" title="No maps in the rotation">
                                    {current().file ? `${current().file} lists no maps.` : "Edit the rotation after the game is installed."}
                                </PaperEmptyState>
                            }
                        >
                            <PaperCard padding="none">
                                <PaperList
                                    name="source-map-cycle"
                                    value=""
                                    background="surface-raised"
                                    borderless
                                    fullWidth
                                    reorderable={current().custom && editable() && !working()}
                                    onReorder={(order) => void save(order.map(String), "Rotation not reordered")}
                                >
                                    <For each={current().maps}>
                                        {(name, index) => (
                                            <PaperListItem
                                                value={name}
                                                icon="map"
                                                onClose={current().custom && editable() ? () => remove(name) : undefined}
                                                description={[installed().has(name) ? label(name) : "Not installed", serverLevel() === name ? "Playing now" : undefined].filter(Boolean).join(" · ")}
                                                actions={
                                                    <Show when={current().custom && editable()}>
                                                        <PaperFlex direction="row" gap="onefourth" align="center">
                                                            <PaperButton size="tiny" icon aria-label={`Move ${name} up`} disabled={working() || index() === 0} onPointerDown={(e) => e.stopPropagation()} onClick={() => move(name, -1)}>arrow_upward</PaperButton>
                                                            <PaperButton size="tiny" icon aria-label={`Move ${name} down`} disabled={working() || index() === current().maps.length - 1} onPointerDown={(e) => e.stopPropagation()} onClick={() => move(name, 1)}>arrow_downward</PaperButton>
                                                        </PaperFlex>
                                                    </Show>
                                                }
                                            >
                                                {name}
                                            </PaperListItem>
                                        )}
                                    </For>
                                </PaperList>
                            </PaperCard>
                        </Show>
                    </PaperFlex>
                )}
            </Show>

            <PaperModal
                open={resetting()}
                onClose={() => setResetting(false)}
                title="Go back to the game's map cycle"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setResetting(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={working()} onClick={() => void reset()}>Use the game's map cycle</PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    This deletes the rotation made here. The server goes back to reading its own map cycle file.
                </PaperText>
                <Show when={error()}>
                    <PaperText size={2} color="danger">{error()!.message}</PaperText>
                </Show>
            </PaperModal>
        </>
    );
}
