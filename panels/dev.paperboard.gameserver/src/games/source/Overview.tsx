import { createMemo, createSignal, Show } from "solid-js";
import { createAction, createFailureToast, createRead, PaperAvatar, PaperButton, PaperEmptyState, PaperModal, PaperText } from "@mileniumhq/paperui";
import ServerOverview, { EditableDetail } from "../../components/ServerOverview";
import { useServer } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import type { GameDefinition } from "../types";
import { createMetrics, createUptime, overviewStats } from "../../components/overviewStats";
import { humanizeIdentifier } from "../../core/format";
import { mapMode, type SourceGameSpec } from "./index";
import MapCards, { mapChoices, mapNames } from "./MapCards";
import { createMapPictures } from "./useMapPictures";
import { createWorkshopMaps } from "./useWorkshopMaps";
import { canonicalMap } from "./workshop";

export default function SourceOverview(props: { spec: SourceGameSpec; game: GameDefinition }) {
    const { calls, gameSettings, serverLevel, serverStatus } = useServer();
    const features = props.game.describe({ software: "", version: "" });
    // a running server's own map, which its map cycle changes; the one it starts on otherwise
    const map = () => canonicalMap(serverLevel() ?? String(gameSettings().map ?? ""));
    const [open, setOpen] = createSignal(false);
    // the installed maps, read each time the dialog opens
    const listed = createRead((): Promise<string[]> => calls.sourceMaps(), { source: open, message: errorMessage });
    const maps = () => listed.value() ?? [];
    const [choice, setChoice] = createSignal("");
    const changing = createAction({ message: errorMessage });
    const busy = changing.busy;
    const pictures = createMapPictures(props.spec);
    const uptime = createUptime();
    const metrics = createMetrics(calls.sourceMetrics);
    createFailureToast(metrics.error, { title: "Couldn't read the server's figures" });
    /** how the server plays: the game mode it was started in, or its map's; a map of no listed mode is a custom one */
    const mode = () => {
        const chosen = gameSettings().gamemode;
        if (typeof chosen !== "string") return label(map()) ?? "Custom";
        const option = props.spec.options.find((o) => o.id === "gamemode");
        return (option?.kind === "select" ? option.choices.find((c) => c.value === chosen)?.label : undefined) ?? humanizeIdentifier(chosen);
    };
    const workshop = createWorkshopMaps(props.spec);
    const choices = createMemo(() => [...mapChoices(props.spec, maps()), ...workshop.choices()]);
    // the dialog's reads, said while it is open
    const listFailure = () => (open() && !listed.loading() ? listed.error() : null);
    createFailureToast(listFailure, { title: "Couldn't load the maps" });
    createFailureToast(() => open() && workshop.error(), { title: "Couldn't load the Workshop maps" });

    const edit = () => {
        setChoice(map());
        setOpen(true);
        if (props.spec.workshop) void workshop.reload();
    };
    const change = () =>
        // a failure is a toast over the dialog, which stays open
        changing.run("Couldn't change the map", async () => {
            await calls.sourceChangeMap({ map: choice() });
            setOpen(false);
        });
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
            world={features.calls.includes("saveWorld")}
            stats={metrics.value() && overviewStats(
                uptime(),
                { icon: "smart_toy", label: "Bots", value: String(metrics.value()!.bots) },
                { icon: "sports_esports", label: "Game mode", value: mode() },
            )}
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
                <Show
                    when={maps().length > 0}
                    fallback={
                        <Show when={listFailure()} fallback={<PaperText color="text-subtle">Loading maps...</PaperText>}>
                            <PaperEmptyState icon="error" title="Couldn't load">
                                <PaperButton onClick={() => void listed.reload()}>Try again</PaperButton>
                            </PaperEmptyState>
                        </Show>
                    }
                >
                    <MapCards maps={choices()} value={choice()} pictures={pictures} disabled={busy()} onPick={setChoice} />
                </Show>
            </PaperModal>
        </ServerOverview>
    );
}
