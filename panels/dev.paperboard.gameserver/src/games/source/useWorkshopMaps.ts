import { createRead } from "@mileniumhq/paperui";
import { errorMessage } from "../../lib/failure";
import { type SourceGameSpec } from "./index";
import type { MapChoice } from "./MapCards";
import { canonicalMap, workshopName, type SourceWorkshopMap } from "./workshop";
import { useServer } from "../../lib/server";

/** What a screen shows of a Steam Workshop map: Valve's name for the mode it is listed under. */
export const WORKSHOP_GROUP = "Steam Workshop";

/** A Workshop map as a card. */
export const workshopChoice = (map: SourceWorkshopMap, note?: string): MapChoice => ({ name: workshopName(map.id), title: map.title, preview: map.previewImageUrl ?? undefined, mode: WORKSHOP_GROUP, note });

/** The Steam Workshop maps added to a server, asked for once; none for a game without them. */
export function createWorkshopMaps(spec: SourceGameSpec) {
    const { calls } = useServer();
    const read = createRead((): Promise<SourceWorkshopMap[]> => calls.sourceWorkshopMaps(), { source: () => spec.workshop, message: errorMessage });
    const maps = () => read.value() ?? [];
    return {
        maps,
        error: () => (read.loading() ? "" : (read.error() ?? "")),
        reload: read.reload,
        /** a map's own title, if it is a Workshop map this server has */
        titleOf: (name: string) => maps().find((m) => workshopName(m.id) === canonicalMap(name))?.title,
        choices: () => maps().map((m) => workshopChoice(m)),
    };
}
