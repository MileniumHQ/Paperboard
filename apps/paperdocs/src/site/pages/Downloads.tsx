import { PaperText } from "@paperboard-dev/paperui";
import { For } from "solid-js";
import styles from "../site.module.css";

// Versionless download aliases resolved by i.paperboard.dev to the current
// release asset. Canonical filenames live in scripts/.
interface DownloadLink {
    arch: string;
    file: string;
}

interface DownloadPlatform {
    os: string;
    links: DownloadLink[];
}

const PAPERBOARD: DownloadPlatform[] = [
    {
        os: "Windows",
        links: [{ arch: "x64", file: "paperboard-windows-x64-setup.exe" }],
    },
    {
        os: "macOS",
        links: [
            { arch: "Apple Silicon", file: "paperboard-macos-arm64.dmg" },
            { arch: "Intel", file: "paperboard-macos-x64.dmg" },
        ],
    },
    {
        os: "Linux",
        links: [
            { arch: "x64", file: "paperboard-linux-x64.AppImage" },
            { arch: "ARM64", file: "paperboard-linux-arm64.AppImage" },
        ],
    },
];

const SERVER: DownloadPlatform[] = [
    {
        os: "Windows",
        links: [{ arch: "x64", file: "crane-windows-x64.zip" }],
    },
    {
        os: "macOS",
        links: [
            { arch: "Apple Silicon", file: "crane-macos-arm64.tar.gz" },
            { arch: "Intel", file: "crane-macos-x64.tar.gz" },
        ],
    },
    {
        os: "Linux",
        links: [
            { arch: "x64", file: "crane-linux-x64.tar.gz" },
            { arch: "ARM64", file: "crane-linux-arm64.tar.gz" },
        ],
    },
];

function Section(props: {
    title: string;
    description: string;
    app: "pb" | "crane";
    platforms: DownloadPlatform[];
}) {
    return (
        <section class={styles.downloadSection}>
            <PaperText preset="title" weight={700} as="h2">{props.title}</PaperText>
            <PaperText as="p">{props.description}</PaperText>
            <ul class={styles.downloadList}>
                <For each={props.platforms}>{platform => (
                    <li>
                        <span>{platform.os}: </span>
                        <For each={platform.links}>{(link, index) => <>
                            {index() > 0 && " · "}
                            <a href={`https://i.paperboard.dev/${props.app}/latest/${link.file}`}>
                                {link.arch}{props.app === "pb" && platform.os === "Linux" ? " AppImage" : ""}
                            </a>
                        </>}</For>
                    </li>
                )}</For>
            </ul>
        </section>
    );
}

export function Downloads() {
    return (
        <div class={styles.downloadPage}>
            <PaperText as="h1" preset="header" weight={700}>Downloads</PaperText>
            <PaperText as="p" color="text-subtle">
                Paperboard is in alpha. Some features may be buggy or incomplete.
                Windows and macOS builds are unsigned; your operating system may warn you when you open them.
            </PaperText>
            <Section title="Paperboard" description="The desktop app. Includes the server daemon for this computer." app="pb" platforms={PAPERBOARD} />
            <Section title="Paperboard server daemon" description="For a headless computer you want to manage from Paperboard on another device." app="crane" platforms={SERVER} />
            <PaperText as="p" color="text-subtle">Linux AppImages need FUSE 2. Make the downloaded file executable before opening it.</PaperText>
        </div>
    );
}
