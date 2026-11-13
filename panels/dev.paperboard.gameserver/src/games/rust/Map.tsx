import { createEffect, createSignal, on, Show } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperIcon, PaperModal, PaperPageHeader, PaperQuote, PaperSettingItem, PaperSettingList, PaperTable, PaperText, PaperToggle } from "@mileniumhq/paperui";
import { serverBridge, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import type { RustMapView } from "./index";

/**
 * The map a Rust server plays, and its wipe: a fresh map with everything on
 * it gone, as Rust servers do every month or so, with or without what players
 * have learned to craft. The old map moves to a trash folder in the server
 * folder; nothing is deleted.
 */
export default function RustMap(props: { active: boolean }) {
    const [view, setView] = createSignal<RustMapView>();
    const [loadError, setLoadError] = createSignal("");
    const [open, setOpen] = createSignal(false);
    const [blueprints, setBlueprints] = createSignal(false);
    const [wiping, setWiping] = createSignal(false);
    const [error, setError] = createSignal("");
    const [wiped, setWiped] = createSignal(false);

    const load = async () => {
        try {
            setView(await serverBridge.call<RustMapView>("rust-map"));
            setLoadError("");
        } catch (err) {
            setLoadError(errorMessage(err));
        }
    };
    createEffect(on([() => props.active, serverStatus], ([active]) => { if (active) void load(); }));

    const ask = () => { setBlueprints(false); setError(""); setOpen(true); };
    const wipe = async () => {
        setWiping(true);
        setError("");
        try {
            setView(await serverBridge.call<RustMapView>("rust-wipe", { blueprints: blueprints() }));
            setWiped(true);
            setOpen(false);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setWiping(false);
        }
    };

    return (
        <>
            <PaperPageHeader icon="map" title="Map" />

            <Show when={loadError()}>
                <PaperQuote variant="danger" icon="warning" title="The map could not be read">{loadError()}</PaperQuote>
            </Show>
            <Show when={serverStatus() !== "offline"}>
                <PaperQuote variant="warning" icon="warning" title="Server running">Stop the server to wipe it.</PaperQuote>
            </Show>
            <Show when={wiped()}>
                <PaperQuote variant="success" icon="check_circle" title="Wiped" onDismiss={() => setWiped(false)}>
                    The server makes its new map when it next starts. The old one is in a .trash folder in Files.
                </PaperQuote>
            </Show>

            <PaperCard>
                <PaperFlex direction="column" gap="half" padding="full">
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
            </PaperCard>

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
                        <PaperButton variant="danger" disabled={wiping()} onClick={() => void wipe()}>
                            {wiping() ? "Wiping..." : "Wipe"}
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    The server starts over on a new map: everything players built, carried and stored is gone. The old map moves to a .trash folder in the server folder.
                </PaperText>
                <PaperSettingList autoHeight>
                    <PaperSettingItem title="Wipe blueprints too" description="Players also lose what they have learned to craft.">
                        <PaperToggle checked={blueprints()} disabled={wiping()} aria-label="Wipe blueprints too" onChange={setBlueprints} />
                    </PaperSettingItem>
                </PaperSettingList>
                <Show when={error()}>
                    <PaperQuote variant="danger" icon="warning" title="Not wiped">{error()}</PaperQuote>
                </Show>
            </PaperModal>
        </>
    );
}
