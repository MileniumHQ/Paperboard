import {
    PaperButton,
    PaperCard,
    PaperEffect,
    PaperGrid,
    PaperPageHeader,
    PaperText,
} from "@paperboard-dev/paperui";
import { For } from "solid-js";
import { PlatformIcon, type PlatformId } from "../platformIcons";
import styles from "../site.module.css";

// Versionless download aliases resolved by i.paperboard.dev to the current
// release asset. Canonical filenames live in scripts/.
interface DownloadLink {
    arch: string;
    file: string;
}

interface DownloadPlatform {
    os: string;
    platform: PlatformId;
    links: DownloadLink[];
}

const PAPERBOARD: DownloadPlatform[] = [
    {
        os: "Windows",
        platform: "windows",
        links: [{ arch: "x64", file: "paperboard-windows-x64-setup.exe" }],
    },
    {
        os: "macOS",
        platform: "macos",
        links: [
            { arch: "Apple Silicon", file: "paperboard-macos-arm64.zip" },
            { arch: "Intel", file: "paperboard-macos-x64.zip" },
        ],
    },
    {
        os: "Linux",
        platform: "linux",
        links: [
            { arch: "x64", file: "paperboard-linux-x64.AppImage" },
            { arch: "ARM64", file: "paperboard-linux-arm64.AppImage" },
        ],
    },
];

const SERVER: DownloadPlatform[] = [
    {
        os: "Windows",
        platform: "windows",
        links: [{ arch: "x64", file: "crane-windows-x64.zip" }],
    },
    {
        os: "macOS",
        platform: "macos",
        links: [
            { arch: "Apple Silicon", file: "crane-macos-arm64.tar.gz" },
            { arch: "Intel", file: "crane-macos-x64.tar.gz" },
        ],
    },
    {
        os: "Linux",
        platform: "linux",
        links: [
            { arch: "x64", file: "crane-linux-x64.tar.gz" },
            { arch: "ARM64", file: "crane-linux-arm64.tar.gz" },
        ],
    },
];

function Section(props: {
    title: string;
    app: "pb" | "crane";
    platforms: DownloadPlatform[];
}) {
    return (
        <section class={styles.downloadSection}>
            <PaperText preset="title" weight={700} as="h2">
                {props.title}
            </PaperText>
            <PaperGrid min="280px">
                <For each={props.platforms}>
                    {(platform) => (
                        <PaperCard
                            surface="front"
                            padding="sixfourths"
                            gap="none"
                        >
                            <div class={styles.platformHead}>
                                <PlatformIcon
                                    platform={platform.platform}
                                    class={styles.platformIcon}
                                />
                                <PaperText preset="title" weight={700}>
                                    {platform.os}
                                </PaperText>
                            </div>
                            <For each={platform.links}>
                                {(link) => (
                                    <div class={styles.downloadItem}>
                                        <div class={styles.downloadRow}>
                                            <PaperText preset="body" weight={700}>
                                                {link.arch}
                                            </PaperText>
                                            <PaperEffect variant="brand">
                                                <PaperButton
                                                    variant="brand"
                                                    size="small"
                                                    href={`https://i.paperboard.dev/${props.app}/latest/${link.file}`}
                                                >
                                                    Download
                                                </PaperButton>
                                            </PaperEffect>
                                        </div>
                                        <PaperText
                                            preset="caption"
                                            family="code"
                                            color="text-subtle"
                                            breakWord
                                        >
                                            {link.file}
                                        </PaperText>
                                    </div>
                                )}
                            </For>
                        </PaperCard>
                    )}
                </For>
            </PaperGrid>
        </section>
    );
}

export function Downloads() {
    return (
        <>
            <PaperPageHeader icon="download" title="Downloads" />
            <PaperText preset="caption" color="text-subtle">
                Paperboard is currently in alpha; some features may be buggy
                or incomplete.
            </PaperText>
            <div class={styles.downloadSections}>
                <Section title="Paperboard" app="pb" platforms={PAPERBOARD} />
                <Section
                    title="Paperboard server daemon"
                    app="crane"
                    platforms={SERVER}
                />
            </div>
        </>
    );
}
