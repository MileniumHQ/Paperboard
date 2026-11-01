import { For } from "solid-js";
import { PaperSelector, PaperSelectorItem } from "@mileniumhq/paperui";
import { releases, softwareName, tmodloaderReleases, type TerrariaSoftware } from "./catalog";

/** a software's releases, newest first, as the version selectors list them */
export const releasesOf = (software: TerrariaSoftware): { version: string; description: string }[] =>
    software === "tmodloader"
        ? tmodloaderReleases.map((r) => ({ version: r.version, description: `tModLoader from GitHub, made from Terraria ${r.terraria}.` }))
        : releases.map((r) => ({ version: r.version, description: "Vanilla dedicated server from terraria.org." }));

/** A software's releases to pick one from, as setup and Versions list them. */
export default function ReleaseSelector(props: { software: TerrariaSoftware; value: string; onChange(version: string): void }) {
    return (
        <PaperSelector name="terrariaVersion" value={props.value} onValueChange={(value) => props.onChange(String(value))}>
            <For each={releasesOf(props.software)}>
                {(release, index) => (
                    <PaperSelectorItem
                        value={release.version}
                        description={index() === 0 ? <><strong>Latest.</strong> {release.description}</> : release.description}
                    >
                        {softwareName(props.software)} {release.version}
                    </PaperSelectorItem>
                )}
            </For>
        </PaperSelector>
    );
}
