import { createSignal, onMount } from "solid-js";
import { serverBridge } from "../../lib/server";
import { errorMessage } from "../../lib/failure";
import { sourceActions, type SourceGameSpec } from "./index";
import type { MapChoice } from "./MapCards";
import { canonicalMap, workshopName, type SourceWorkshopMap } from "./workshop";

/** What a screen shows of a Steam Workshop map: Valve's name for the mode it is listed under. */
export const WORKSHOP_GROUP = "Steam Workshop";

/** A Workshop map as a card. */
export const workshopChoice = (map: SourceWorkshopMap, note?: string): MapChoice => ({ name: workshopName(map.id), title: map.title, picture: map.previewImageUrl ?? undefined, mode: WORKSHOP_GROUP, note });

/** The Steam Workshop maps added to a server, asked for once; none for a game without them. */
export function createWorkshopMaps(spec: SourceGameSpec) {
    const [maps, setMaps] = createSignal<SourceWorkshopMap[]>([]);
    const [error, setError] = createSignal("");
    const load = async () => {
        setError("");
        try {
            setMaps(await serverBridge.call<SourceWorkshopMap[]>(sourceActions(spec.id).workshopMaps));
        } catch (err) {
            setError(errorMessage(err));
        }
    };
    onMount(() => { if (spec.workshop) void load(); });
    return {
        maps,
        error,
        reload: load,
        /** a map's own title, if it is a Workshop map this server has */
        titleOf: (name: string) => maps().find((m) => workshopName(m.id) === canonicalMap(name))?.title,
        choices: () => maps().map((m) => workshopChoice(m)),
    };
}
