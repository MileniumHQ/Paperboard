import { createEffect, createSignal, on, Show } from "solid-js";
import { PaperButton, PaperCard, PaperEmptyState, PaperFlex, PaperIcon, PaperLoader, PaperModal, PaperPageHeader, PaperQuote, PaperSettingItem, PaperSettingList, PaperTable, PaperText, PaperToggle, createAction, createFailureToast, createRead, showError } from "@mileniumhq/paperui";
import { useServer } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import type { RustMapView } from "./index";
import styles from "./Map.module.css";

/**
 * The map a Rust server plays, and its wipe: a fresh map with everything on
 * it gone, as Rust servers do every month or so, with or without what players
 * have learned to craft. The old map moves to a trash folder in the server
 * folder; nothing is deleted.
 */
export default function RustMap(props: { active: boolean }) {
    const { calls, serverStatus } = useServer();
    const [open, setOpen] = createSignal(false);
    const [blueprints, setBlueprints] = createSignal(false);
    const wiping = createAction({ message: errorMessage });
    /** set once a wipe is done: whether there was a map to move to the trash */
    const [wiped, setWiped] = createSignal<{ trashed: boolean }>();

    // the map, and the map from above: undefined until read, null until the server draws it
    const map = createRead(
        async (): Promise<{ view: RustMapView; picture: string | null }> => ({ view: await calls.rustMap(), picture: await calls.rustMapPicture() }),
        { source: () => props.active && serverStatus(), message: errorMessage, failure: { title: "Couldn't load the map" } },
    );
    const view = () => map.value()?.view;
    const picture = () => map.value()?.picture;
    const [drawing, setDrawing] = createSignal(false);
    // a refused draw is not tried again by itself: Try again draws it
    const [pictureError, setPictureError] = createSignal("");
    createFailureToast(pictureError, { title: "Couldn't draw the map" });
    // a running server without a picture of its map draws one, once each read lands
    createEffect(
        on(map.loading, (loading) => {
            if (!loading && !map.error() && picture() === null && serverStatus() === "online" && !drawing() && !pictureError()) void draw();
        }, { defer: true }),
    );

    const draw = async () => {
        setDrawing(true);
        setPictureError("");
        try {
            const drawn = await calls.rustMapDraw();
            map.set((prev) => prev && { ...prev, picture: drawn });
        } catch (err) {
            setPictureError(errorMessage(err));
        } finally {
            setDrawing(false);
        }
    };

    const ask = () => { setBlueprints(false); setOpen(true); };
    // a failure is a toast over the dialog, which stays open
    const wipe = () => wiping.run("Couldn't wipe the server", async () => {
        const trashed = view()?.made === true;
        map.set({ view: await calls.rustWipe({ blueprints: blueprints() }), picture: null });
        setWiped({ trashed });
        setOpen(false);
    }, (failure) => failure && showError(failure.title, failure.message));

    return (
        <>
            <PaperPageHeader icon="map" title="Map" />

            <Show when={serverStatus() !== "offline"}>
                <PaperQuote variant="warning" icon="warning" title="Server running">Stop the server to wipe it.</PaperQuote>
            </Show>
            <Show when={wiped()}>
                <PaperQuote variant="success" icon="check_circle" title="Wiped" onDismiss={() => setWiped(undefined)}>
                    The server makes its new map when it next starts.{wiped()!.trashed ? " The old one is in a .trash folder in Files." : ""}
                </PaperQuote>
            </Show>

            <Show
                when={view() || !map.error() || map.loading()}
                fallback={
                    <PaperEmptyState icon="error" title="Couldn't load">
                        <PaperButton onClick={() => void map.reload()}>Try again</PaperButton>
                    </PaperEmptyState>
                }
            >
            <PaperCard>
                <PaperFlex direction="row" wrap gap="full" padding="full" align="flex-start">
                <PaperFlex grow maxWidth="panel-small" minWidth="field-wide" fullWidth>
                    <Show
                        when={picture()}
                        fallback={
                            <PaperFlex center direction="column" gap="half" fullWidth class={styles.picture}>
                                <Show
                                    when={!pictureError()}
                                    fallback={
                                        <PaperEmptyState icon="error" title="Couldn't draw the map">
                                            <PaperButton disabled={serverStatus() !== "online"} onClick={() => void draw()}>Try again</PaperButton>
                                        </PaperEmptyState>
                                    }
                                >
                                    <Show
                                        when={drawing()}
                                        fallback={<PaperText preset="body" color="text-subtle">{picture() === null ? "Rust draws the map when the server runs." : ""}</PaperText>}
                                    >
                                        <PaperLoader loaderStatus="indeterminate" label="Drawing the map..." />
                                    </Show>
                                </Show>
                            </PaperFlex>
                        }
                    >
                        {(src) => <img class={styles.picture} src={src()} alt={`The map from above, ${view()?.size ?? ""} m, seed ${view()?.seed ?? ""}`} />}
                    </Show>
                </PaperFlex>
                <PaperFlex direction="column" gap="half" flex="1 1 0" minWidth="field-wide">
                    <PaperText size={3} weight={700}>Procedural map</PaperText>
                    <PaperText preset="body" color="text-subtle">
                        Rust makes the map from its size and seed. Change them in Options, or wipe for a new seed.
                    </PaperText>
                    <PaperTable>
                        <tbody>
                            <tr>
                                <th>Size</th>
                                <td>{view() ? `${view()!.size} m` : "Not read"}</td>
                            </tr>
                            <tr>
                                <th>Seed</th>
                                <td>{view()?.seed ?? "Not read"}</td>
                            </tr>
                            <tr>
                                <th>Status</th>
                                <td>{view() ? (view()!.made ? "Made" : "Made when the server next starts") : "Not read"}</td>
                            </tr>
                        </tbody>
                    </PaperTable>
                </PaperFlex>
                </PaperFlex>
            </PaperCard>
            </Show>

            <PaperFlex direction="row" justify="flex-end" gap="full" fullWidth>
                <PaperButton variant="danger" disabled={serverStatus() !== "offline" || !view()} onClick={ask}>
                    <PaperIcon>restart_alt</PaperIcon>
                    Wipe
                </PaperButton>
            </PaperFlex>

            <PaperModal
                open={open()}
                onClose={() => setOpen(false)}
                title="Wipe the server"
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={wiping.busy()} onClick={() => void wipe()}>
                            {wiping.busy() ? "Wiping..." : "Wipe"}
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    The server starts over on a new map: everything players built, carried and stored is gone. The old map moves to a .trash folder in the server folder.
                </PaperText>
                <PaperSettingList autoHeight>
                    <PaperSettingItem title="Wipe blueprints too" description="Players also lose what they have learned to craft.">
                        <PaperToggle checked={blueprints()} disabled={wiping.busy()} aria-label="Wipe blueprints too" onChange={setBlueprints} />
                    </PaperSettingItem>
                </PaperSettingList>
            </PaperModal>
        </>
    );
}
