import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import {
    PaperAvatar,
    PaperButton,
    PaperCard,
    PaperChip,
    PaperEmptyState,
    PaperFlex,
    PaperList,
    PaperListItem,
    PaperModal,
    PaperPageHeader,
    PaperQuote,
    PaperText,
} from "@mileniumhq/paperui";
import { serverBridge, serverLevel, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { mapMode, sourceActions, type SourceGameSpec, type SourceMapCycle } from "./index";
import MapCards, { MapPicturesCredit, MapPicturesFailure, mapChoices, mapNames, type MapChoice } from "./MapCards";
import { createMapPictures } from "./useMapPictures";
import { workshopChoice } from "./useWorkshopMaps";
import WorkshopPane from "./WorkshopPane";
import { canonicalMap, workshopId, workshopName, type SourceWorkshopHit, type SourceWorkshopMap } from "./workshop";

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
    const [adding, setAdding] = createSignal(false);
    const [source, setSource] = createSignal<"server" | "workshop">("server");
    const [joined, setJoined] = createSignal("");
    const [removingWorkshop, setRemovingWorkshop] = createSignal<SourceWorkshopMap | null>(null);
    const pictures = createMapPictures(props.spec);

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
    /** the Steam Workshop map a name is, if this server has it */
    const workshopMap = (name: string) => view()?.workshop.find((m) => workshopName(m.id) === canonicalMap(name));
    /** a map as the screens name it */
    const choiceOf = (name: string): MapChoice => { const map = workshopMap(name); return map ? workshopChoice(map) : mapChoices(props.spec, [name])[0]!; };
    const choices = () => addable().map(choiceOf);
    /** what a person calls a map: its Workshop title or real name, else its file name */
    const titleOf = (name: string) => mapNames(choiceOf(name), pictures).title;
    const addable = createMemo(() => (view()?.installed ?? []).filter((name) => !view()!.maps.includes(name)));
    const editable = () => !!view() && !view()!.overriddenBy;

    const add = (name: string) => {
        if (name) void save([...view()!.maps, name], `${titleOf(name)} was not added`);
    };
    const remove = (name: string) => {
        const maps = view()!.maps.filter((m) => m !== name);
        if (maps.length === 0) setError({ title: `${titleOf(name)} was not removed`, message: "A rotation needs at least one map. Use the game's map cycle instead to stop choosing." });
        else void save(maps, `${titleOf(name)} was not removed`);
    };
    /** A Workshop map chosen in the search: added to the server, then to the rotation. */
    const addFromWorkshop = async (hit: SourceWorkshopHit) => {
        setWorking(true);
        setError(null);
        try {
            await serverBridge.call(ids.workshopAdd, { id: hit.id }, { timeoutMs: 30_000 });
        } catch (err) {
            setError({ title: `${hit.title} was not added`, message: errorMessage(err) });
            setWorking(false);
            return;
        }
        setWorking(false);
        const name = workshopName(hit.id);
        if (view()!.maps.includes(name)) setError({ title: `${hit.title} was not added`, message: "It is in the rotation already." });
        else if (await save([...view()!.maps, name], `${hit.title} was not added to the rotation`)) setJoined(`${hit.title} joined the end of the rotation.`);
    };
    const move = (name: string, by: number) => {
        const maps = [...view()!.maps];
        const from = maps.indexOf(name);
        maps.splice(from + by, 0, ...maps.splice(from, 1));
        void save(maps, `${titleOf(name)} was not moved`);
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
    /** Takes a Steam Workshop map off the server; the server says when it can't. */
    const removeWorkshop = async (map: SourceWorkshopMap) => {
        setWorking(true);
        setError(null);
        try {
            await serverBridge.call(ids.workshopRemove, { id: map.id });
            setRemovingWorkshop(null);
            await load();
        } catch (err) {
            setError({ title: `${map.title} was not removed`, message: errorMessage(err) });
        } finally {
            setWorking(false);
        }
    };
    const reset = async () => {
        if (await save(null, "Rotation not reset")) setResetting(false);
    };

    return (
        <>
            <PaperPageHeader icon="map" title="Maps">
                <Show when={view()?.custom}>
                    <PaperButton variant="outline" disabled={working() || !editable()} onClick={() => setResetting(true)}>Use the game's map cycle</PaperButton>
                    <PaperButton variant="primary" disabled={working() || !editable() || (addable().length === 0 && !props.spec.workshop)} onClick={() => { setJoined(""); setAdding(true); }}>Add maps</PaperButton>
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
                        <Show when={current().overriddenBy}>
                            {(file) => (
                                <PaperQuote variant="warning" icon="info" title="server.cfg picks the map cycle">
                                    The server.cfg in the server folder sets mapcyclefile to {file()}, which the server follows over this page. Remove that line to set the rotation here.
                                </PaperQuote>
                            )}
                        </Show>
                        <MapPicturesFailure pictures={pictures} />
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
                                        {(name, index) => {
                                            const names = () => mapNames(choiceOf(name), pictures);
                                            return (
                                                <PaperListItem
                                                    value={name}
                                                    icon={<PaperAvatar size="large" shape="square" src={workshopMap(name)?.previewImageUrl ?? pictures.of(name)} alt={names().title} fallbackIcon="map" />}
                                                    description={[names().file, !installed().has(name) ? "Not installed" : workshopId(name) ? "Steam Workshop" : label(name), serverLevel() !== null && canonicalMap(serverLevel()!) === name ? "Playing now" : undefined].filter(Boolean).join(" · ")}
                                                    actions={
                                                        <Show when={current().custom && editable()}>
                                                            <PaperFlex direction="row" gap="onefourth" align="center">
                                                                <PaperButton size="tiny" icon aria-label={`Move ${names().title} up`} disabled={working() || index() === 0} onPointerDown={(e) => e.stopPropagation()} onClick={() => move(name, -1)}>arrow_upward</PaperButton>
                                                                <PaperButton size="tiny" icon aria-label={`Move ${names().title} down`} disabled={working() || index() === current().maps.length - 1} onPointerDown={(e) => e.stopPropagation()} onClick={() => move(name, 1)}>arrow_downward</PaperButton>
                                                                <PaperButton size="tiny" icon aria-label={`Remove ${names().title}`} disabled={working()} onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(name)}>close</PaperButton>
                                                            </PaperFlex>
                                                        </Show>
                                                    }
                                                >
                                                    {names().title}
                                                </PaperListItem>
                                            );
                                        }}
                                    </For>
                                </PaperList>
                            </PaperCard>
                        </Show>
                        <Show when={current().workshop.length > 0}>
                            <PaperFlex direction="column" gap="half">
                                <PaperText size={2} weight={700} color="text-subtle">Steam Workshop maps</PaperText>
                                <PaperCard padding="none">
                                    <PaperList name="source-workshop-maps" value="" background="surface-raised" borderless fullWidth>
                                        <For each={current().workshop}>
                                            {(map) => (
                                                <PaperListItem
                                                    value={map.id}
                                                    icon={<PaperAvatar size="large" shape="square" src={map.previewImageUrl ?? undefined} alt={map.title} fallbackIcon="map" />}
                                                    description={current().workshopHeld[map.id] ?? "On this server"}
                                                    actions={<PaperButton variant="text" disabled={working() || !!current().workshopHeld[map.id]} onPointerDown={(e) => e.stopPropagation()} onClick={() => { setError(null); setRemovingWorkshop(map); }}>Remove</PaperButton>}
                                                >
                                                    {map.title}
                                                </PaperListItem>
                                            )}
                                        </For>
                                    </PaperList>
                                </PaperCard>
                            </PaperFlex>
                        </Show>
                        <MapPicturesCredit pictures={pictures} />
                    </PaperFlex>
                )}
            </Show>

            <PaperModal
                open={removingWorkshop() !== null}
                onClose={() => setRemovingWorkshop(null)}
                title={`Remove ${removingWorkshop()?.title ?? "map"}`}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setRemovingWorkshop(null)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={working()} onClick={() => { const map = removingWorkshop(); if (map) void removeWorkshop(map); }}>Remove</PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    {removingWorkshop()?.title} is taken off this server, and you can add it again from the Steam Workshop any time.
                </PaperText>
                <Show when={error()}>
                    <PaperText size={2} color="danger">{error()!.message}</PaperText>
                </Show>
            </PaperModal>

            <PaperModal
                open={adding()}
                onClose={() => setAdding(false)}
                title="Add maps"
                size="large"
                footer={<PaperButton variant="primary" onClick={() => setAdding(false)}>Done</PaperButton>}
            >
                <PaperText preset="body">Each map you choose joins the end of the rotation.</PaperText>
                <Show when={props.spec.workshop}>
                    <PaperFlex direction="row" gap="half">
                        <PaperChip selected={source() === "server"} onClick={() => setSource("server")}>On this server</PaperChip>
                        <PaperChip selected={source() === "workshop"} onClick={() => setSource("workshop")}>Steam Workshop</PaperChip>
                    </PaperFlex>
                </Show>
                <Show when={error()}>
                    {(failure) => <PaperQuote variant="danger" icon="warning" title={failure().title} onDismiss={() => setError(null)}>{failure().message}</PaperQuote>}
                </Show>
                <Show when={joined()}>
                    <PaperQuote variant="success" icon="check_circle" onDismiss={() => setJoined("")}>{joined()}</PaperQuote>
                </Show>
                <Show when={source() === "workshop" && props.spec.workshop} fallback={
                    <Show when={addable().length > 0} fallback={<PaperText color="text-subtle">Every map the server has is in the rotation.</PaperText>}>
                        <MapCards maps={choices()} pictures={pictures} disabled={working()} onPick={add} />
                    </Show>
                }>
                    <WorkshopPane spec={props.spec} inRotation={view()?.maps ?? []} disabled={working()} onPick={(hit) => void addFromWorkshop(hit)} />
                </Show>
            </PaperModal>

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
