import { createSignal, Show } from "solid-js";
import { PaperAvatar, PaperButton, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview, { EditableDetail } from "../../components/ServerOverview";
import { gameSettings, serverBridge, serverLevel, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import type { GameDefinition } from "../types";
import { ACTION_IDS as A } from "../../service/contract";
import { mapMode, sourceActions, type SourceGameSpec } from "./index";
import MapCards, { mapChoices } from "./MapCards";
import { createMapPictures } from "./useMapPictures";
import { createWorkshopMaps } from "./useWorkshopMaps";
import { canonicalMap } from "./workshop";

export default function SourceOverview(props: { spec: SourceGameSpec; game: GameDefinition }) {
    const ids = sourceActions(props.spec.id);
    const features = props.game.describe({ software: "", version: "" });
    // a running server's own map, which its map cycle changes; the one it starts on otherwise
    const map = () => canonicalMap(serverLevel() ?? String(gameSettings().map ?? ""));
    const [open, setOpen] = createSignal(false);
    const [maps, setMaps] = createSignal<string[]>([]);
    const [choice, setChoice] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const pictures = createMapPictures(props.spec);
    const workshop = createWorkshopMaps(props.spec);

    const edit = async () => {
        setChoice(map());
        setError("");
        setOpen(true);
        try {
            setMaps(await serverBridge.call<string[]>(ids.maps));
            if (props.spec.workshop) await workshop.reload();
            if (workshop.error()) setError(workshop.error());
        } catch (err) { setError(errorMessage(err)); }
    };
    const change = async () => {
        setBusy(true);
        setError("");
        try {
            await serverBridge.call(ids.changeMap, { map: choice() });
            setOpen(false);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };
    const label = (name: string) => mapMode(props.spec, name);

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={props.game.art.icon} alt={props.spec.name} fallbackIcon={props.spec.icon} />}
            detail={
                <EditableDetail edit="Change map" onEdit={() => void edit()}>
                    <PaperText color="text-subtle">
                        {[workshop.titleOf(map()) ?? map(), workshop.titleOf(map()) ? "Steam Workshop" : label(map())].filter(Boolean).join(" · ")}
                    </PaperText>
                </EditableDetail>
            }
            software="Steam"
            control={features.control}
            world={features.actions.includes(A.saveWorld)}
        >
            <PaperModal
                open={open()}
                onClose={() => setOpen(false)}
                title="Change map"
                size="large"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setOpen(false)}>Cancel</PaperButton>
                        <PaperButton variant="primary" disabled={busy() || !choice() || choice() === map()} onClick={() => void change()}>
                            {busy() ? "Changing..." : "Change map"}
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">
                    {serverStatus() === "online"
                        ? "Everyone moves to the new map now, and the server starts on it next time."
                        : "The server starts on this map."}
                </PaperText>
                <Show when={maps().length > 0} fallback={<Show when={!error()}><PaperText color="text-subtle">Loading maps...</PaperText></Show>}>
                    <MapCards maps={[...mapChoices(props.spec, maps()), ...workshop.choices()]} value={choice()} pictures={pictures} disabled={busy()} onPick={setChoice} />
                </Show>
                <Show when={error()}>
                    <PaperQuote variant="danger" icon="warning" title="Map not changed">{error()}</PaperQuote>
                </Show>
            </PaperModal>
        </ServerOverview>
    );
}
