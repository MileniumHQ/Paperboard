import { createEffect, createSignal, For, Show, onCleanup, untrack } from "solid-js";
import {
    PaperButton,
    PaperCheckbox,
    PaperCard,
    PaperFlex,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperQuote,
    PaperText,
    getVarCss,
} from "@mileniumhq/paperui";
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
    const [error, setError] = createSignal("");
    let generation = 0;
    onCleanup(() => { generation++; });

    const [includeReleases, setIncludeReleases] = createSignal(true);
    const [includeSnapshots, setIncludeSnapshots] = createSignal(false);

    const loadVersions = async (software = props.software) => {
        const currentGeneration = ++generation;
        const selected = untrack(() => props.selectedVersion);
        setLoading(true);
        setError("");
        setAllVersions([]);
        props.onSelectVersion("");
        try {
            const versions = (await getDetailedVersionsForSoftware(software))
                .filter((v) => v.installable && (v.type === "release" || v.type === "snapshot"));
            if (currentGeneration !== generation) return;
            setAllVersions(versions);
            const current = versions.find((v) => v.id === selected);
            const first = current ?? versions.find((v) => v.type === "release") ?? versions[0];
            if (first) props.onSelectVersion(first.id);
        } catch (err) {
            if (currentGeneration !== generation) return;
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (currentGeneration === generation) setLoading(false);
        }
    };

    createEffect(() => {
        const software = props.software;
        untrack(() => void loadVersions(software));
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
            style={
                props.fill
                    ? { flex: 1, "min-height": 0 }
                    : { height: getVarCss("size-panel-height-small"), "min-height": 0 }
            }
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

                <Show when={error()}>
                    <PaperQuote variant="danger" title="Could not load versions">
                        {error()}
                        <PaperButton onClick={() => void loadVersions()}>Retry loading versions</PaperButton>
                    </PaperQuote>
                </Show>

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

            <PaperCard shrink={false} scrollable="y" style={{ width: "auto" }}>
                    <PaperFlex direction="column" gap="full" padding="full">
                        <PaperText preset="title">Version Types</PaperText>
                        <PaperFlex direction="column" gap="threefourths">
                            <PaperCheckbox
                                checked={includeReleases()}
                                onChange={setIncludeReleases}
                                disabled={loading() || !allVersions().some((v) => v.type === "release")}
                                label="Releases"
                                description="Full releases"
                            />
                            <PaperCheckbox
                                checked={includeSnapshots()}
                                onChange={setIncludeSnapshots}
                                disabled={loading() || !allVersions().some((v) => v.type === "snapshot")}
                                label="Snapshots"
                            />
                        </PaperFlex>
                    </PaperFlex>
            </PaperCard>
        </PaperFlex>
    );
}
