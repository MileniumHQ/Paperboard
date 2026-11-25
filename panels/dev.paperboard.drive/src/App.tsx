// Drive: a sidebar of the places it shows (its own folder, the disks plugged
// in, the folders linked from this computer) beside the files of the one
// that's open. The places are the service's state, mirrored here and kept
// by id, so a place's browser keeps its folder while another is shown.
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
    formatBytes,
    PaperContextMenu,
    PaperContextMenuHeader,
    PaperContextMenuItem,
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperMenu,
    PaperMenuItem,
    PaperMenuLabel,
    PaperPanel,
    showError,
    showToast,
    useContextMenuState,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import Browser from "./Browser";
import LinkFolder from "./LinkFolder";
import { drive } from "./client";
import { OWN_PLACE, type Place } from "./lib/contract";

const PLACE_KEY = "drive:place";
// the sidebar's entry that links a folder: it opens the picker, and is never the open place
const LINK_ENTRY = "link";

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
function placeNote(place: Place): string | undefined {
    if (!place.available) return "Not here right now";
    if (place.free === undefined) return undefined;
    return `${formatBytes(place.free)} free`;
}

export default function App() {
    // ---------- the places, as the service keeps them ----------
    const [places, setPlaces] = createStore<Place[]>([]);
    const [known, setKnown] = createSignal(false);
    const mirror = drive.state;
    // a disk that leaves without Eject was pulled out: that's said once
    const ejecting = new Set<string>();
    const off = mirror.subscribe((state) => {
        const gone = known() ? places.filter((p) => p.kind === "disk" && !state.places.some((n) => n.id === p.id)) : [];
        setPlaces(reconcile(state.places, { key: "id" }));
        setKnown(true);
        for (const disk of gone) {
            if (ejecting.delete(disk.id)) continue;
            showToast({ title: `“${disk.name}” was unplugged`, message: "Eject a disk before you pull it out, so nothing is lost.", icon: "usb_off", variant: "warning" });
        }
    });
    onCleanup(() => {
        off();
        mirror.dispose();
    });
    const disks = createMemo(() => places.filter((p) => p.kind === "disk"));
    const folders = createMemo(() => places.filter((p) => p.kind === "folder"));
    const placeById = (id: string) => places.find((p) => p.id === id);

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
        ejecting.add(place.id);
        try {
            await drive.calls.eject({ id: place.id });
            showToast({ title: `“${place.name}” can be unplugged`, icon: "eject", variant: "success" });
        } catch (err) {
            ejecting.delete(place.id);
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
        <PaperMenuItem value={place.id} icon={ICONS[place.kind]} description={placeNote(place)} onContextMenu={(e) => placeMenu(e, place)}>
            {place.name}
        </PaperMenuItem>
    );

    return (
        <PaperPanel>
            <PaperMenu
                name="places"
                aria-label="Places"
                value={open()}
                onValueChange={(value) => {
                    if (value === LINK_ENTRY) setLinking(true);
                    else setOpen(String(value));
                }}
            >
                <For each={places.filter((p) => p.kind === "own")}>{entry}</For>
                <Show when={disks().length > 0}>
                    <PaperMenuLabel>Drives</PaperMenuLabel>
                    <For each={disks()}>{entry}</For>
                </Show>
                <PaperMenuLabel>Folders</PaperMenuLabel>
                <For each={folders()}>{entry}</For>
                <PaperMenuItem value={LINK_ENTRY} icon="add">
                    Link a folder
                </PaperMenuItem>
            </PaperMenu>

            <PaperInterfaceGroup value={open()}>
                <For each={places}>
                    {(place) => (
                        <PaperInterfaceItem value={place.id} variant="full">
                            <Browser place={place} onEject={() => void eject(place)} onUnlink={() => void unlink(place)} />
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
