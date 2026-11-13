import { createSignal, Show } from "solid-js";
import { PaperAvatar, PaperButton, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import ServerOverview, { EditableDetail } from "../../components/ServerOverview";
import { gameSettings, serverBridge, serverLevel, serverStatus } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import type { GameDefinition } from "../types";
import { CALLS as A } from "../../service/contract";
import { createMetrics, createUptime, overviewStats } from "../../components/overviewStats";
import { humanizeIdentifier } from "../../core/format";
import { mapMode, sourceCalls, type SourceGameSpec, type SourceMetrics } from "./index";
import MapCards, { mapChoices, mapNames } from "./MapCards";
import { createMapPictures } from "./useMapPictures";
import { createWorkshopMaps } from "./useWorkshopMaps";
import { canonicalMap } from "./workshop";

export default function SourceOverview(props: { spec: SourceGameSpec; game: GameDefinition }) {
    const ids = sourceCalls(props.spec.id);
    const features = props.game.describe({ software: "", version: "" });
    // a running server's own map, which its map cycle changes; the one it starts on otherwise
    const map = () => canonicalMap(serverLevel() ?? String(gameSettings().map ?? ""));
    const [open, setOpen] = createSignal(false);
    const [maps, setMaps] = createSignal<string[]>([]);
    const [choice, setChoice] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const pictures = createMapPictures(props.spec);
    const uptime = createUptime();
    const metrics = createMetrics<SourceMetrics>(ids.metrics);
    /** how the server plays: the game mode it was started in, or its map's; a map of no listed mode is a custom one */
    const mode = () => {
        const chosen = gameSettings().gamemode;
        if (typeof chosen !== "string") return label(map()) ?? "Custom";
        const option = props.spec.options.find((o) => o.id === "gamemode");
        return (option?.kind === "select" ? option.choices.find((c) => c.value === chosen)?.label : undefined) ?? humanizeIdentifier(chosen);
    };
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
    /** the map as people name it: its Workshop title or real name, the file name beside it, and what it plays as */
    const detail = () => {
        const workshopTitle = workshop.titleOf(map());
        const names = mapNames({ name: map(), title: workshopTitle, mode: label(map()) }, pictures);
        return [names.title, names.file, workshopTitle ? "Steam Workshop" : label(map())].filter(Boolean).join(" · ");
    };

    return (
        <ServerOverview
            avatar={<PaperAvatar size="xlarge" shape="square" src={props.game.art.icon} alt={props.spec.name} fallbackIcon={props.spec.icon} />}
            detail={
                <EditableDetail edit="Change map" onEdit={() => void edit()}>
                    <PaperText color="text-subtle">{detail()}</PaperText>
                </EditableDetail>
            }
            software="Steam"
            control={features.control}
            world={features.calls.includes(A.saveWorld)}
            stats={metrics.value() && overviewStats(
                uptime(),
                { icon: "smart_toy", label: "Bots", value: String(metrics.value()!.bots) },
                { icon: "sports_esports", label: "Game mode", value: mode() },
            )}
        >
            <Show when={metrics.error()}>
                <PaperQuote variant="danger" icon="warning" title="Server figures unavailable">{metrics.error()}</PaperQuote>
            </Show>

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
