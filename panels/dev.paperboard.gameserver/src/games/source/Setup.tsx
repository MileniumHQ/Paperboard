import { createMemo, createSignal, For, Show } from "solid-js";
import { createAction, createRead, PaperButton, PaperCenteredInterface, PaperFlex, PaperIcon, PaperMediaCard, PaperMediaCardGroup, PaperQuote, PaperText, PaperWizardStep } from "@mileniumhq/paperui";
import { errorMessage } from "../../lib/failure";
import SteamSetup from "../steam/SteamSetup";
import { type SourceGameSpec } from "./index";
import MapCards, { MapPicturesCredit, MapPicturesFailure, mapChoices } from "./MapCards";
import { playModes } from "./modes";
import { createMapPictures } from "./useMapPictures";
import { useServer } from "../../lib/server";

/** A banner of one big symbol, for a card whose pictures are not there. */
const iconBanner = (icon: string) => (
    <PaperFlex center fullWidth fullHeight>
        <PaperText size={14}><PaperIcon>{icon}</PaperIcon></PaperText>
    </PaperFlex>
);

/** What was asked: a mode's prefix, or null for the game's own map cycle. */
type Choice = { mode: string | null; map: string };

/**
 * Setup for a Source game: the download, then how the server plays, as
 * Minecraft's setup is laid out: one question a step, Next and Back between
 * them. The map pictures are fetched by the service as the cards show their
 * maps, once the download has said which maps there are.
 */
export default function SourceSetup(props: { spec: SourceGameSpec; onComplete(): void }) {
    const { calls } = useServer();
    const pictures = createMapPictures(props.spec);
    // the maps are only there once the download is, so they are read when its step is left
    const [downloaded, setDownloaded] = createSignal(false);
    // a failure is shown where the modes would be
    const listed = createRead((): Promise<string[]> => calls.sourceMaps(), { source: downloaded, message: errorMessage });
    const installed = listed.value;
    // the mode picked ("" before one is), and null for the game's own map cycle
    const [mode, setMode] = createSignal<string | null | "">("");
    const [map, setMap] = createSignal("");
    const saving = createAction({ message: errorMessage });

    const modes = createMemo(() => playModes(props.spec, installed() ?? []));
    const chosenMode = createMemo(() => modes().find((m) => m.prefix === mode()));
    /** the maps to start on: the mode's, or every one the server has */
    const startable = createMemo(() => (mode() === null ? (installed() ?? []) : (chosenMode()?.maps ?? [])));
    const startableChoices = createMemo(() => mapChoices(props.spec, startable()));
    const gameDefault = createMemo(() => {
        const option = props.spec.options.find((o) => o.id === "map");
        const wanted = option && "default" in option ? option.default : undefined;
        return typeof wanted === "string" && startable().includes(wanted) ? wanted : startable()[0];
    });
    /** a mode's card is drawn from one of its maps: the first that has a picture */
    const showcase = (maps: readonly string[]) => maps.find((name) => pictures.of(name)) ?? maps[0];
    /** Mixed is drawn from four modes, spread across the list so they differ, each by its showcase map */
    const mixedMaps = createMemo(() => {
        const drawn = modes().map((m) => showcase(m.maps)!).filter((name) => pictures.of(name));
        return [0, 1, 2, 3].map((i) => drawn[Math.floor((i * drawn.length) / 4)]).filter((name, i, all): name is string => !!name && all.indexOf(name) === i);
    });

    const pick = (next: string | null) => {
        if (next === mode()) return;
        setMode(next);
        setMap(gameDefault() ?? "");
    };

    const save = () => saving.run("Setup is not finished", () => {
        const choice: Choice = { mode: mode() as string | null, map: map() };
        return calls.sourcePlay(choice);
    });

    return (
        <SteamSetup
            name={props.spec.name}
            save={save}
            onComplete={props.onComplete}
            steps={
                <>
                    <PaperWizardStep index={1} hideBack canProceed={mode() !== ""} onStepActive={() => setDownloaded(true)}>
                        <PaperCenteredInterface size="large">
                            <PaperFlex direction="column" gap="half" fullWidth fullHeight>
                                <PaperText preset="title">Game Mode</PaperText>
                                <PaperText preset="body">
                                    Pick a game mode and the server plays its maps in turn, or leave it mixed. You can change this any time on the Maps tab.
                                </PaperText>
                                <PaperFlex direction="column" gap="half" fullWidth flex minHeight={0} scrollable="y">
                                <Show when={listed.error()}>
                                    <PaperQuote variant="danger" icon="warning" title={`Couldn't read ${props.spec.name}'s maps`}>
                                        <PaperFlex direction="column" gap="half" align="flex-start">
                                            <span>{listed.error()}</span>
                                            <PaperButton onClick={() => void listed.reload()}>Try again</PaperButton>
                                        </PaperFlex>
                                    </PaperQuote>
                                </Show>
                                <MapPicturesFailure pictures={pictures} />
                                <Show when={installed()}>
                                    <PaperMediaCardGroup minCardWidth="field-wide">
                                        <For each={modes()}>
                                            {(m) => (
                                                <PaperMediaCard
                                                    banner={pictures.of(showcase(m.maps)!) ?? iconBanner("map")}
                                                    bannerAlt={`${m.name}, shown by ${pictures.titleOf(showcase(m.maps)!) ?? showcase(m.maps)}`}
                                                    title={m.name}
                                                    description={`${m.maps.length} ${m.maps.length === 1 ? "map" : "maps"}`}
                                                    selected={mode() === m.prefix}
                                                    onClick={() => pick(m.prefix)}
                                                />
                                            )}
                                        </For>
                                        <PaperMediaCard
                                            banner={mixedMaps().length > 0 ? mixedMaps().map((name) => pictures.of(name)!) : iconBanner("shuffle")}
                                            bannerAlt={`Mixed, shown by ${mixedMaps().map((name) => pictures.titleOf(name) ?? name).join(", ")}`}
                                            title="Mixed"
                                            description="Every kind of map, in the game's own map cycle."
                                            selected={mode() === null}
                                            onClick={() => pick(null)}
                                        />
                                    </PaperMediaCardGroup>
                                    <MapPicturesCredit pictures={pictures} />
                                </Show>
                                </PaperFlex>
                            </PaperFlex>
                        </PaperCenteredInterface>
                    </PaperWizardStep>

                    <PaperWizardStep index={2} canProceed={map() !== "" && !saving.busy()}>
                        <PaperCenteredInterface size="large">
                            <PaperFlex direction="column" gap="half" fullWidth fullHeight>
                                <PaperText preset="title">Starting Map</PaperText>
                                <PaperText preset="body">
                                    {mode() === null
                                        ? "The server starts on this map, then follows the game's own map cycle."
                                        : `The server starts on this map, then plays the other ${chosenMode()?.name ?? ""} maps in turn. Change the rotation any time on the Maps tab.`}
                                </PaperText>
                                <Show when={saving.error()}>
                                    {(failure) => <PaperQuote variant="danger" icon="warning" title={failure().title}>{failure().message}</PaperQuote>}
                                </Show>
                                <PaperFlex direction="column" fullWidth flex minHeight={0} scrollable="y">
                                    <MapCards maps={startableChoices()} value={map()} pictures={pictures} hideMode={mode() !== null} disabled={saving.busy()} onPick={setMap} />
                                </PaperFlex>
                            </PaperFlex>
                        </PaperCenteredInterface>
                    </PaperWizardStep>
                </>
            }
        />
    );
}
