import { type Component, createSignal, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperText,
    PaperModal,
    PaperButton,
    PaperEffect,
    PaperTable,
    PaperBadge,
    getVarCss,
} from "@paperboard-dev/paperui";
import bannerImg from "../../assets/PanelLibraryBanner.png";
import { logToMain } from "../../lib/shell";

export interface PanelItem {
    id: string;
    name: string;
    version?: string;
    icon?: string;
    iconUrl?: string;
    downloadUrl?: string;
    description?: string;
    publisher?: string;
    size?: string;
    updatedAt?: string;
    isInstalled?: boolean;
    // daemon-recorded install provenance (absent for pre-provenance installs)
    installSource?: "registry" | "direct" | "dev";
    isLinked?: boolean;
    installedVersion?: string;
}

// Publisher, install source and review evidence are independent facts.
// A missing publisher is not a signature status; registry origin is not
// proof of review. Unknown facts stay explicitly unknown.
function publisherLabel(panel: PanelItem): string {
    if (panel.publisher) return panel.publisher;
    return "Publisher not provided";
}

// where the bytes came from — a different fact from who published them
function installSourceLabel(panel: PanelItem): string {
    if (!panel.isInstalled) return "Not installed on this computer";
    if (panel.isLinked) return "Dev link (local build)";
    if (panel.installSource === "registry")
        return "Paperboard Registry";
    if (panel.installSource === "direct")
        return "Direct URL (checksum verified)";
    return "Install source not recorded";
}

interface PanelLibraryProps {
    panels: PanelItem[];
    /** Owning computer for panel:// asset URLs (icon serving is per-computer). */
    computerId: string;
    /** Store registry failed to load; show a retry affordance. */
    loadFailed?: boolean;
    onRetryLoad?: () => void;
    onOpen: (id: string) => void;
    onDownload: (id: string) => Promise<void>;
}

const PanelLibrary: Component<PanelLibraryProps> = (props) => {
    const [selectedPanel, setSelectedPanel] = createSignal<PanelItem | null>(
        null,
    );
    const [isDownloading, setIsDownloading] = createSignal(false);
    const [installError, setInstallError] = createSignal<string | null>(null);

    const getIconSrc = (panel: PanelItem) => {
        if (panel.iconUrl) {
            return panel.iconUrl;
        }
        if (panel.icon?.includes(".")) {
            return `panel://${props.computerId}.${panel.id}/${panel.icon.replace(/^\.\//, "")}`;
        }
        return null;
    };

    const renderCardIcon = (panel: PanelItem) => {
        const src = getIconSrc(panel);
        if (src) {
            return (
                <img
                    src={src}
                    alt={panel.name}
                    style={{
                        width: "4.5rem",
                        height: "4.5rem",
                        "border-radius": getVarCss("border-radius"),
                        "object-fit": "contain",
                    }}
                />
            );
        }
        return panel.icon || "dashboard";
    };

    const handleAction = async (panel: PanelItem) => {
        if (panel.isInstalled) {
            props.onOpen(panel.id);
            setSelectedPanel(null);
        } else {
            setIsDownloading(true);
            setInstallError(null);
            try {
                await props.onDownload(panel.id);
                setSelectedPanel(null);
            } catch (err: any) {
                logToMain("error", "Failed to download panel:", err);
                setInstallError(
                    `Couldn't install ${panel.name}${err?.message ? `: ${err.message}` : ""}`,
                );
            } finally {
                setIsDownloading(false);
            }
        }
    };

    return (
        <>
            <div
                style={{
                    flex: "1",
                    width: "100%",
                    height: "100%",
                    "overflow-y": "auto",
                    "overflow-x": "hidden",
                    "box-sizing": "border-box",
                    padding: getVarCss("uigap"),
                }}
            >
                <div
                    style={{
                        "max-width": "62rem",
                        margin: "0 auto",
                        display: "flex",
                        "flex-direction": "column",
                        gap: getVarCss("uigap"),
                        width: "100%",
                        "box-sizing": "border-box",
                    }}
                >
                    <div
                        style={{
                            width: "100%",
                            "border-radius": getVarCss("border-radius"),
                            overflow: "hidden",
                            border: `${getVarCss("border-width")} solid ${getVarCss("border")}`,
                            "flex-shrink": 0,
                        }}
                    >
                        <img
                            src={bannerImg}
                            alt="Panel Library - Find and launch powerful tools in just a click"
                            style={{
                                width: "100%",
                                height: "auto",
                                display: "block",
                            }}
                        />
                    </div>

                    <Show when={props.loadFailed}>
                        <PaperFlex direction="row" gap="half" align="center">
                            <PaperBadge variant="danger">
                                Couldn't load library
                            </PaperBadge>
                            <PaperButton
                                variant="text"
                                onClick={() => props.onRetryLoad?.()}
                            >
                                Retry
                            </PaperButton>
                        </PaperFlex>
                    </Show>

                    <PaperMediaCardGroup minCardWidth="18rem">
                        <For each={props.panels}>
                            {(panel) => (
                                <>
                                    <PaperMediaCard
                                        icon={renderCardIcon(panel)}
                                        title={panel.name}
                                        description={panel.description}
                                        badge={
                                            panel.isInstalled ? (
                                                <PaperBadge variant="success">
                                                    Installed
                                                </PaperBadge>
                                            ) : undefined
                                        }
                                        footerLeft={
                                            <PaperText size={2} color="text-subtle">
                                                {publisherLabel(panel)}
                                            </PaperText>
                                        }
                                        footerRight={
                                            <PaperText size={2} color="text-subtle">
                                                {panel.version
                                                    ? `v${panel.version}`
                                                    : "–"}
                                            </PaperText>
                                        }
                                        onClick={() => setSelectedPanel(panel)}
                                    />
                                </>
                            )}
                        </For>
                    </PaperMediaCardGroup>
                </div>
            </div>

            <PaperModal
                open={selectedPanel() !== null}
                aria-label={selectedPanel() ? `${selectedPanel()!.name} details` : "Panel details"}
                onClose={() => setSelectedPanel(null)}
                size="large"
                noHeader
            >
                <Show when={selectedPanel()}>
                    {(panel) => (
                        <PaperFlex direction="column" gap="full">
                            <PaperFlex
                                direction="row"
                                gap="full"
                                align="center"
                            >
                                <Show
                                    when={getIconSrc(panel())}
                                    fallback={
                                        <span style={{ "font-size": "4.5rem" }}>
                                            {panel().icon || "dashboard"}
                                        </span>
                                    }
                                >
                                    <img
                                        src={getIconSrc(panel())!}
                                        alt={panel().name}
                                        style={{
                                            width: "5.5rem",
                                            height: "5.5rem",
                                            "border-radius":
                                                getVarCss("border-radius"),
                                            "object-fit": "contain",
                                        }}
                                    />
                                </Show>

                                <PaperFlex
                                    direction="column"
                                    gap="onefourth"
                                    style={{ flex: 1 }}
                                >
                                    <PaperText size={5} weight={700}>
                                        {panel().name}
                                    </PaperText>
                                    <PaperText size={2} color="text-subtle">
                                        {publisherLabel(panel())}
                                    </PaperText>
                                </PaperFlex>

                                <PaperEffect>
                                    <PaperButton
                                        variant={
                                            panel().isInstalled
                                                ? "brand"
                                                : "primary"
                                        }
                                        disabled={isDownloading()}
                                        onClick={() => handleAction(panel())}
                                    >
                                        {isDownloading()
                                            ? "Downloading..."
                                            : panel().isInstalled
                                              ? "Open"
                                              : "Download"}
                                    </PaperButton>
                                </PaperEffect>
                            </PaperFlex>

                                <Show when={installError()}>
                                    <PaperText size={2} color="danger">
                                        {installError()}
                                    </PaperText>
                                </Show>

                                <PaperFlex direction="column" gap="onefourth">
                                    <PaperText size={3} weight={700}>
                                        About
                                    </PaperText>
                                <PaperText size={2}>
                                    {panel().description ||
                                        "No description provided for this panel."}
                                </PaperText>
                            </PaperFlex>

                            <PaperFlex direction="column" gap="onefourth">
                                <PaperText size={3} weight={700}>
                                    Information
                                </PaperText>
                                <PaperTable>
                                    <tbody>
                                        <tr>
                                            <th>Publisher</th>
                                            <td>
                                                {panel().publisher || "–"}
                                            </td>
                                        </tr>
                                        <tr>
                                            <th>Install source</th>
                                            <td>
                                                {installSourceLabel(panel())}
                                            </td>
                                        </tr>
                                        <tr>
                                            <th>Identifier</th>
                                            <td>{panel().id}</td>
                                        </tr>
                                        <tr><th>Review</th><td>No review attestation recorded for this release</td></tr>
                                        <Show when={panel().isInstalled}><tr><th>Installed version</th><td>{panel().installedVersion || panel().version || "Not recorded"}</td></tr></Show>
                                        <tr>
                                            <th>Version</th>
                                            <td>
                                                {panel().version
                                                    ? `v${panel().version}`
                                                    : "–"}
                                            </td>
                                        </tr>
                                        <Show
                                            when={
                                                panel().size &&
                                                panel().size !== "Unknown"
                                            }
                                        >
                                            <tr>
                                                <th>Size</th>
                                                <td>{panel().size}</td>
                                            </tr>
                                        </Show>
                                        <Show when={panel().updatedAt}>
                                            <tr>
                                                <th>Updated</th>
                                                <td>{panel().updatedAt}</td>
                                            </tr>
                                        </Show>
                                    </tbody>
                                </PaperTable>
                            </PaperFlex>
                        </PaperFlex>
                    )}
                </Show>
            </PaperModal>
        </>
    );
};

export default PanelLibrary;
