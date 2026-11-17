import { createEffect, createSignal, For, Show, untrack, on, batch } from "solid-js";
import { useServer } from "../lib/server";
import {
    PaperCard,
    PaperCheckbox,
    PaperError,
    PaperFlex,
    PaperInput,
    PaperList,
    PaperListItem,
    PaperQuote,
    PaperText,
    createLatest,
} from "@mileniumhq/paperui";
import type { ServerSoftwareType, VersionItem } from "../lib/software";
import { errorMessage } from "../lib/failure";

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
    const { calls } = useServer();
    const [searchQuery, setSearchQuery] = createSignal("");
    const [allVersions, setAllVersions] = createSignal<VersionItem[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal("");
    const latest = createLatest();

    const [includeReleases, setIncludeReleases] = createSignal(true);
    const [includeSnapshots, setIncludeSnapshots] = createSignal(false);

    // The parent owns the choice and clears it when its software changes. A
    // list keeps the choice it finds there, read as the list arrives (a
    // parent may set it while the list loads, as the Versions tab does with
    // the installed version), and otherwise picks the newest release.
    const loadVersions = async (software = props.software) => {
        setLoading(true);
        setError("");
        setAllVersions([]);
        const current = latest();
        try {
            // the service fetches upstream: some indexes refuse cross-origin reads
            const answer = await calls.listSoftwareVersions({ software });
            if (!current()) return;
            const versions = answer.filter((v) => v.installable && (v.type === "release" || v.type === "snapshot"));
            setAllVersions(versions);
            const selected = untrack(() => props.selectedVersion);
            if (!versions.some((v) => v.id === selected)) {
                props.onSelectVersion((versions.find((v) => v.type === "release") ?? versions[0])?.id ?? "");
            }
            setLoading(false);
        } catch (err) {
            if (!current()) return;
            batch(() => {
                setError(errorMessage(err));
                setLoading(false);
            });
        }
    };

    createEffect(on(() => props.software, (software) => void loadVersions(software)));

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
            direction="column"
            gap="half"
            fullWidth
            flex={props.fill || undefined}
            height={props.fill ? undefined : "panel-height-large"}
            minWidth={0}
            minHeight={0}
        >
            <PaperQuote variant="warning" icon="info" title="Compatibility">
                Paperboard works best on the latest Minecraft version. Full
                feature support for older versions may vary.
            </PaperQuote>

            <PaperInput
                fullWidth
                icon="search"
                placeholder="Version"
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />

            <PaperCard>
                <PaperFlex direction="row" wrap gap="full" padding="full" shrink={false}>
                    <PaperCheckbox
                        checked={includeReleases()}
                        onChange={setIncludeReleases}
                        disabled={loading() || !allVersions().some((v) => v.type === "release")}
                        label="Releases"
                    />
                    <PaperCheckbox
                        checked={includeSnapshots()}
                        onChange={setIncludeSnapshots}
                        disabled={loading() || !allVersions().some((v) => v.type === "snapshot")}
                        label="Snapshots"
                    />
                </PaperFlex>
            </PaperCard>

            <PaperCard flex minHeight={0} fullWidth>
                <Show
                    when={!loading()}
                    fallback={
                        <PaperFlex padding="full" center>
                            <PaperText preset="body" color="text-subtle">
                                Loading versions...
                            </PaperText>
                        </PaperFlex>
                    }
                >
                    <Show
                        when={filteredVersions().length > 0}
                        fallback={
                            // a list that failed to load says so, not that nothing matched
                            <Show
                                when={error()}
                                fallback={
                                    <PaperFlex padding="full" center>
                                        <PaperText preset="body" color="text-subtle">
                                            No versions matching your filters.
                                        </PaperText>
                                    </PaperFlex>
                                }
                            >
                                {(err) => <PaperError fill title="Couldn't load the versions" error={err()} action={{ label: "Try again", onClick: () => void loadVersions() }} />}
                            </Show>
                        }
                    >
                        <PaperList
                            name="minecraftVersion"
                            value={props.selectedVersion}
                            onValueChange={(val) => props.onSelectVersion(String(val))}
                            fullWidth
                            flex
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
    );
}
