import { createEffect, createSignal, For, Show } from "solid-js";
import {
    PaperCheckbox,
    PaperCard,
    PaperFlex,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperQuote,
    PaperText,
    getVarCss,
} from "@paperboard-dev/paperui";
import {
    getDetailedVersionsForSoftware,
    type ServerSoftwareType,
    type VersionItem,
} from "../lib/software";

// Shared Minecraft version picker: search, release-channel filters and the
// version list. Used by onboarding (Setup) and the Versions tab so there is
// one implementation of "which versions does this software offer".
export default function VersionPicker(props: {
    software: ServerSoftwareType;
    selectedVersion: string;
    onSelectVersion: (version: string) => void;
    /** Fill the parent instead of a fixed list height. */
    fill?: boolean;
}) {
    const [searchQuery, setSearchQuery] = createSignal("");
    const [allVersions, setAllVersions] = createSignal<VersionItem[]>([]);
    const [loading, setLoading] = createSignal(true);

    const [includeReleases, setIncludeReleases] = createSignal(true);
    const [includeSnapshots, setIncludeSnapshots] = createSignal(false);

    const loadVersions = async () => {
        setLoading(true);
        try {
            const versions = await getDetailedVersionsForSoftware(props.software);
            setAllVersions(versions);
            if (versions.length > 0) {
                const currentExists = versions.some((v) => v.id === props.selectedVersion);
                if (!currentExists) {
                    const firstRelease =
                        versions.find((v) => v.type === "release") || versions[0];
                    if (firstRelease) props.onSelectVersion(firstRelease.id);
                }
            }
        } catch (err) {
            console.error("[VersionPicker] Failed to load versions:", err);
        } finally {
            setLoading(false);
        }
    };

    createEffect(() => {
        if (props.software) loadVersions();
    });

    const filteredVersions = () => {
        const query = searchQuery().toLowerCase().trim();
        const releases = includeReleases();
        const snapshots = includeSnapshots();

        return allVersions().filter((item) => {
            // never offer a version the source publishes no server jar for
            if (!item.installable) return false;
            if (item.type === "release" && !releases) return false;
            if (item.type === "snapshot" && !snapshots) return false;
            if (query && !item.id.toLowerCase().includes(query)) return false;
            return true;
        });
    };

    return (
        <PaperFlex
            direction="row"
            gap="full"
            align="stretch"
            fullWidth
            flex={props.fill}
            minHeight={props.fill ? 0 : getVarCss("size-panel-height-small")}
        >
            <PaperFlex
                direction="column"
                gap="half"
                fullWidth
                style={{ flex: 1, "min-width": 0, "min-height": 0 }}
            >
                <PaperInput
                    fullWidth
                    icon="search"
                    placeholder="Search versions..."
                    value={searchQuery()}
                    onInput={(e) => setSearchQuery(e.currentTarget.value)}
                />

                <PaperQuote variant="warning" icon="info" title="Compatibility">
                    Paperboard works best on the latest Minecraft version. Full
                    feature support for older versions may vary.
                </PaperQuote>

                <PaperCard grow minHeight={0} scrollable="y">
                    <Show
                        when={!loading()}
                        fallback={
                            <PaperFlex padding="full" center>
                                <PaperText preset="body" color={getVarCss("text-subtle")}>
                                    Loading versions...
                                </PaperText>
                            </PaperFlex>
                        }
                    >
                        <Show
                            when={filteredVersions().length > 0}
                            fallback={
                                <PaperFlex padding="full" center>
                                    <PaperText preset="body" color={getVarCss("text-subtle")}>
                                        No versions matching your filters.
                                    </PaperText>
                                </PaperFlex>
                            }
                        >
                            <PaperList
                                name="minecraftVersion"
                                value={props.selectedVersion}
                                onValueChange={(val) => props.onSelectVersion(String(val))}
                                fullWidth
                                borderless
                                style={{ height: "auto", background: "transparent" }}
                            >
                                <For each={filteredVersions()}>
                                    {(item) => (
                                        <PaperListItem
                                            value={item.id}
                                            description={
                                                item.type && item.type !== "release"
                                                    ? item.type.replace("old_", "")
                                                    : undefined
                                            }
                                        >
                                            {item.id}
                                        </PaperListItem>
                                    )}
                                </For>
                            </PaperList>
                        </Show>
                    </Show>
                </PaperCard>
            </PaperFlex>

            <PaperCard shrink={false} scrollable="y">
                    <PaperFlex direction="column" gap="full" padding="full">
                        <PaperText preset="title">Version Types</PaperText>
                        <PaperFlex direction="column" gap="threefourths">
                            <PaperCheckbox
                                checked={includeReleases()}
                                onChange={setIncludeReleases}
                                label="Releases"
                                description="Full releases"
                            />
                            <PaperCheckbox
                                checked={includeSnapshots()}
                                onChange={setIncludeSnapshots}
                                label="Snapshots"
                            />
                        </PaperFlex>
                    </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
