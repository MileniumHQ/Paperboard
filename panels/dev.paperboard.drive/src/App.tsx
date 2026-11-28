// Drive: a sidebar of the places it shows (its own folder, the disks plugged
// in, the folders linked from this computer) beside the files of the one
// that's open. The places are the service's state, mirrored here and kept
// by id. Only the open place's Browser is shown; each place's view (its
// folder, choice and uploads) is kept here until the place leaves Drive.
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
    formatBytes,
    PaperContextMenu,
    PaperContextMenuHeader,
    PaperContextMenuItem,
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperMenu,
    PaperMenuAction,
    PaperMenuItem,
    PaperMenuLabel,
    PaperPanel,
    showError,
    showToast,
    useContextMenuState,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import Browser, { MissingPlace } from "./Browser";
import LinkFolder from "./LinkFolder";
import { drive } from "./client";
import { OWN_PLACE, type Place } from "./lib/contract";
import { createPlaceView, type PlaceView } from "./placeView";

const PLACE_KEY = "drive:place";

const ICONS: Record<Place["kind"], string> = { own: "home_storage", disk: "hard_drive", folder: "folder" };

function savedPlace(): string {
    try {
        return localStorage.getItem(PLACE_KEY) ?? OWN_PLACE;
    } catch (err) {
        // quiet: a page without storage opens on Drive's own folder, as a new one does
        console.warn("[drive] the open place couldn't be read:", err);
        return OWN_PLACE;
    }
}

/** What the sidebar says under a place's name. */
function placeNote(place: Place, uploading: number): string | undefined {
    if (!place.available) return "Not here right now";
    if (uploading > 0) return uploading === 1 ? "Uploading 1 file" : `Uploading ${uploading} files`;
    if (place.free === undefined) return undefined;
    return `${formatBytes(place.free)} free`;
}

export default function App() {
    // ---------- the places, as the service keeps them ----------
    const [places, setPlaces] = createStore<Place[]>([]);
    const [known, setKnown] = createSignal(false);
    const mirror = drive.state;
    const off = mirror.subscribe((state) => {
        batch(() => {
            setPlaces(reconcile(state.places, { key: "id" }));
            setKnown(true);
        });
    });
    // the service says when a disk left without Eject, once, to every window
    const offUnplugged = drive.events.unplugged((disk) => {
        showToast({ title: `“${disk.name}” was unplugged`, message: "Eject a disk before you pull it out, so nothing is lost.", icon: "usb_off", variant: "warning" });
    });
    onCleanup(() => {
        off();
        offUnplugged();
        mirror.dispose();
    });
    const disks = createMemo(() => places.filter((p) => p.kind === "disk"));
    const folders = createMemo(() => places.filter((p) => p.kind === "folder"));
    const placeById = (id: string) => places.find((p) => p.id === id);

    // ---------- each place's view, kept while another is shown ----------
    const views = new Map<string, PlaceView>();
    const viewOf = (id: string) => {
        let view = views.get(id);
        if (!view) {
            view = createPlaceView(id);
            views.set(id, view);
        }
        return view;
    };
    // a place that left Drive takes its view with it: its uploads stop
    createEffect(
        on(
            () => places.map((p) => p.id),
            (ids) => {
                for (const [id, view] of views) {
                    if (ids.includes(id)) continue;
                    view.dispose();
                    views.delete(id);
                }
            },
        ),
    );
    onCleanup(() => {
        for (const view of views.values()) view.dispose();
    });

    // ---------- the place that's open ----------
    const [open, setOpen] = createSignal(savedPlace());
    createEffect(
        on(open, (id) => {
            try {
                localStorage.setItem(PLACE_KEY, id);
            } catch (err) {
                // quiet: the place still opens; only the next visit forgets it
                console.warn("[drive] the open place couldn't be saved:", err);
            }
        }, { defer: true }),
    );
    // a place that's gone (a disk pulled out, a folder unlinked) leaves Drive's own folder open
    createEffect(
        on([known, () => places.map((p) => p.id)], ([ready, ids]) => {
            if (ready && !ids.includes(open())) setOpen(OWN_PLACE);
        }),
    );

    // ---------- what can be done to a place ----------
    const [linking, setLinking] = createSignal(false);

    async function eject(place: Place) {
        try {
            await drive.calls.eject({ id: place.id });
            showToast({ title: `“${place.name}” can be unplugged`, icon: "eject", variant: "success" });
        } catch (err) {
            showError(`Couldn't eject “${place.name}”`, err);
        }
    }

    async function unlink(place: Place) {
        try {
            await drive.calls.unlink({ id: place.id });
            showToast({ title: `Unlinked “${place.name}”`, message: "Its files are still on this computer.", icon: "link_off" });
        } catch (err) {
            showError(`Couldn't unlink “${place.name}”`, err);
        }
    }

    const linked = (place: Place) => {
        setLinking(false);
        setOpen(place.id);
    };

    // ---------- the sidebar's menu on a place ----------
    const menu = useContextMenuState();
    const [menuOn, setMenuOn] = createSignal<string | null>(null);
    const menuPlace = () => (menuOn() ? placeById(menuOn()!) : undefined);
    const placeMenu = (e: MouseEvent, place: Place) => {
        if (place.kind === "own") return;
        e.preventDefault();
        setMenuOn(place.id);
        menu.openAtMouse(e);
    };

    const entry = (place: Place) => (
        <PaperMenuItem value={place.id} icon={ICONS[place.kind]} description={placeNote(place, viewOf(place.id).uploads.jobs().length)} onContextMenu={(e) => placeMenu(e, place)}>
            {place.name}
        </PaperMenuItem>
    );

    return (
        <PaperPanel>
            <PaperMenu
                name="places"
                aria-label="Places"
                value={open()}
                onValueChange={(value) => setOpen(String(value))}
            >
                <For each={places.filter((p) => p.kind === "own")}>{entry}</For>
                <Show when={disks().length > 0}>
                    <PaperMenuLabel>Drives</PaperMenuLabel>
                    <For each={disks()}>{entry}</For>
                </Show>
                <PaperMenuLabel>Folders</PaperMenuLabel>
                <For each={folders()}>{entry}</For>
                <PaperMenuAction icon="add" onClick={() => setLinking(true)}>
                    Link a folder
                </PaperMenuAction>
            </PaperMenu>

            <PaperInterfaceGroup value={open()}>
                <For each={places}>
                    {(place) => (
                        <PaperInterfaceItem value={place.id} variant="full">
                            {/* a folder that's gone takes its Browser with it: its preview and questions don't wait for it */}
                            <Show when={place.available} fallback={<MissingPlace place={place} onUnlink={() => void unlink(place)} />}>
                                <Browser place={place} view={viewOf(place.id)} onEject={() => void eject(place)} />
                            </Show>
                        </PaperInterfaceItem>
                    )}
                </For>
            </PaperInterfaceGroup>

            <PaperContextMenu open={menu.isOpen()} target={menu.target()} placement={menu.placement()} onClose={menu.close}>
                <Show when={menuPlace()}>
                    {(place) => (
                        <>
                            <PaperContextMenuHeader>{place().name}</PaperContextMenuHeader>
                            <Show when={place().kind === "disk"}>
                                <PaperContextMenuItem icon="eject" onClick={() => void eject(place())}>
                                    Eject
                                </PaperContextMenuItem>
                            </Show>
                            <Show when={place().kind === "folder"}>
                                <PaperContextMenuItem icon="link_off" onClick={() => void unlink(place())}>
                                    Unlink
                                </PaperContextMenuItem>
                            </Show>
                        </>
                    )}
                </Show>
            </PaperContextMenu>

            <LinkFolder open={linking()} onClose={() => setLinking(false)} onLinked={linked} />
        </PaperPanel>
    );
}
