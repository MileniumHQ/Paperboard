import { createEffect, createMemo, createResource, createSignal, For, on, Show } from "solid-js";
import { PaperButton, PaperCenteredInterface, PaperFlex, PaperIcon, PaperMediaCard, PaperMediaCardGroup, PaperQuote, PaperText, useWizard } from "@mileniumhq/paperui";
import { serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { sourceActions, type SourceGameSpec } from "./index";
import MapCards, { MapPicturesCredit, MapPicturesFailure, mapChoices } from "./MapCards";
import { playModes } from "./modes";
import { createMapPictures } from "./useMapPictures";

/** A banner of one big symbol, for a card whose pictures are not there. */
const iconBanner = (icon: string) => (
    <PaperFlex center fullWidth fullHeight>
        <PaperText size={14}><PaperIcon>{icon}</PaperIcon></PaperText>
    </PaperFlex>
);

/** What was asked: a mode's prefix, or null for the game's own map cycle. */
type Choice = { mode: string | null; map: string };

/** The last step of a game's setup: how the server plays, as picture cards. */
export default function SourcePlayStep(props: {
    spec: SourceGameSpec;
    /** hands setup how to save the choice once Finish Setup is pressed; it says whether it did */
    register(save: () => Promise<boolean>): void;
}) {
    const ids = sourceActions(props.spec.id);
    const wizard = useWizard();
    const pictures = createMapPictures(props.spec);
    const [resource, { refetch }] = createResource(() => serverBridge.call<string[]>(ids.maps));
    // reading a failed resource throws; the failure is shown where the maps would be
    const installed = () => (resource.state === "ready" ? resource() : undefined);
    // the mode picked ("" before one is), and null for the game's own map cycle
    const [mode, setMode] = createSignal<string | null | "">("");
    const [map, setMap] = createSignal("");
    const [saveError, setSaveError] = createSignal("");

    const modes = createMemo(() => playModes(props.spec, installed() ?? []));
    const chosenMode = createMemo(() => modes().find((m) => m.prefix === mode()));
    /** the maps to start on: the mode's, or every one the server has */
    const startable = createMemo(() => (mode() === null ? (installed() ?? []) : (chosenMode()?.maps ?? [])));
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
        setMode(next);
        setMap(gameDefault() ?? "");
    };

    createEffect(() => wizard?.setCanProceed(mode() !== "" && map() !== ""));
    // a step opens at its top, not where the card that led to it was scrolled to
    let step: HTMLDivElement | undefined;
    createEffect(on(mode, () => {
        for (let pane = step?.parentElement; pane; pane = pane.parentElement) {
            if (pane.scrollHeight > pane.clientHeight && /auto|scroll/.test(getComputedStyle(pane).overflowY)) { pane.scrollTo({ top: 0 }); return; }
        }
    }, { defer: true }));
    props.register(async () => {
        wizard?.setOptionsShown(false);
        setSaveError("");
        try {
            const choice: Choice = { mode: mode() as string | null, map: map() };
            await serverBridge.call(ids.play, choice);
            return true;
        } catch (err) {
            setSaveError(errorMessage(err));
            wizard?.setOptionsShown(true);
            return false;
        }
    });

    return (
        <PaperCenteredInterface size="full">
            <PaperFlex ref={(el) => (step = el)} direction="column" gap="full" fullWidth padding="full">
                <Show when={resource.error}>
                    <PaperQuote variant="danger" icon="warning" title={`Couldn't read ${props.spec.name}'s maps`}>
                        <PaperFlex direction="column" gap="half" align="flex-start">
                            <span>{errorMessage(resource.error)}</span>
                            <PaperButton onClick={() => void refetch()}>Try again</PaperButton>
                        </PaperFlex>
                    </PaperQuote>
                </Show>
                <Show when={saveError()}>
                    <PaperQuote variant="danger" icon="warning" title="Setup is not finished">{saveError()}</PaperQuote>
                </Show>
                <Show when={installed()}>
                    <Show
                        when={mode() === ""}
                        fallback={
                            <PaperFlex direction="column" gap="full" fullWidth>
                                <PaperFlex direction="column" gap="half">
                                    <PaperFlex direction="row" gap="half" align="center" justify="space-between" wrap>
                                        <PaperText preset="title">Where does it start?</PaperText>
                                        <PaperButton variant="text" size="tiny" disabled={wizard && !wizard.optionsShown()} onClick={() => { setMode(""); setMap(""); }}>
                                            {mode() === null ? "Change how it plays" : "Change game mode"}
                                        </PaperButton>
                                    </PaperFlex>
                                    <PaperText preset="body">
                                        {mode() === null
                                            ? "The server starts on this map, then follows the game's own map cycle."
                                            : `The server starts on this map, then plays the other ${chosenMode()!.name} maps in turn. Change the rotation any time on the Maps tab.`}
                                    </PaperText>
                                </PaperFlex>
                                <MapCards maps={mapChoices(props.spec, startable())} value={map()} pictures={pictures} hideMode={mode() !== null} disabled={wizard && !wizard.optionsShown()} onPick={setMap} />
                            </PaperFlex>
                        }
                    >
                        <PaperFlex direction="column" gap="full" fullWidth>
                            <PaperFlex direction="column" gap="half">
                                <PaperFlex direction="row" gap="half" align="center" justify="space-between" wrap>
                                    <PaperText preset="title">How will it play?</PaperText>
                                </PaperFlex>
                                <PaperText preset="body">
                                    Pick a game mode and the server plays its maps in turn, or leave it mixed. You can change this any time on the Maps tab.
                                </PaperText>
                            </PaperFlex>
                            <MapPicturesFailure pictures={pictures} />
                            <PaperMediaCardGroup minCardWidth="field-wide">
                                <For each={modes()}>
                                    {(m) => (
                                        <PaperMediaCard
                                            effect={false}
                                            banner={pictures.of(showcase(m.maps)!) ?? iconBanner("map")}
                                            bannerAlt={`${m.name}, shown by ${pictures.titleOf(showcase(m.maps)!) ?? showcase(m.maps)}`}
                                            title={m.name}
                                            description={`${m.maps.length} ${m.maps.length === 1 ? "map" : "maps"}`}
                                            onClick={() => pick(m.prefix)}
                                        />
                                    )}
                                </For>
                                <PaperMediaCard
                                    effect={false}
                                    banner={mixedMaps().length > 0 ? mixedMaps().map((name) => pictures.of(name)!) : iconBanner("shuffle")}
                                    bannerAlt={`Mixed, shown by ${mixedMaps().map((name) => pictures.titleOf(name) ?? name).join(", ")}`}
                                    title="Mixed"
                                    description="Every kind of map, in the game's own map cycle."
                                    onClick={() => pick(null)}
                                />
                            </PaperMediaCardGroup>
                            <MapPicturesCredit pictures={pictures} />
                        </PaperFlex>
                    </Show>
                </Show>
            </PaperFlex>
        </PaperCenteredInterface>
    );
}
